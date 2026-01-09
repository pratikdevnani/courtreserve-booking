/**
 * CourtReserve API methods
 * With extensive logging for debugging
 */

import {
  API_DOMAINS,
  CancelReservationResponse,
  Court,
  CreateReservationResponse,
  DurationOption,
  LoginResponse,
  ReservationFormData,
  UI_CULTURE,
  USER_AGENT,
  VenueConfig,
} from './types';
import {
  addSeconds,
  calculateEndTime,
  formatDate,
  formatDateMidnight,
  formatDateTime,
  to12HourWithSeconds,
} from './time-utils';
import { CookieManager } from './auth';
import { createLogger } from '../logger';
import { decodeHTML } from 'entities';
import * as cheerio from 'cheerio';

const log = createLogger('CourtReserve:API');

export interface ApiClientConfig {
  venue: VenueConfig;
  cookieManager: CookieManager;
}

/**
 * Fetch with cookie management and logging
 */
async function fetchWithCookies(
  url: string,
  cookieManager: CookieManager,
  options: RequestInit = {},
  depth: number = 0
): Promise<Response> {
  const requestId = Math.random().toString(36).substring(7);
  const method = options.method || 'GET';

  log.trace(`[${requestId}] Starting request`, { method, url, depth });

  const headers = new Headers(options.headers);

  // Set User-Agent
  headers.set('User-Agent', USER_AGENT);

  // Attach cookies
  const cookieCount = cookieManager.getAllCookies().length;
  if (cookieManager.hasCookies()) {
    const cookieString = cookieManager.serializeCookies();
    headers.set('Cookie', cookieString);
    log.trace(`[${requestId}] Attaching ${cookieCount} cookies`, {
      cookiePreview: cookieString.substring(0, 100) + '...',
    });
  } else {
    log.trace(`[${requestId}] No cookies to attach`);
  }

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      redirect: 'manual', // Handle redirects manually to capture cookies
    });

    const elapsed = Date.now() - startTime;
    log.debug(`[${requestId}] Response received`, {
      status: response.status,
      statusText: response.statusText,
      elapsed: `${elapsed}ms`,
    });

    // Handle redirects
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        log.debug(`[${requestId}] Following redirect to: ${location}`);
        // Store cookies from redirect
        cookieManager.parseSetCookies(response.headers);
        // Follow redirect (with depth limit)
        if (depth > 5) {
          throw new Error('Too many redirects');
        }
        return fetchWithCookies(location, cookieManager, options, depth + 1);
      }
    }

    // Store cookies from response
    const setCookieHeaders = response.headers.getSetCookie();
    if (setCookieHeaders.length > 0) {
      log.trace(`[${requestId}] Received ${setCookieHeaders.length} Set-Cookie headers`);
      cookieManager.parseSetCookies(response.headers);
    }

    return response;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    log.error(`[${requestId}] Request failed after ${elapsed}ms`, {
      error: error instanceof Error ? error.message : String(error),
      url,
      method,
    });
    throw error;
  }
}

/**
 * Initialize session by visiting login page
 */
export async function initializeSession(config: ApiClientConfig): Promise<void> {
  log.info('Initializing session', { venue: config.venue.name, orgId: config.venue.orgId });

  const url = `${API_DOMAINS.main}/Online/Account/LogIn/${config.venue.orgId}`;
  log.debug('Fetching login page to establish session', { url });

  const startTime = Date.now();
  await fetchWithCookies(url, config.cookieManager);
  const elapsed = Date.now() - startTime;

  const cookieCount = config.cookieManager.getAllCookies().length;
  log.info('Session initialized', { elapsed: `${elapsed}ms`, cookiesObtained: cookieCount });
  log.trace('Session cookies', { cookies: config.cookieManager.getAllCookies().map((c) => c.name) });
}

/**
 * Login to CourtReserve
 */
