#!/usr/bin/env python3
"""
CourtReserve auto-booking script for Sunnyvale venue
Uses ReadConsolidated API and trial-and-error booking approach
OPTIMIZED for maximum speed
"""

import html, re, os, sys, json, urllib.parse as U, time, threading
from datetime import datetime, timedelta
from pathlib import Path
from http.cookiejar import MozillaCookieJar
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests, bs4, http.cookiejar as cj
from dotenv import load_dotenv
load_dotenv()

# ─── configuration ────────────────────────────────────────────────────
ORG_ID   = os.getenv("CR_ORG_ID",       "13233")
SCHED_ID = os.getenv("CR_SCHEDULER_ID", "16984")
RESERVATION_TYPE_ID = os.getenv("CR_RESERVATION_TYPE_ID", "69707")  # Recreational Play - Pickleball

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

DEBUG      = os.getenv("DEBUG") == "1"
UA         = "Mozilla/5.0 CourtReserveAuto/2.0 (+https://github.com)"
NTFY_TOPIC = "courtreserve-sunnyvale"  # ntfy.sh notification topic

# ─── helpers ──────────────────────────────────────────────────────────
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

def get_pacific_utc_offset(date_obj):
    """
    Get UTC offset for Pacific timezone on a given date.
    Returns -7 for PDT (daylight saving) or -8 for PST (standard time).

    Daylight saving in US: Second Sunday in March to First Sunday in November
    """
    year = date_obj.year
    month = date_obj.month
    day = date_obj.day

    # Daylight saving starts: Second Sunday in March
    march_1 = datetime(year, 3, 1)
    days_until_sunday = (6 - march_1.weekday()) % 7
    second_sunday_march = 1 + days_until_sunday + 7
    dst_start = datetime(year, 3, second_sunday_march, 2, 0, 0)

    # Daylight saving ends: First Sunday in November
    nov_1 = datetime(year, 11, 1)
    days_until_sunday = (6 - nov_1.weekday()) % 7
    first_sunday_nov = 1 + days_until_sunday
    dst_end = datetime(year, 11, first_sunday_nov, 2, 0, 0)

    # Check if date is in daylight saving period
    current = datetime(year, month, day)
    if dst_start <= current < dst_end:
        return -7  # PDT (Pacific Daylight Time)
    else:
        return -8  # PST (Pacific Standard Time)

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
    Wait until the next check time (top of every 5 minutes: XX:00, XX:05, XX:10, etc).
    Precise to the exact second for maximum speed.
    """
    now = datetime.now()

    # Calculate next 5-minute boundary (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
    current_minute = now.minute
    current_5min_slot = (current_minute // 5) * 5  # Round down to current 5-min slot
    next_5min_slot = current_5min_slot + 5  # Next 5-min slot

    # Build the next check time
    if next_5min_slot >= 60:
        next_check = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    else:
        next_check = now.replace(minute=next_5min_slot, second=0, microsecond=0)

    # If we've already passed this time (edge case), add 5 minutes
    if next_check <= now:
        next_check = next_check + timedelta(minutes=5)

    # Calculate exact sleep time
    sleep_duration = (next_check - now).total_seconds()

    if sleep_duration > 0:
        log(f"⏳ Waiting {sleep_duration:.3f}s until next check time...", "90")
        time.sleep(sleep_duration)

# ─── CourtReserve API wrappers ────────────────────────────────────────
def api_get(sess, url, **kw):
    log(f"⟳ GET {url}", "34")
    r = sess.get(url, **kw)
    r.raise_for_status()
    return r.json()

def api_post(sess, url, **kw):
    log(f"⟳ POST {url}", "34")
    r = sess.post(url, **kw)
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

# 1️⃣ Get all available slots using ReadConsolidated API
def fetch_consolidated_slots(sess, date_str):
    """
    Fetch all available slots for the day using ReadConsolidated API.
    Returns list of slots with their available court IDs.
    """
    # Convert date to required format
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    date_disp = date_obj.strftime("%m/%d/%Y")

    # Build startDate in local timezone (API expects this format)
    start_date_utc = date_obj.replace(hour=5, minute=48, second=6).isoformat() + ".000Z"

    url = f"https://app.courtreserve.com/Online/Reservations/ReadConsolidated/{ORG_ID}"

    json_data = {
        "startDate": start_date_utc,
        "orgId": ORG_ID,
        "TimeZone": "America/Los_Angeles",
        "Date": f"{date_obj.strftime('%a, %d %b %Y')} 05:48:06 GMT",
        "KendoDate": {
            "Year": date_obj.year,
            "Month": date_obj.month,
            "Day": date_obj.day
        },
        "UiCulture": "en-US",
        "CostTypeId": "141158",
        "CustomSchedulerId": SCHED_ID,
        "ReservationMinInterval": "60"
    }

    data = f"sort=&group=&filter=&jsonData={U.quote(json.dumps(json_data))}"

    r = sess.post(url,
                  headers={
                      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                      "X-Requested-With": "XMLHttpRequest"
                  },
                  data=data)
    r.raise_for_status()
    result = r.json()

    return result.get("Data", [])

# 2️⃣ Hunt for available slots across time slots and durations
def hunt_available_slots(sess, time_slots, date_str, priority_durations=[120, 90, 60, 30], max_slots=3):
    """
    Hunt for available slots by trying durations in priority order across all time slots.
    Returns a list of (slot_time, duration, available_courts_count) tuples.

    Logic: Greedy algorithm that collects booking opportunities until we have enough
    total courts for all accounts. For example:
    - Find 2 courts at 20:00 for 120min → book 2 accounts there
    - Find 8 courts at 18:00 for 90min → book remaining 1 account there

    Priority: try 2h across all slots, then 1.5h, then 1h, then 30min.
    Collects slots until total court count >= max_slots.
    """
    # Get all consolidated data in one API call
    all_slots = fetch_consolidated_slots(sess, date_str)

    # Get the UTC offset for this date (handles PST/PDT automatically)
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    utc_offset = get_pacific_utc_offset(date_obj)

    # Build a lookup map: time -> set of available court IDs
    slots_map = {}
    for slot in all_slots:
        # Parse the time from the slot ID (format: "Pickleball10/16/2025 15:00:00")
        match = re.search(r'(\d{1,2}):(\d{2}):(\d{2})', slot.get("Id", ""))
        if match:
            hour = int(match.group(1))
            minute = int(match.group(2))

            # Convert from UTC to Pacific time (PST/PDT)
            hour_pacific = (hour + utc_offset) % 24

            slot_time = f"{hour_pacific:02d}:{minute:02d}"
            court_ids = slot.get("AvailableCourtIds", [])
            slots_map[slot_time] = set(court_ids)  # Use set for intersection operations

    available = []
    total_courts_found = 0
    used_courts_by_time = {}  # Track which courts are already claimed for each time slot

    # Try each duration across all time slots
    for dur in priority_durations:
        log(f"🔍 Trying duration {dur} minutes across all time slots...", "33")

        for slot in time_slots:
            # Check if slot exists in the map
            if slot not in slots_map:
                log(f"  ❌ No data for {slot}", "90")
                continue

            # Calculate all intermediate 30-min slots needed for this duration
            slot_dt = datetime.strptime(slot, "%H:%M")
            required_slots = []
            for offset in range(0, dur, 30):
                check_time = (slot_dt + timedelta(minutes=offset)).strftime("%H:%M")
                required_slots.append(check_time)

            # Check if all required slots have data
            missing_slots = [t for t in required_slots if t not in slots_map]
            if missing_slots:
                log(f"  ❌ Missing time slot data at {slot} for {dur}min (missing: {missing_slots})", "90")
                continue

            # Find intersection of court IDs across all required slots
            # Start with the first slot's courts
            available_courts = slots_map[required_slots[0]].copy()

            # Intersect with each subsequent slot
            for check_time in required_slots[1:]:
                available_courts &= slots_map[check_time]

            # CRITICAL: Remove courts that are already used during ANY of the required time slots
            for req_slot in required_slots:
                if req_slot in used_courts_by_time:
                    available_courts -= used_courts_by_time[req_slot]

            court_count = len(available_courts)

            if court_count > 0:
                log(f"  ✅ Found {court_count} NEW court(s) at {slot} for {dur}min (courts: {sorted(available_courts)})", "32")
                available.append((slot, dur, court_count))
                total_courts_found += court_count

                # Mark these courts as used for ALL required time slots
                for req_slot in required_slots:
                    if req_slot not in used_courts_by_time:
                        used_courts_by_time[req_slot] = set()
                    used_courts_by_time[req_slot].update(available_courts)
                    log(f"    → Marked {len(available_courts)} court(s) as used for {req_slot}", "90")

                # Stop if we have enough total booking opportunities
                if total_courts_found >= max_slots:
                    log(f"⚡ Collected {total_courts_found} total NEW courts (need {max_slots}) - done!", "32")
                    return available
            else:
                log(f"  ❌ No new courts available at {slot} for {dur}min (all already used)", "90")

    # Return whatever we found (might be insufficient)
    if available:
        log(f"Found {len(available)} slot(s) with {total_courts_found} total NEW courts (need {max_slots})", "33")
    return available

# ─── Session manager for accounts ────────────────────────────────────
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

# 3️⃣ Book a slot for a single account (trial and error approach)
def book_slot_for_account(account_session, slot_time, duration, date_str):
    """
    Attempt to book a specific slot for a single account.
    Returns True on success, False on failure.
    Uses trial-and-error: booking may fail even if courts appear available.
    """
    email = account_session.email
    max_retries = 3

    # Convert formats
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    date_disp = date_obj.strftime("%m/%d/%Y")

    slot_dt = datetime.strptime(slot_time, "%H:%M")
    start_24 = slot_dt.strftime("%H:%M:%S")
    start_disp = slot_dt.strftime("%-I:%M %p").lstrip('0')

    end_dt = slot_dt + timedelta(minutes=duration)
    end_disp = end_dt.strftime("%-I:%M %p").lstrip('0')

    for attempt in range(1, max_retries + 1):
        try:
            sess = account_session.get_session()

            # Step 1: Get the create reservation page to extract hidden fields
            create_url = (f"https://app.courtreserve.com/Online/Reservations/CreateReservation/{ORG_ID}"
                         f"?start={U.quote_plus(date_disp + ' ' + start_disp)}"
                         f"&end={U.quote_plus(date_disp + ' ' + end_disp)}"
                         f"&courtType=Pickleball&customSchedulerId={SCHED_ID}")

            log(f"[{email}] Fetching create reservation page...", "34")
            wrapper_resp = sess.get(create_url, headers={"X-Requested-With": "XMLHttpRequest"})
            wrapper_resp.raise_for_status()

            # Extract the actual form URL from the wrapper
            match = re.search(r"url:\s*fixUrl\('([^']+CreateReservation[^']+)'\)", wrapper_resp.text)
            if not match:
                raise Exception("Could not find CreateReservation URL")

            form_url = html.unescape(match.group(1))
            log(f"[{email}] Form URL: {form_url}", "34")

            # Fetch the actual form
            form_resp = sess.get(form_url, headers={"Referer": create_url})
            form_resp.raise_for_status()

            # Parse hidden fields
            soup = bs4.BeautifulSoup(form_resp.text, "lxml")
            hidden = {i["name"]: i.get("value", "") for i in soup.select("input[type=hidden]") if i.get("name")}

            # Verify we have the CSRF token
            if "__RequestVerificationToken" not in hidden:
                raise Exception("Missing __RequestVerificationToken")

            log(f"[{email}] Extracted {len(hidden)} hidden fields", "34")

            # Step 2: Submit the booking
            submit_url = f"https://reservations.courtreserve.com/Online/ReservationsApi/CreateReservation/{ORG_ID}?uiCulture=en-US"

            # Build payload (based on the curl example)
            payload = {
                **hidden,  # Include all hidden fields
                "ReservationTypeId": RESERVATION_TYPE_ID,
                "Duration": str(duration),
                "StartTime": start_24,
                "DisclosureAgree": "true"
            }

            log(f"[{email}] Submitting booking...", "34")
            book_resp = sess.post(submit_url,
                                 headers={
                                     "X-Requested-With": "XMLHttpRequest",
                                     "Referer": "https://app.courtreserve.com/",
                                     "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                                 },
                                 data=payload)
            book_resp.raise_for_status()

            result = book_resp.json()

            if result.get("isValid"):
                save_cookies(sess, account_session.jar_path)
                print(f"\033[32m✅ {email}: Booked at {slot_time} for {duration}min\033[0m")
                return True
            else:
                error_msg = result.get("message", "Unknown error")

                # Check if error is "booking window not open yet" (not a real failure)
                if "only allowed to reserve up to" in error_msg.lower():
                    log(f"ℹ️  [{email}] Booking window not open yet: {error_msg}", "36")
                    print(f"\033[36mℹ️  {email}: Booking window not open yet (too far in advance)\033[0m")
                    return False  # Don't retry, just treat as unavailable

                raise Exception(f"Booking failed: {error_msg}")

        except Exception as e:
            error_str = str(e)

            # Check if error is "booking window not open yet" (not a real failure)
            if "only allowed to reserve up to" in error_str.lower():
                log(f"ℹ️  [{email}] Booking window not open yet: {error_str}", "36")
                print(f"\033[36mℹ️  {email}: Booking window not open yet (too far in advance)\033[0m")
                return False  # Don't retry, just treat as unavailable

            log(f"⚠️  [{email}] Attempt {attempt}/{max_retries} failed: {e}", "33")

            if attempt < max_retries:
                if attempt == 1:
                    log(f"🔄 [{email}] Retrying with re-login...", "33")
                    account_session.ensure_logged_in(force_refresh=False)
                elif attempt == 2:
                    log(f"🔄 [{email}] Retrying with full session refresh...", "33")
                    account_session.ensure_logged_in(force_refresh=True)
                time.sleep(1)
            else:
                print(f"\033[91m❌ {email}: Failed after {max_retries} attempts - {e}\033[0m")
                return False

    return False

# ─── main orchestration ──────────────────────────────────────────────
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

    # Polling loop - check at the top of every 5 minutes (:00, :05, :10, etc.)
    poll_count = 0
    last_session_refresh = datetime.now()
    SESSION_REFRESH_INTERVAL = timedelta(minutes=20)  # Refresh sessions every 20 minutes

    if not SINGLE_SHOT:
        notify("🤖 CourtReserve bot started - polling for courts")
        print(f"\n\033[36m📡 Starting polling loop (checking every 5 minutes at :00, :05, :10, etc.)...\033[0m")

    while True:
        # Wait until next 5-minute boundary (skip in single-shot mode)
        if not SINGLE_SHOT:
            wait_until_next_check()

        poll_count += 1
        now = datetime.now()
        now_str = now.strftime("%H:%M:%S")
        is_top_of_hour = now.second == 0 and now.minute == 0

        # Proactive session refresh every 20 minutes to prevent stale connections
        if now - last_session_refresh > SESSION_REFRESH_INTERVAL:
            print(f"\n\033[33m🔄 Refreshing all sessions (20min interval)...\033[0m")
            for acc_sess in account_sessions:
                try:
                    acc_sess.warm_up_session()
                except Exception as e:
                    log(f"⚠️  Failed to refresh {acc_sess.email}: {e}", "33")
            last_session_refresh = now
            print(f"\033[32m✅ All sessions refreshed\033[0m")

        print(f"\n\033[36m🔍 Poll #{poll_count} at {now_str} - Searching for available courts...\033[0m")

        # At top of hour, try up to 5 times for better success rate
        max_attempts = 5 if is_top_of_hour else 1

        for attempt in range(1, max_attempts + 1):
            if attempt > 1:
                log(f"🔄 Retry {attempt}/{max_attempts} (top of hour)", "33")
                time.sleep(0.5)  # Brief pause between retries

            try:
                # Hunt for available courts using first account's session
                # Only need to find as many slots as we have accounts
                available_slots = hunt_available_slots(
                    hunt_session.get_session(),
                    time_slots,
                    DATE,
                    priority_durations,
                    max_slots=len(account_sessions)
                )

                if available_slots:
                    break  # Found courts, exit retry loop

            except (requests.exceptions.ConnectionError,
                    requests.exceptions.ChunkedEncodingError,
                    ConnectionResetError) as conn_err:
                # Connection errors - refresh session and retry
                print(f"\033[33m⚠️  Connection error: {conn_err}\033[0m")
                log(f"🔄 Refreshing hunt session due to connection error...", "33")
                try:
                    hunt_session.ensure_logged_in(force_refresh=True)
                    print(f"\033[32m✅ Hunt session refreshed\033[0m")
                except Exception as refresh_err:
                    print(f"\033[91m❌ Failed to refresh session: {refresh_err}\033[0m")

                if attempt == max_attempts:
                    print(f"\033[33m⚠️  Max retry attempts reached. Will try again on next poll.\033[0m")
                    available_slots = []  # Set to empty to continue polling

            except Exception as e:
                log(f"⚠️ Hunt attempt {attempt} failed: {e}", "33")
                if attempt == max_attempts:
                    print(f"\033[33m⚠️  Hunt failed after {max_attempts} attempts. Will try again on next poll.\033[0m")
                    available_slots = []  # Set to empty to continue polling

        try:
            if available_slots:
                # print(f"\033[32m✅ Found {len(available_slots)} available slot(s)!\033[0m")

                # # Notify via ntfy.sh
                # notify(f"🎾 Found {len(available_slots)} courts! Starting booking...")

                # Display what we found
                for slot, dur, count in available_slots:
                    print(f"   - {count} court(s) at {slot} for {dur}min")

                # Greedy assignment: assign accounts to slots in priority order
                # Example: 2 courts at 20:00 (120min) → accounts 1&2
                #          8 courts at 18:00 (90min) → account 3
                assignments = []
                account_idx = 0

                for slot_time, duration, court_count in available_slots:
                    # How many accounts can we book at this slot?
                    accounts_to_assign = min(court_count, len(account_sessions) - account_idx)

                    for _ in range(accounts_to_assign):
                        if account_idx < len(account_sessions):
                            assignments.append((account_sessions[account_idx], slot_time, duration))
                            account_idx += 1

                    # Stop if all accounts have been assigned
                    if account_idx >= len(account_sessions):
                        break

                # Display booking plan
                print(f"\n\033[33m📋 Booking assignments:\033[0m")
                for acc_sess, slot_time, duration in assignments:
                    print(f"   {acc_sess.email}: {slot_time} for {duration}min")

                # Book all accounts in parallel
                print(f"\n\033[33m🚀 Starting parallel bookings...\033[0m")

                with ThreadPoolExecutor(max_workers=len(assignments)) as executor:
                    futures = []

                    for acc_sess, slot_time, duration in assignments:
                        future = executor.submit(
                            book_slot_for_account,
                            acc_sess, slot_time, duration, DATE
                        )
                        futures.append(future)

                    # Wait for all bookings to complete
                    results = [future.result() for future in as_completed(futures)]
                    booking_success = results

                # Summary
                success_count = sum(booking_success)
                print(f"\n\033[32m{'='*60}\033[0m")
                print(f"\033[32m🎉 Booking complete: {success_count}/{len(assignments)} successful\033[0m")
                print(f"\033[32m{'='*60}\033[0m")

                # Notify results with detailed slot info
                if success_count > 0:
                    slot_summary = ", ".join([f"{assignments[i][1]} ({assignments[i][2]}min)"
                                             for i, success in enumerate(results) if success])
                    notify(f"✅ Booked {success_count}/{len(assignments)} courts: {slot_summary}")
                    # At least one booking succeeded
                    break
                else:
                    # notify(f"⚠️ All {len(account_sessions)} booking attempts failed - courts may be taken")
                    print(f"\033[33m⚠️  All bookings failed (courts may have been taken). Continuing to poll...\033[0m")
                    if SINGLE_SHOT:
                        break  # Exit after one attempt in single-shot mode

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
