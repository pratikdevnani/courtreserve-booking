#!/usr/bin/env python3
"""
CourtReserve auto-booking script – duration/court hunting edition
"""

import html, re, os, sys, json, urllib.parse as U, textwrap, time, threading
from datetime import datetime, timedelta
from pathlib import Path
from http.cookiejar import MozillaCookieJar
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests, bs4, http.cookiejar as cj
from dotenv import load_dotenv
load_dotenv()

# ─── configuration ────────────────────────────────────────────────────────
ORG_ID   = os.getenv("CR_ORG_ID",       "13234")
SCHED_ID = os.getenv("CR_SCHEDULER_ID", "16994")

# Three accounts for parallel booking
ACCOUNTS = [
    {
        "email": os.getenv("CR_EMAIL_1"),
        "password": os.getenv("CR_PASSWORD_1"),
        "cookie_jar": Path(os.getenv("CR_COOKIE_JAR_1", "jar1.txt"))
    },
    {
        "email": os.getenv("CR_EMAIL_2"),
        "password": os.getenv("CR_PASSWORD_2"),
        "cookie_jar": Path(os.getenv("CR_COOKIE_JAR_2", "jar2.txt"))
    },
    {
        "email": os.getenv("CR_EMAIL_3"),
        "password": os.getenv("CR_PASSWORD_3"),
        "cookie_jar": Path(os.getenv("CR_COOKIE_JAR_3", "jar3.txt"))
    }
]

DATE  = os.getenv("CR_DATE")           # YYYY-MM-DD (required)
START = os.getenv("CR_START_TIME")     # HH:MM 24-h (required)
DURATION = os.getenv("CR_DURATION")    # Duration in minutes (optional)
SINGLE_SHOT = os.getenv("CR_SINGLE_SHOT") == "1"  # Single attempt mode (for scheduler)

# Optional: override the picked court (handy for testing)
PINNED_COURT = os.getenv("CR_COURT_ID") or None

DEBUG      = os.getenv("DEBUG") == "1"
UA         = "Mozilla/5.0 CourtReserveAuto/2.0 (+https://github.com)"
NTFY_TOPIC = "courtreserve-sunnyvale"  # ntfy.sh notification topic

# ─── helpers ──────────────────────────────────────────────────────────────
def log(msg, colour="90"):             # grey default
    if DEBUG:
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]  # HH:MM:SS.mmm
        thread_name = threading.current_thread().name
        print(f"\033[{colour}m[{timestamp}] [{thread_name}] {msg}\033[0m")

def die(msg):
    print(f"\033[91m❌ {msg}\033[0m", file=sys.stderr)
    notify(f"❌ Error: {msg}")
    sys.exit(1)

def notify(message):
    """Send notification via ntfy.sh"""
    try:
        requests.post(
            f"https://ntfy.sh/{NTFY_TOPIC}",
            data=message.encode('utf-8'),
            headers={"Title": "CourtReserve Bot"},
            timeout=5
        )
    except Exception as e:
        log(f"⚠️ Failed to send notification: {e}", "33")

def build_session(cookie_jar_path: Path) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    jar = MozillaCookieJar(str(cookie_jar_path))
    if cookie_jar_path.exists():
        jar.load(ignore_discard=True, ignore_expires=True)
        log(f"▶ loaded cookies from {cookie_jar_path}", "33")
    s.cookies = jar
    return s

def save_cookies(sess, jar_path):
    if isinstance(sess.cookies, MozillaCookieJar):
        sess.cookies.save(ignore_discard=True, ignore_expires=True)
        log(f"▶ saved cookies to {jar_path}", "33")

def generate_time_slots(base_time_str):
    """
    Generate 5 time slots around the base time in order of increasing distance.
    For example, if base is 18:30:
    [18:30, 19:00, 18:00, 19:30, 17:30]
    """
    base_dt = datetime.strptime(base_time_str, "%H:%M")
    slots = [base_dt]

    # Add slots in pairs of ±30min increments
    for offset_minutes in [30, 60]:
        slots.append(base_dt + timedelta(minutes=offset_minutes))
        slots.append(base_dt - timedelta(minutes=offset_minutes))

    return [s.strftime("%H:%M") for s in slots]

