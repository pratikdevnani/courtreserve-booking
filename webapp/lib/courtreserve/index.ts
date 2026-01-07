/**
 * CourtReserve API Client
 * Main exports
 */

export { CourtReserveClient } from './client';
export type { CourtReserveClientConfig } from './client';

export { CookieManager } from './auth';
export type { Cookie } from './auth';

export {
  generateTimeSlots,
  generateDurations,
  formatDate,
  formatDateTime,
  to12Hour,
  calculateEndTime,
} from './time-utils';

export type {
  VenueConfig,
  Court,
  BookingParams,
  BookingResult,
  DurationOption,
  LoginResponse,
  ReservationFormData,
  CreateReservationResponse,
} from './types';

export { VENUES, API_DOMAINS, USER_AGENT, TIMEZONE } from './types';