export async function login(
  config: ApiClientConfig,
  email: string,
  password: string
): Promise<LoginResponse> {
  log.info('Attempting login', { email, venue: config.venue.name });

  const url = `${API_DOMAINS.main}/Online/Account/Login?id=${config.venue.orgId}`;

  const requestBody = {
    IsApiCall: true,
    UserNameOrEmail: email,
    Password: '***REDACTED***', // Don't log actual password
  };
  log.debug('Login request', { url, body: requestBody });

  const startTime = Date.now();

  const response = await fetchWithCookies(url, config.cookieManager, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: `${API_DOMAINS.main}/Online/Account/LogIn/${config.venue.orgId}`,
      reactsubmit: 'true',
    },
    body: JSON.stringify({
      IsApiCall: true,
      UserNameOrEmail: email,
      Password: password,
    }),
  });

  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    log.error('Login HTTP error', { status: response.status, statusText: response.statusText });
    throw new Error(`Login failed: ${response.status} ${response.statusText}`);
  }

  const data: LoginResponse = await response.json();
  log.debug('Login response', { isValid: data.IsValid, elapsed: `${elapsed}ms` });

  if (data.IsValid) {
    log.info('Login successful', { email, elapsed: `${elapsed}ms` });
  } else {
    log.warn('Login failed - invalid credentials', { email, message: data.Message });
  }

  return data;
}

/**
 * Get available durations for a time slot
 */
export async function getAvailableDurations(
  config: ApiClientConfig,
  date: Date | string,
  startTime: string
): Promise<DurationOption[]> {
  const formattedDate = formatDate(date);
  const displayTime = to12HourWithSeconds(startTime);
  const endTime = calculateEndTime(startTime, 120);

  log.debug('Getting available durations', { date: formattedDate, startTime, displayTime });

  const params = new URLSearchParams({
    id: config.venue.orgId,
    reservationTypeId: config.venue.reservationTypeId,
    startTime: displayTime,
    selectedDate: formattedDate,
    uiCulture: UI_CULTURE,
    useMinTimeAsDefault: 'False',
    courtId: '',
    courtType: config.venue.courtType.toString(),
    endTime: endTime,
    isDynamicSlot: 'False',
    customSchedulerId: config.venue.schedulerId,
  });

  const url = `${API_DOMAINS.api}/api/v1/portalreservationsapi/GetDurationDropdown?${params}`;
  log.trace('Duration dropdown URL', { url });

  const startTimeMs = Date.now();
  const response = await fetchWithCookies(url, config.cookieManager);
  const elapsed = Date.now() - startTimeMs;

  if (!response.ok) {
    log.error('Get durations failed', { status: response.status });
    throw new Error(`Get durations failed: ${response.status}`);
  }

  const data: DurationOption[] = await response.json();
  const availableDurations = data.filter((d) => !d.disabled).map((d) => d.value);

  log.debug('Available durations retrieved', {
    total: data.length,
    available: availableDurations.length,
    durations: availableDurations,
    elapsed: `${elapsed}ms`,
  });

  return data;
}

/**
 * Get available courts for a specific date using ReadConsolidated API
 */
export async function getAvailableCourts(
  config: ApiClientConfig,
  date: Date | string,
  startTime: string,
  duration: number
): Promise<Court[]> {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  log.debug('Getting available courts via ReadConsolidated', {
    date: dateObj.toISOString(),
    startTime,
    duration,
    venue: config.venue.name,
  });

  // Build startDate in UTC format
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  const startDateUtc = new Date(Date.UTC(year, month, day, 8, 0, 0)).toISOString();

  // Format date string for API
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${dayNames[dateObj.getDay()]}, ${day.toString().padStart(2, '0')} ${monthNames[month]} ${year} 08:00:00 GMT`;

  const jsonData = {
    startDate: startDateUtc,
    orgId: config.venue.orgId,
    TimeZone: 'America/Los_Angeles',
    Date: dateStr,
    KendoDate: { Year: year, Month: month + 1, Day: day },
    UiCulture: 'en-US',
    CostTypeId: config.venue.costTypeId,
    CustomSchedulerId: config.venue.schedulerId,
    ReservationMinInterval: config.venue.reservationMinInterval,
  };

  const formBody = `sort=&group=&filter=&jsonData=${encodeURIComponent(JSON.stringify(jsonData))}`;
  const url = `${API_DOMAINS.main}/Online/Reservations/ReadConsolidated/${config.venue.orgId}`;

  log.trace('ReadConsolidated request', { url, jsonData });

  const startTimeMs = Date.now();
  const response = await fetchWithCookies(url, config.cookieManager, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${API_DOMAINS.main}/Online/Reservations/Bookings/${config.venue.orgId}?sId=${config.venue.schedulerId}`,
    },
    body: formBody,
  });

  const elapsed = Date.now() - startTimeMs;

  if (!response.ok) {
    log.error('ReadConsolidated failed', { status: response.status });
    throw new Error(`ReadConsolidated failed: ${response.status}`);
  }

  const result = await response.json();
  const slots = result.Data || [];

  // Parse response: extract courts available at the requested time
  const courts = parseConsolidatedSlots(slots, startTime, duration, dateObj);

  log.info('Available courts retrieved', {
    count: courts.length,
    courts: courts.map((c) => ({ id: c.id, name: c.name })),
    elapsed: `${elapsed}ms`,
  });

  if (courts.length === 0) {
    log.debug('No courts available for this time slot');
  }

  return courts;
}