def wait_until_next_check():
    """
    Wait until the next check time (top of every minute XX:00:00.1).
    Precise to 0.1 second for maximum speed.
    """
    now = datetime.now()

    # Calculate next minute boundary
    next_minute = (now + timedelta(minutes=1)).replace(second=0, microsecond=000000)  # 0.1 second

    # Calculate exact sleep time
    sleep_duration = (next_minute - now).total_seconds()

    if sleep_duration > 0:
        log(f"⏳ Waiting {sleep_duration:.3f}s until next check time...", "90")
        time.sleep(sleep_duration)

# ─── CourtReserve API wrappers ────────────────────────────────────────────
def api_get(sess, url, **kw):
    log(f"⟳ GET {url}", "34")
    r = sess.get(url, **kw)
    r.raise_for_status()
    return r.json()

def login(sess, email, password):
    lp = f"https://app.courtreserve.com/Online/Account/LogIn/{ORG_ID}"
    sess.get(lp, allow_redirects=True)
    body = {"IsApiCall": True, "UserNameOrEmail": email, "Password": password}
    url  = f"https://app.courtreserve.com/Online/Account/Login?id={ORG_ID}"
    r = sess.post(url,
                  headers={"Content-Type": "application/json",
                           "Referer": lp,
                           "reactsubmit": "true"},
                  data=json.dumps(body))
    r.raise_for_status()
    if not r.json().get("IsValid"):
        die(f"login failed for {email} – check credentials")
    log(f"✅ logged in as {email}", "32")

# 1️⃣ Which lengths are allowed?
def fetch_durations(sess, start_disp, end_disp, date_disp):
    url = (f"https://api4.courtreserve.com/api/v1/portalreservationsapi/"
           f"GetDurationDropdown?id={ORG_ID}"
           f"&reservationTypeId=69707"
           f"&startTime={U.quote_plus(start_disp)}"
           f"&selectedDate={U.quote_plus(date_disp)}"
           "&uiCulture=en-US&useMinTimeAsDefault=False"
           "&courtId=&courtType=9"
           f"&endTime={U.quote_plus(end_disp)}"
           "&isDynamicSlot=False"
           f"&customSchedulerId={SCHED_ID}")
    data = api_get(sess, url)
    # sort largest → smallest
    return sorted([int(d["Value"]) for d in data if not d["Disabled"]],
                  reverse=True)

# 2️⃣ Ask which courts can take *that* duration
def fetch_courts(sess, dur, start_disp, end_disp, date_disp):
    url = (f"https://app.courtreserve.com/Online/AjaxController/"
           f"GetAvailableCourtsMemberPortal/{ORG_ID}"
           "?uiCulture=en-US"
           f"&Date={U.quote_plus(date_disp + ' 12:00:00 AM')}"
           f"&selectedDate={U.quote_plus(date_disp + ' 12:00:00 AM')}"
           f"&StartTime={U.quote_plus(start_disp)}"
           f"&EndTime={U.quote_plus(end_disp)}"
           "&CourtTypesString=9"
           "&timeZone=America/Los_Angeles"
           f"&customSchedulerId={SCHED_ID}"
           f"&Duration={dur}")
    return api_get(sess, url)

# 3️⃣ Calculate end time locally (no API call needed)
def calc_end_local(start_time_str, dur_minutes):
    """
    Calculate end time locally without API call.
    start_time_str: "HH:MM" format (24-hour)
    Returns: "H:MM PM" format (12-hour with AM/PM)
    """
    start_dt = datetime.strptime(start_time_str, "%H:%M")
    end_dt = start_dt + timedelta(minutes=dur_minutes)
    return end_dt.strftime("%-I:%M %p").lstrip('0')

