/**
 * CourtReserve API Types and Interfaces
 */

export interface VenueConfig {
  orgId: string;
  schedulerId: string;
  costTypeId: string;
  reservationMinInterval: string;
  courtType: number;
  reservationTypeId: string;
  name: string;
}

export interface Court {
  id: number;
  name?: string;
  [key: string]: any;
}

export interface DurationOption {
  value: string;
  disabled: boolean;
  text?: string;
}

export interface BookingParams {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM (24h format)
  duration: number; // minutes
  courtId: number;
}

export interface BookingResult {
  success: boolean;
  courtId?: number;
  message?: string;
  error?: string;
  windowClosed?: boolean;  // Indicates booking window not yet open
  externalId?: string;  // Reservation ID from CourtReserve
  confirmationNumber?: string;  // Confirmation number from CourtReserve
}

export interface LoginResponse {
  IsValid: boolean;
  Message?: string;
  [key: string]: any;
}

export interface ReservationFormData {
  __RequestVerificationToken: string;
  Id: string;
  OrgId: string;
  Date: string;
  [key: string]: string;
}

export interface CreateReservationResponse {
  isValid: boolean;
  message?: string;
  reservationId?: string;  // External ID from CourtReserve
  confirmationNumber?: string;  // Confirmation number
  [key: string]: any;
}

export interface CancelReservationResponse {
  isValid: boolean;
  message?: string;
  [key: string]: any;
}

/**
 * Pre-fetched form data for fast booking at noon
 * Fetched during prep phase (11:59) to avoid form-fetching latency at noon
 */
export interface PreFetchedForm {
  formData: ReservationFormData;
  timeSlot: string;      // e.g., "18:00"
  duration: number;      // e.g., 120
  courtId: number;       // e.g., 52039
  fetchedAt: Date;       // When this was fetched (for staleness checks)
}

export const VENUES: Record<string, VenueConfig> = {
  sunnyvale: {
    name: 'Sunnyvale',
    orgId: '13233',
    schedulerId: '16984',
    costTypeId: '141158',
    reservationMinInterval: '60',
    courtType: 9,
    reservationTypeId: '69707',
  },
  santa_clara: {
    name: 'Santa Clara',
    orgId: '13234',
    schedulerId: '16994',
    costTypeId: '141158',
    reservationMinInterval: '60',
    courtType: 9,
    reservationTypeId: '69707',
  },
};

export const COURT_TYPE_PICKLEBALL = 9;
export const UI_CULTURE = 'en-US';
export const TIMEZONE = 'America/Los_Angeles';
export const USER_AGENT = 'Mozilla/5.0 CourtReserveAuto/2.0 (+https://github.com)';

// API domains
export const API_DOMAINS = {
  main: 'https://app.courtreserve.com',
  api: 'https://api4.courtreserve.com',
  reservations: 'https://reservations.courtreserve.com',
} as const;
