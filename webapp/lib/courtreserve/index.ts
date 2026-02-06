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
  PreFetchedForm,
} from './types';

export { VENUES, API_DOMAINS, USER_AGENT, TIMEZONE } from './types';

// Export API functions needed for pre-fetching forms
export { fetchReservationForm, submitReservationWithForm } from './api';
