/**
 * CourtReserve API methods
 * With extensive logging for debugging
 */

import {
  API_DOMAINS,
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
 * Get available courts for a specific date/time/duration
 */
export async function getAvailableCourts(
  config: ApiClientConfig,
  date: Date | string,
  startTime: string,
  duration: number
): Promise<Court[]> {
  const formattedDate = formatDateMidnight(date);
  const startTime24 = addSeconds(startTime);
  const endTime12 = calculateEndTime(startTime, duration);

  log.debug('Getting available courts', {
    date: formattedDate,
    startTime,
    duration,
    endTime: endTime12,
    venue: config.venue.name,
  });

  const params = new URLSearchParams({
    uiCulture: UI_CULTURE,
    Date: formattedDate,
    selectedDate: formattedDate,
    StartTime: startTime24,
    EndTime: endTime12,
    CourtTypesString: config.venue.courtType.toString(),
    timeZone: 'America/Los_Angeles',
    customSchedulerId: config.venue.schedulerId,
    Duration: duration.toString(),
  });

  const url = `${API_DOMAINS.main}/Online/AjaxController/GetAvailableCourtsMemberPortal/${config.venue.orgId}?${params}`;
  log.trace('Available courts URL', { url });

  const startTimeMs = Date.now();
  const response = await fetchWithCookies(url, config.cookieManager);
  const elapsed = Date.now() - startTimeMs;

  if (!response.ok) {
    log.error('Get courts failed', { status: response.status });
    throw new Error(`Get courts failed: ${response.status}`);
  }

  const data: Court[] = await response.json();

  log.info('Available courts retrieved', {
    count: data.length,
    courts: data.map((c) => ({ id: c.id, name: c.name })),
    elapsed: `${elapsed}ms`,
  });

  if (data.length === 0) {
    log.debug('No courts available for this time slot');
  }

  return data;
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

  let formApiUrl = urlMatch[1];
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

  // Extract hidden fields using regex
  const hiddenFieldRegex =
    /<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
  let match;
  let fieldCount = 0;

  while ((match = hiddenFieldRegex.exec(formHtml)) !== null) {
    const [, name, value] = match;
    formData[name] = value;
    fieldCount++;
  }

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
      'Content-Type': 'application/x-www-form-urlencoded',
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

  if (data.isValid) {
    log.info('RESERVATION SUCCESSFUL!', {
      courtId,
      date: formatDate(date),
      startTime,
      duration,
      elapsed: `${submitElapsed}ms`,
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