# 4️⃣ Hunt for available courts across all time slots and durations
def hunt_available_slots(sess, time_slots, date_disp, priority_durations=[120, 90, 60, 30], max_courts=3):
    """
    Hunt for available courts by trying durations in priority order across all time slots.
    Returns a list of (slot_time, duration, court_id) tuples for available courts.
    Priority: try 2h across all slots, then 1.5h, then 1h, then 30min.
    Stops after finding max_courts for performance.
    """
    def check_slot(slot, dur):
        """Check a single slot/duration combination. Returns list of (slot, dur, court_id) tuples."""
        slot_dt = datetime.strptime(slot, "%H:%M")
        slot_24 = slot_dt.strftime("%H:%M:%S")
        slot_disp = slot_dt.strftime("%-I:%M:%S %p").replace(" 0", " ")

        end_dt = slot_dt + timedelta(minutes=dur)
        end_disp = end_dt.strftime("%-I:%M %p")

        try:
            if PINNED_COURT:
                courts = [{"Id": int(PINNED_COURT)}]
            else:
                courts = fetch_courts(sess, dur, slot_24, end_disp, date_disp)

            if courts:
                log(f"  ✅ Found {len(courts)} court(s) at {slot} for {dur}min", "32")
                return [(slot, dur, court["Id"]) for court in courts]
            else:
                log(f"  ❌ No courts at {slot} for {dur}min", "90")
        except Exception as e:
            log(f"  ⚠️  Error checking {slot} for {dur}min: {e}", "33")
        return []

    available = []

    for dur in priority_durations:
        log(f"🔍 Trying duration {dur} minutes across all time slots in parallel...", "33")

        # Check all slots in parallel for this duration
        with ThreadPoolExecutor(max_workers=len(time_slots)) as executor:
            futures = {executor.submit(check_slot, slot, dur): slot for slot in time_slots}

            for future in as_completed(futures):
                courts = future.result()
                available.extend(courts)

                # OPTIMIZATION: Stop early if we have enough courts
                if len(available) >= max_courts:
                    log(f"⚡ Found {len(available)} courts - stopping search for speed!", "32")
                    # Cancel remaining futures
                    for f in futures:
                        f.cancel()
                    return available[:max_courts]

        # If we found any courts at this duration, return them
        if available:
            log(f"Found {len(available)} total available slot(s) at {dur} minutes", "32")
            return available[:max_courts]

    return available

# ─── form scraping + posting ─────────────────────────────────────────────
def fetch_form(sess, date_disp, start_disp, end_guess):
    """
    Fetch the reservation form and extract hidden fields including CSRF token.
    Raises exception if required fields are missing (don't use die() in threads).
    """
    url = (f"https://app.courtreserve.com/Online/Reservations/CreateReservation/{ORG_ID}"
           f"?start={U.quote_plus(date_disp + ' ' + start_disp)}"
           f"&end={U.quote_plus(date_disp + ' ' + end_guess)}"
           f"&courtType=Pickleball&customSchedulerId={SCHED_ID}")

    log(f"📄 Fetching form from: {url}", "34")
    wrapper_resp = sess.get(url, headers={"X-Requested-With": "XMLHttpRequest"})
    wrapper_resp.raise_for_status()
    wrapper = wrapper_resp.text

    # Extract API URL from wrapper
    match = re.search(r"url:\s*fixUrl\('([^']+CreateReservation[^']+)'", wrapper)
    if not match:
        raise Exception("Could not find CreateReservation URL in wrapper")

    api_url = html.unescape(match[1])
    log(f"📄 Extracted API URL: {api_url}", "34")

    # Fetch the actual form
    form_resp = sess.get(api_url, headers={"Referer": url})
    form_resp.raise_for_status()

    soup = bs4.BeautifulSoup(form_resp.text, "lxml")
    hidden = {i["name"]: i.get("value", "") for i in soup.select("input[type=hidden]")
              if i.get("name")}

    log(f"📄 Found hidden fields: {list(hidden.keys())}", "34")

    # Validate required fields exist
    required_fields = ["__RequestVerificationToken", "Id", "OrgId", "Date"]
    missing_fields = [k for k in required_fields if k not in hidden]

    if missing_fields:
        raise Exception(f"Missing required hidden fields: {missing_fields}")

    return url, hidden