/**
 * Parse consolidated slots to find available courts for a specific time/duration
 */
function parseConsolidatedSlots(
  slots: Array<{ Id: string; AvailableCourtIds?: number[] }>,
  startTime: string,
  duration: number,
  dateObj: Date
): Court[] {
  // Build a map of time slot -> available court IDs
  const slotsMap: Map<string, Set<number>> = new Map();

  // Pacific timezone offset (PST=-8, PDT=-7)
  const utcOffset = isPDT(dateObj) ? -7 : -8;

  for (const slot of slots) {
    // Parse time from slot ID (format: "Pickleball01/14/2026 15:00:00")
    const match = slot.Id?.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) continue;

    const utcHour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);

    // Convert UTC to Pacific time
    const pacificHour = (utcHour + utcOffset + 24) % 24;
    const slotTime = `${pacificHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    const courtIds = slot.AvailableCourtIds || [];
    slotsMap.set(slotTime, new Set(courtIds));
  }

  // Find courts available for the entire duration
  const startDt = parseTime(startTime);
  const requiredSlots: string[] = [];

  for (let offset = 0; offset < duration; offset += 30) {
    const checkTime = new Date(startDt.getTime() + offset * 60000);
    const slotStr = `${checkTime.getHours().toString().padStart(2, '0')}:${checkTime.getMinutes().toString().padStart(2, '0')}`;
    requiredSlots.push(slotStr);
  }

  // Find intersection of courts across all required slots
  let availableCourts: Set<number> | null = null;

  for (const slot of requiredSlots) {
    const slotCourts = slotsMap.get(slot);
    if (!slotCourts || slotCourts.size === 0) {
      return []; // No courts available for this slot
    }

    if (availableCourts === null) {
      availableCourts = new Set(slotCourts);
    } else {
      // Intersect with previous slots
      const intersection = new Set<number>();
      for (const courtId of availableCourts) {
        if (slotCourts.has(courtId)) {
          intersection.add(courtId);
        }
      }
      availableCourts = intersection;
    }
  }

  // Convert to Court objects
  return Array.from(availableCourts || []).map((id) => ({ id, name: `Court ${id}` }));
}

function parseTime(timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function isPDT(date: Date): boolean {
  // DST in US: Second Sunday March to First Sunday November
  const year = date.getFullYear();
  const march = new Date(year, 2, 1);
  const nov = new Date(year, 10, 1);

  // Second Sunday in March
  const marchSunday = 8 + (7 - march.getDay()) % 7;
  const dstStart = new Date(year, 2, marchSunday, 2);

  // First Sunday in November
  const novSunday = 1 + (7 - nov.getDay()) % 7;
  const dstEnd = new Date(year, 10, novSunday, 2);

  return date >= dstStart && date < dstEnd;
}

/**
 * Fetch reservation form to get CSRF token and hidden fields
 */
export async function fetchReservationForm(
  config: ApiClientConfig,
  date: Date | string,
  startTime: string,
  duration: number
): Promise<ReservationFormData> {
  const endTime12 = calculateEndTime(startTime, duration);
  const startDateTime = formatDateTime(date, startTime);
  const endDateTime = `${formatDate(date)} ${endTime12}`;

  log.debug('Fetching reservation form', {
    date: formatDate(date),
    startTime,
    duration,
    startDateTime,
    endDateTime,
  });

  const params = new URLSearchParams({
    start: startDateTime,
    end: endDateTime,
    courtType: 'Pickleball',
    customSchedulerId: config.venue.schedulerId,
  });

  // Step 1: Get wrapper HTML
  const wrapperUrl = `${API_DOMAINS.main}/Online/Reservations/CreateReservation/${config.venue.orgId}?${params}`;
  log.trace('Fetching form wrapper', { url: wrapperUrl });

  const wrapperStartTime = Date.now();
  const wrapperResponse = await fetchWithCookies(wrapperUrl, config.cookieManager, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!wrapperResponse.ok) {
    log.error('Fetch form wrapper failed', { status: wrapperResponse.status });
    throw new Error(`Fetch form wrapper failed: ${wrapperResponse.status}`);
  }

  const wrapperHtml = await wrapperResponse.text();
  log.trace('Form wrapper received', {
    length: wrapperHtml.length,
    elapsed: `${Date.now() - wrapperStartTime}ms`,
  });

  // Extract API URL from wrapper
  const urlMatch = wrapperHtml.match(/url:\s*fixUrl\('([^']+CreateReservation[^']+)'/);
  if (!urlMatch) {
    log.error('Could not extract form API URL from wrapper');
    log.trace('Wrapper HTML preview', { html: wrapperHtml.substring(0, 500) });
    throw new Error('Could not extract form API URL from wrapper');
  }

  let formApiUrl = decodeHTML(urlMatch[1]);
  if (formApiUrl.startsWith('/')) {
    formApiUrl = `${API_DOMAINS.main}${formApiUrl}`;
  }
  log.debug('Extracted form API URL', { url: formApiUrl });

  // Step 2: Get actual form HTML
  log.trace('Fetching actual form');
  const formStartTime = Date.now();
  const formResponse = await fetchWithCookies(formApiUrl, config.cookieManager, {
    headers: {
      Referer: wrapperUrl,
    },
  });

  if (!formResponse.ok) {
    log.error('Fetch form failed', { status: formResponse.status });
    throw new Error(`Fetch form failed: ${formResponse.status}`);
  }

  const formHtml = await formResponse.text();
  log.trace('Form HTML received', {
    length: formHtml.length,
    elapsed: `${Date.now() - formStartTime}ms`,
  });

  // Parse form fields
  const formData: ReservationFormData = {
    __RequestVerificationToken: '',
    Id: '',
    OrgId: config.venue.orgId,
    Date: formatDate(date),
  };

  // Extract hidden fields using cheerio
  const $ = cheerio.load(formHtml);
  let fieldCount = 0;

  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    const value = $(el).attr('value') || '';
    if (name) {
      formData[name] = value;
      fieldCount++;
    }
  });

  log.debug('Parsed form fields', {
    fieldCount,
    hasCSRFToken: !!formData.__RequestVerificationToken,
  });
  log.trace('Form field names', { fields: Object.keys(formData) });

  if (!formData.__RequestVerificationToken) {
    log.error('Could not find CSRF token in form');
    log.trace('Form HTML preview', { html: formHtml.substring(0, 1000) });
    throw new Error('Could not find CSRF token in form');
  }

  return formData;
}

/**
 * Submit a court reservation
 */
export async function createReservation(
  config: ApiClientConfig,
  date: Date | string,
  startTime: string,
  duration: number,
  courtId: number
): Promise<CreateReservationResponse> {
  log.info('Creating reservation', {
    venue: config.venue.name,
    date: formatDate(date),
    startTime,
    duration,
    courtId,
  });

  // Get form data with CSRF token
  log.debug('Fetching form data with CSRF token');
  const formStartTime = Date.now();
  const formData = await fetchReservationForm(config, date, startTime, duration);
  log.debug('Form data obtained', { elapsed: `${Date.now() - formStartTime}ms` });

  const endTime12 = calculateEndTime(startTime, duration);
  const startTime24 = addSeconds(startTime);

  // Merge with booking params
  const postData = {
    ...formData,
    ReservationTypeId: config.venue.reservationTypeId,
    Duration: duration.toString(),
    CourtId: courtId.toString(),
    StartTime: startTime24,
    EndTime: endTime12,
    DisclosureAgree: 'true',
  };

  log.trace('Reservation post data', {
    courtId,
    startTime: startTime24,
    endTime: endTime12,
    duration,
    reservationTypeId: config.venue.reservationTypeId,
    fieldCount: Object.keys(postData).length,
  });

  // Convert to form-urlencoded
  const formBody = new URLSearchParams();
  for (const [key, value] of Object.entries(postData)) {
    formBody.append(key, value);
  }

  const url = `${API_DOMAINS.reservations}/Online/ReservationsApi/CreateReservation/${config.venue.orgId}?uiCulture=${UI_CULTURE}`;
  log.debug('Submitting reservation', { url });

  const submitStartTime = Date.now();
  const response = await fetchWithCookies(url, config.cookieManager, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${API_DOMAINS.main}/`,
    },
    body: formBody.toString(),
  });
  const submitElapsed = Date.now() - submitStartTime;

  if (!response.ok) {
    log.error('Create reservation HTTP error', {
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`Create reservation failed: ${response.status}`);
  }

  const data: CreateReservationResponse = await response.json();

  // Log full response to debug field names
  log.debug('CreateReservation API response (full)', {
    fullResponse: JSON.stringify(data),
    responseKeys: Object.keys(data),
  });

  if (data.isValid) {
    log.info('RESERVATION SUCCESSFUL!', {
      courtId,
      date: formatDate(date),
      startTime,
      duration,
      elapsed: `${submitElapsed}ms`,
      reservationId: data.reservationId,
      confirmationNumber: data.confirmationNumber,
      responseFields: Object.keys(data).join(', '),
    });
  } else {
    log.warn('Reservation failed', {
      message: data.message,
      courtId,
      date: formatDate(date),
      startTime,
      elapsed: `${submitElapsed}ms`,
    });
  }

  return data;
}