def submit(sess, payload):
    api = (f"https://reservations.courtreserve.com/Online/ReservationsApi/"
           f"CreateReservation/{ORG_ID}?uiCulture=en-US")
    r = sess.post(api,
                  headers={"X-Requested-With": "XMLHttpRequest",
                           "Referer": 'https://app.courtreserve.com/'},
                  data=payload)
    r.raise_for_status()
    j = r.json()
    if not j.get("isValid"):
        raise Exception(j.get("message") or str(j))
    log("🎾 reservation confirmed!", "32")
    return j

# 5️⃣ Session manager for accounts
class AccountSession:
    """Manages a session for a single account with automatic re-login on failures."""

    def __init__(self, account_info):
        self.account = account_info
        self.email = account_info["email"]
        self.password = account_info["password"]
        self.jar_path = account_info["cookie_jar"]
        self.session = None
        self.lock = threading.Lock()

    def ensure_logged_in(self, force_refresh=False):
        """
        Ensure the account is logged in. Re-login if necessary.
        If force_refresh=True, clear cookies and create fresh session.
        """
        with self.lock:
            if force_refresh or self.session is None:
                if force_refresh:
                    log(f"🔄 [{self.email}] Refreshing session (clearing cookies)...", "33")
                    # Delete cookie jar to force fresh login
                    if self.jar_path.exists():
                        self.jar_path.unlink()

                log(f"🔐 [{self.email}] Creating new session and logging in...", "33")
                self.session = build_session(self.jar_path)
                login(self.session, self.email, self.password)
                save_cookies(self.session, self.jar_path)

    def warm_up_session(self):
        """
        Warm up the session by making a test request to ensure cookies are valid.
        This helps prevent CSRF token issues during parallel booking.
        """
        with self.lock:
            if self.session is None:
                return

            try:
                # Make a simple request to verify session is active
                test_url = f"https://app.courtreserve.com/Online/Account/LogIn/{ORG_ID}"
                resp = self.session.get(test_url, allow_redirects=True)
                resp.raise_for_status()
                log(f"✅ [{self.email}] Session warmed up successfully", "32")
            except Exception as e:
                log(f"⚠️  [{self.email}] Session warm-up failed: {e}", "33")
                # Try to re-login if warm-up fails
                self.ensure_logged_in(force_refresh=True)

    def get_session(self):
        """Get the current session (ensure it's logged in first)."""
        self.ensure_logged_in()
        return self.session

# 6️⃣ Book a slot for a single account
def book_slot_for_account(account_session, slot_time, duration, court_id, date_disp):
    """
    Book a specific slot for a single account using its AccountSession.
    Returns True on success, False on failure.
    Automatically retries with re-login and session refresh on failures.
    """
    email = account_session.email
    max_retries = 3

    for attempt in range(1, max_retries + 1):
        try:
            # Get session (will auto-login if needed)
            sess = account_session.get_session()

            # Convert slot time to required formats
            slot_dt = datetime.strptime(slot_time, "%H:%M")
            slot_24 = slot_dt.strftime("%H:%M:%S")
            slot_disp = slot_dt.strftime("%-I:%M:%S %p").replace(" 0", " ")

            # Calculate end time locally (no API call)
            end_disp = calc_end_local(slot_time, duration)

            # Fetch form hidden inputs
            referer, hidden = fetch_form(sess, date_disp, slot_disp, end_disp)

            # Build payload
            payload = hidden | {
                "ReservationTypeId": "69707",
                "Duration": str(duration),
                "CourtId": str(court_id),
                "StartTime": slot_24,
                "EndTime": end_disp,
                "DisclosureAgree": "true"
            }

            # Submit booking
            submit(sess, payload)
            save_cookies(sess, account_session.jar_path)

            print(f"\033[32m✅ {email}: Booked court {court_id} at {slot_time} for {duration}min\033[0m")
            return True

        except Exception as e:
            error_str = str(e)

            # Check if error is "booking window not open yet" (not a real failure)
            if "only allowed to reserve up to" in error_str.lower():
                log(f"ℹ️  [{email}] Booking window not open yet: {error_str}", "36")
                print(f"\033[36mℹ️  {email}: Booking window not open yet (too far in advance)\033[0m")
                return False  # Don't retry, just treat as unavailable

            log(f"⚠️  [{email}] Attempt {attempt}/{max_retries} failed: {e}", "33")

            if attempt < max_retries:
                # Try re-login on first retry
                if attempt == 1:
                    log(f"🔄 [{email}] Retrying with re-login...", "33")
                    account_session.ensure_logged_in(force_refresh=False)
                # Try full session refresh on second retry
                elif attempt == 2:
                    log(f"🔄 [{email}] Retrying with full session refresh...", "33")
                    account_session.ensure_logged_in(force_refresh=True)
                time.sleep(1)  # Brief pause between retries
            else:
                print(f"\033[91m❌ {email}: Failed to book after {max_retries} attempts - {e}\033[0m")
                return False

    return False