/**
 * Cancel a reservation on CourtReserve
 */
export async function cancelReservation(
  config: ApiClientConfig,
  reservationId: string,
  confirmationNumber: string = '', // Optional - cancellation works without it
  date: Date | string,
  startTime: string,
  duration: number,
  cancellationReason: string
): Promise<CancelReservationResponse> {
  log.info('Canceling reservation', {
    reservationId,
    confirmationNumber,
    date: formatDate(date),
    startTime,
    duration,
    reason: cancellationReason,
    venue: config.venue.name,
  });

  // Format start and end datetime in the format CourtReserve expects
  const startDateTime12 = formatDateTime(date, startTime);
  const endTime12 = calculateEndTime(startTime, duration);
  const endDateTime = `${formatDate(date)} ${endTime12}`;

  const url = `${API_DOMAINS.main}/Online/MyProfile/CancelReservation/${config.venue.orgId}`;
  log.debug('Cancellation URL', { url });

  // Build form data matching the curl example
  const formData = new URLSearchParams({
    'SelectedReservation.Id': reservationId,
    'SelectedReservation.Number': confirmationNumber,
    'SelectedReservation.Start': startDateTime12,
    'SelectedReservation.End': endDateTime,
    'SelectedReservation.OrganizationId': config.venue.orgId,
    'SelectedReservation.IsInstructorPrice': 'False',
    'HoursBeforeReservationCAnBeCancelledWithoutPenalty': '4',
    'MemberXPenaltyCancellations': '',
    'XPenaltyCancellationsToRemoveAbilityToReserve': '3',
    'SelectedReservation.RequireReasonOnReservationCancellation': 'True',
    'IsUnderPenaltyWindow': 'False',
    'SelectedReservation.IsLesson': 'False',
    'SelectedReservation.CancellationReason': cancellationReason,
    'X-Requested-With': 'XMLHttpRequest',
  });

  log.trace('Cancellation form data', {
    reservationId,
    confirmationNumber,
    startDateTime12,
    endDateTime,
  });

  const startTimeMs = Date.now();

  try {
    const response = await fetchWithCookies(url, config.cookieManager, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${API_DOMAINS.main}/Online/MyProfile/Reservation/${config.venue.orgId}/${reservationId}`,
      },
      body: formData.toString(),
    });

    const elapsed = Date.now() - startTimeMs;

    if (!response.ok) {
      log.error('Cancel reservation HTTP error', {
        status: response.status,
        statusText: response.statusText,
      });
      return {
        isValid: false,
        message: `Cancellation failed: ${response.status} ${response.statusText}`,
      };
    }

    const data: CancelReservationResponse = await response.json();

    if (data.isValid) {
      log.info('CANCELLATION SUCCESSFUL!', {
        reservationId,
        confirmationNumber,
        elapsed: `${elapsed}ms`,
      });
    } else {
      log.warn('Cancellation rejected by server', {
        message: data.message,
        reservationId,
        elapsed: `${elapsed}ms`,
      });
    }

    return data;
  } catch (error) {
    const elapsed = Date.now() - startTimeMs;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error('Cancellation failed with error', {
      error: errorMessage,
      reservationId,
      elapsed: `${elapsed}ms`,
    });

    return {
      isValid: false,
      message: errorMessage,
    };
  }
}

/**
 * Unpaid transaction from GetUnPaidTransactions API
 */
export interface UnpaidTransaction {
  ReservationId: number;
  ReservationNumber: string;
  ReservationDateDisplay: string; // e.g., "1/14/2026"
  ReservationTimeDisplay: string; // e.g., "1:00 PM - 2:00 PM"
  TransactionItemDateDisplay: string; // e.g., "Wed, Jan 14th, 1p - 2p"
  Amount: number;
  CourtLabel: string;
  MemberName: string;
  IsPaid: boolean;
}

/**
 * Get unpaid transactions (includes recent reservations with their IDs)
 * This API uses cookie-based auth (no JWT needed)
 */
export async function getUnpaidTransactions(
  config: ApiClientConfig
): Promise<UnpaidTransaction[]> {
  log.debug('Fetching unpaid transactions', {
    venue: config.venue.name,
    orgId: config.venue.orgId,
  });

  const url = `${API_DOMAINS.main}/Online/MyBalance/GetUnPaidTransactions?id=${config.venue.orgId}&isApiCall=true`;

  const startTime = Date.now();
  const response = await fetchWithCookies(url, config.cookieManager, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    },
  });

  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    log.error('GetUnPaidTransactions failed', {
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`GetUnPaidTransactions failed: ${response.status}`);
  }

  const rawData = await response.json();

  log.debug('Unpaid transactions raw response', {
    rawData: JSON.stringify(rawData).substring(0, 500),
    isArray: Array.isArray(rawData),
  });

  // The API might wrap the array in an object
  const data: UnpaidTransaction[] = Array.isArray(rawData) ? rawData : rawData.Data || [];

  log.debug('Unpaid transactions retrieved', {
    count: data.length,
    elapsed: `${elapsed}ms`,
    reservations: data.slice(0, 5).map((t) => ({
      id: t.ReservationId,
      number: t.ReservationNumber,
      date: t.ReservationDateDisplay,
      time: t.ReservationTimeDisplay,
    })),
  });

  return data;
}

/**
 * Find a reservation by date and time from unpaid transactions
 */
export function findReservationInTransactions(
  transactions: UnpaidTransaction[],
  date: Date | string,
  startTime: string
): UnpaidTransaction | null {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Format date to match ReservationDateDisplay (e.g., "1/14/2026")
  const month = dateObj.getMonth() + 1;
  const day = dateObj.getDate();
  const year = dateObj.getFullYear();
  const targetDateStr = `${month}/${day}/${year}`;

  // Parse startTime to 12-hour format for matching (e.g., "13:00" -> "1:00 PM")
  const [hours, minutes] = startTime.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  const targetTimePrefix = `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;

  log.debug('Searching for reservation in transactions', {
    targetDate: targetDateStr,
    targetTimePrefix,
    transactionCount: transactions.length,
  });

  for (const tx of transactions) {
    // Match date
    if (tx.ReservationDateDisplay !== targetDateStr) {
      continue;
    }

    // Match time (ReservationTimeDisplay is like "1:00 PM - 2:00 PM")
    if (tx.ReservationTimeDisplay.startsWith(targetTimePrefix)) {
      log.info('Found matching reservation', {
        reservationId: tx.ReservationId,
        confirmationNumber: tx.ReservationNumber,
        date: tx.ReservationDateDisplay,
        time: tx.ReservationTimeDisplay,
      });
      return tx;
    }
  }

  log.debug('No matching reservation found in transactions');
  return null;
}