# ─── main orchestration ──────────────────────────────────────────────────
if __name__ == "__main__":
    # In single-shot mode, only use the first account
    if SINGLE_SHOT:
        if not all([ACCOUNTS[0]["email"], ACCOUNTS[0]["password"]]):
            die("Single-shot mode: Need CR_EMAIL_1 and CR_PASSWORD_1 in environment")
        ACCOUNTS = [ACCOUNTS[0]]  # Use only first account
    else:
        # Validate all 3 accounts have credentials
        for i, account in enumerate(ACCOUNTS, 1):
            if not all([account["email"], account["password"]]):
                die(f"Account {i}: Need CR_EMAIL_{i} and CR_PASSWORD_{i} in environment")

    if not all([DATE, START]):
        die("Need CR_DATE and CR_START_TIME in environment")

    # Format date
    DATE_disp = datetime.strptime(DATE, "%Y-%m-%d").strftime("%m/%d/%Y")

    # Generate time slots around the base time
    time_slots = generate_time_slots(START)
    print(f"\033[36m🕐 Time slots to try (in priority order): {time_slots}\033[0m")

    # Priority durations: use CR_DURATION if specified, otherwise try all
    if DURATION:
        priority_durations = [int(DURATION)]
        print(f"\033[36m⏱️  Using specific duration: {DURATION} minutes\033[0m")
    else:
        priority_durations = [120, 90, 60, 30]
        print(f"\033[36m⏱️  Duration priority: {priority_durations} minutes\033[0m")

    # Initialize all account sessions upfront
    print(f"\n\033[33m🔐 Logging in all 3 accounts...\033[0m")
    account_sessions = []
    for i, account in enumerate(ACCOUNTS, 1):
        print(f"   Account {i} ({account['email']}): ", end="")
        acc_sess = AccountSession(account)
        try:
            acc_sess.ensure_logged_in()
            print(f"\033[32m✓\033[0m")
            account_sessions.append(acc_sess)
        except Exception as e:
            die(f"Failed to login account {i}: {e}")

    # Use first account for hunting
    hunt_session = account_sessions[0]

    # Warm up all sessions ONCE at startup (not in poll loop)
    if not SINGLE_SHOT:
        print(f"\n\033[33m🔥 Warming up all sessions...\033[0m")
        for acc_sess in account_sessions:
            acc_sess.warm_up_session()
        print(f"\033[32m✅ All sessions ready!\033[0m")

    # Polling loop - check at the top of every minute (:00)
    poll_count = 0
    if not SINGLE_SHOT:
        notify("🤖 CourtReserve bot started - polling for courts")
        print(f"\n\033[36m📡 Starting polling loop (checking at :00 of every minute)...\033[0m")

    while True:
        # Wait until next minute boundary (skip in single-shot mode)
        if not SINGLE_SHOT:
            wait_until_next_check()

        poll_count += 1
        now = datetime.now()
        now_str = now.strftime("%H:%M:%S")
        is_top_of_hour = now.second == 0 and now.minute == 0

        print(f"\n\033[36m🔍 Poll #{poll_count} at {now_str} - Searching for available courts...\033[0m")

        # At top of hour, try up to 5 times for better success rate
        max_attempts = 5 if is_top_of_hour else 1

        for attempt in range(1, max_attempts + 1):
            if attempt > 1:
                log(f"🔄 Retry {attempt}/{max_attempts} (top of hour)", "33")
                time.sleep(0.5)  # Brief pause between retries

            try:
                # Hunt for available courts using first account's session
                # Only need to find as many courts as we have accounts
                available_slots = hunt_available_slots(
                    hunt_session.get_session(),
                    time_slots,
                    DATE_disp,
                    priority_durations,
                    max_courts=len(account_sessions)
                )

                if available_slots:
                    break  # Found courts, exit retry loop

            except Exception as e:
                log(f"⚠️ Hunt attempt {attempt} failed: {e}", "33")
                if attempt == max_attempts:
                    raise  # Re-raise on last attempt

        try:

            if available_slots:
                print(f"\033[32m✅ Found {len(available_slots)} available court(s)!\033[0m")

                # Notify via ntfy.sh
                notify(f"🎾 Found {len(available_slots)} courts! Starting booking...")

                # Display what we found
                for slot, dur, court in available_slots:
                    print(f"   - Court {court} at {slot} for {dur}min")

                # Assign courts to accounts (up to 3 courts, one per account)
                assignments = []
                for i, (slot_time, duration, court_id) in enumerate(available_slots[:3]):
                    acc_sess = account_sessions[i]
                    assignments.append((acc_sess, slot_time, duration, court_id))

                print(f"\n\033[33m📋 Booking assignments:\033[0m")
                for acc_sess, slot_time, duration, court_id in assignments:
                    print(f"   {acc_sess.email}: Court {court_id} at {slot_time} for {duration}min")

                # Book in parallel
                print(f"\n\033[33m🚀 Starting parallel bookings...\033[0m")
                with ThreadPoolExecutor(max_workers=3) as executor:
                    futures = []
                    for acc_sess, slot_time, duration, court_id in assignments:
                        future = executor.submit(
                            book_slot_for_account,
                            acc_sess, slot_time, duration, court_id, DATE_disp
                        )
                        futures.append(future)

                    # Wait for all bookings to complete
                    results = [future.result() for future in as_completed(futures)]

                # Summary
                success_count = sum(results)
                print(f"\n\033[32m{'='*60}\033[0m")
                print(f"\033[32m🎉 Booking complete: {success_count}/{len(assignments)} successful\033[0m")
                print(f"\033[32m{'='*60}\033[0m")

                # Notify results
                if success_count > 0:
                    slots_booked = [f"{assignments[i][1]} ({assignments[i][2]}min)" for i, success in enumerate(results) if success]
                    notify(f"✅ Booked {success_count}/{len(assignments)} courts: {', '.join(slots_booked)}")
                else:
                    notify(f"⚠️ All {len(assignments)} booking attempts failed")

                break

            else:
                print(f"\033[90m❌ No courts available yet\033[0m")
                if SINGLE_SHOT:
                    break  # Exit after one attempt in single-shot mode

        except Exception as e:
            print(f"\033[33m⚠️  Error during polling: {e}\033[0m")
            log(f"Attempting to re-login hunting account...", "33")
            try:
                hunt_session.ensure_logged_in(force_refresh=False)
            except Exception as login_err:
                print(f"\033[91m❌ Failed to re-login: {login_err}\033[0m")

            if SINGLE_SHOT:
                break  # Exit after one attempt in single-shot mode