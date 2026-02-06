/**
 * CourtReserve API Client
 * With extensive logging for debugging
 */

import { CookieManager } from './auth';
import * as api from './api';
import { BookingParams, BookingResult, Court, PreFetchedForm, VENUES, VenueConfig } from './types';
import { createLogger } from '../logger';

const log = createLogger('CourtReserve:Client');

export interface CourtReserveClientConfig {
  venue: string;
  email: string;
  password: string;
}

export class CourtReserveClient {
  private venue: VenueConfig;
  private cookieManager: CookieManager;
  private email: string;
  private password: string;
  private isAuthenticated: boolean = false;
  private loginAttempts: number = 0;
  private lastLoginTime: Date | null = null;

  // Retry configuration
  private static readonly MAX_LOGIN_RETRIES = 3;
  private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s exponential backoff

  constructor(config: CourtReserveClientConfig) {
    log.debug('Creating CourtReserve client', {
      venue: config.venue,
      email: config.email,
    });

    const venueConfig = VENUES[config.venue];
    if (!venueConfig) {
      log.error('Unknown venue', {
        venue: config.venue,
        validOptions: Object.keys(VENUES),
      });
      throw new Error(`Unknown venue: ${config.venue}. Valid options: ${Object.keys(VENUES).join(', ')}`);
    }

    this.venue = venueConfig;
    this.cookieManager = new CookieManager();
    this.email = config.email;
    this.password = config.password;

    log.info('CourtReserve client created', {
      venue: venueConfig.name,
      orgId: venueConfig.orgId,
      email: config.email,
    });
  }

  /**
   * Login to CourtReserve with retry logic for transient failures
   */
  async login(): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= CourtReserveClient.MAX_LOGIN_RETRIES; attempt++) {
      this.loginAttempts++;
      log.info('Starting login', {
        attempt,
        maxAttempts: CourtReserveClient.MAX_LOGIN_RETRIES,
        email: this.email,
        venue: this.venue.name,
      });

      const startTime = Date.now();

      try {
        // Initialize session first
        log.debug('Initializing session...');
        await api.initializeSession(this.getApiConfig());

        // Perform login
        log.debug('Performing login...');
        const response = await api.login(this.getApiConfig(), this.email, this.password);

        const elapsed = Date.now() - startTime;

        if (response.IsValid) {
          this.isAuthenticated = true;
          this.lastLoginTime = new Date();
          log.info('Login successful', {
            email: this.email,
            elapsed: `${elapsed}ms`,
            attempt,
          });
          return true;
        } else {
          // Auth failure - don't retry (wrong credentials)
          this.isAuthenticated = false;
          log.warn('Login failed - invalid credentials', {
            message: response.Message,
            email: this.email,
            elapsed: `${elapsed}ms`,
          });
          throw new Error(response.Message || 'Login failed - invalid credentials');
        }
      } catch (error) {
        this.isAuthenticated = false;
        const elapsed = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        log.error('Login error', {
          error: errorMessage,
          email: this.email,
          elapsed: `${elapsed}ms`,
          attempt,
        });

        // Don't retry auth failures (wrong password, invalid credentials)
        const isAuthFailure =
          errorMessage.toLowerCase().includes('invalid') ||
          errorMessage.toLowerCase().includes('incorrect') ||
          errorMessage.toLowerCase().includes('wrong') ||
          errorMessage.toLowerCase().includes('credentials');

        if (isAuthFailure) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(errorMessage);

        // Retry transient errors (network, timeout) with exponential backoff
        if (attempt < CourtReserveClient.MAX_LOGIN_RETRIES) {
          const delay = CourtReserveClient.RETRY_DELAYS[attempt - 1];
          log.info('Retrying login after transient error', {
            attempt,
            nextAttempt: attempt + 1,
            delayMs: delay,
            error: errorMessage,
          });

          // Clear cookies before retry (fresh session)
          this.cookieManager.clear();

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    log.error('Login failed after all retries', {
      attempts: CourtReserveClient.MAX_LOGIN_RETRIES,
      email: this.email,
    });
    throw lastError || new Error('Login failed after all retries');
  }

  /**
   * Refresh the session (clear cookies and re-login)
   */
  async refreshSession(): Promise<void> {
    log.info('Refreshing session', {
      email: this.email,
      venue: this.venue.name,
    });

    log.debug('Clearing cookies...');
    this.cookieManager.clear();
    this.isAuthenticated = false;

    log.debug('Re-authenticating...');
    await this.login();

    log.info('Session refreshed successfully');
  }

  /**
   * Ensure we're authenticated (login if needed)
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.isAuthenticated) {
      log.debug('Not authenticated, initiating login');
      await this.login();
    } else {
      log.trace('Already authenticated', {
        email: this.email,
        lastLogin: this.lastLoginTime?.toISOString(),
      });
    }
  }

  /**
   * Get available courts for a specific date/time/duration
   */
  async getAvailableCourts(date: Date | string, startTime: string, duration: number): Promise<Court[]> {
    log.debug('Getting available courts', {
      date: typeof date === 'string' ? date : date.toISOString(),
      startTime,
      duration,
      venue: this.venue.name,
    });

    await this.ensureAuthenticated();

    try {
      const courts = await api.getAvailableCourts(this.getApiConfig(), date, startTime, duration);
      log.debug('Courts retrieved', {
        count: courts.length,
        courts: courts.slice(0, 5).map((c) => c.id), // Log first 5 court IDs
      });
      return courts;
    } catch (error) {
      // Try refreshing session once on failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        log.warn('Auth error getting courts, refreshing session', { error: errorMessage });
        await this.refreshSession();
        return await api.getAvailableCourts(this.getApiConfig(), date, startTime, duration);
      }
      log.error('Failed to get available courts', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Book a court
   */
  async bookCourt(params: BookingParams): Promise<BookingResult> {
    log.info('Attempting to book court', {
      date: params.date,
      startTime: params.startTime,
      duration: params.duration,
      courtId: params.courtId,
      venue: this.venue.name,
    });

    const startTime = Date.now();
    await this.ensureAuthenticated();

    try {
      log.debug('Submitting reservation request...');
      const response = await api.createReservation(
        this.getApiConfig(),
        params.date,
        params.startTime,
        params.duration,
        params.courtId
      );

      const elapsed = Date.now() - startTime;

      if (response.isValid) {
        log.info('BOOKING SUCCESSFUL!', {
          date: params.date,
          startTime: params.startTime,
          duration: params.duration,
          courtId: params.courtId,
          externalId: response.reservationId,
          confirmationNumber: response.confirmationNumber,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: true,
          courtId: params.courtId,
          message: 'Booking successful',
          externalId: response.reservationId,
          confirmationNumber: response.confirmationNumber,
        };
      } else {
        const message = response.message || 'Booking failed';

        // Check if this is a booking window error
        if (message.toLowerCase().includes('only allowed to reserve up to')) {
          log.info('Booking window not yet open', {
            date: params.date,
            startTime: params.startTime,
            message,
            elapsed: `${elapsed}ms`,
          });
          return {
            success: false,
            message: 'Booking window not yet open',
            windowClosed: true,
            error: message,
          };
        }

        log.warn('Booking rejected by server', {
          message,
          date: params.date,
          startTime: params.startTime,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: false,
          message,
          error: message,
        };
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it's a booking window error
      if (errorMessage.toLowerCase().includes('only allowed to reserve up to')) {
        log.info('Booking window not yet open', {
          date: params.date,
          startTime: params.startTime,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: false,
          message: 'Booking window not yet open',
          error: errorMessage,
        };
      }

      // Try refreshing session once on auth failure
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        log.warn('Auth error during booking, refreshing session', { error: errorMessage });
        await this.refreshSession();
        return await this.bookCourt(params);
      }

      log.error('Booking failed with error', {
        error: errorMessage,
        date: params.date,
        startTime: params.startTime,
        elapsed: `${elapsed}ms`,
      });

      return {
        success: false,
        message: errorMessage,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if courts are available (without booking)
   */
  async checkAvailability(date: Date | string, startTime: string, duration: number): Promise<boolean> {
    log.debug('Checking availability', { date, startTime, duration });
    const courts = await this.getAvailableCourts(date, startTime, duration);
    const available = courts.length > 0;
    log.debug('Availability check result', { available, courtCount: courts.length });
    return available;
  }

  /**
   * Get venue information
   */
  getVenueInfo(): VenueConfig {
    return { ...this.venue };
  }

  /**
   * Check if authenticated
   */
  isLoggedIn(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Get client status for debugging
   */
  getStatus(): object {
    return {
      venue: this.venue.name,
      email: this.email,
      isAuthenticated: this.isAuthenticated,
      loginAttempts: this.loginAttempts,
      lastLoginTime: this.lastLoginTime?.toISOString() || null,
      cookieCount: this.cookieManager.getAllCookies().length,
    };
  }

  /**
   * Get API config for use by API functions
   */
  getApiConfig(): api.ApiClientConfig {
    return {
      venue: this.venue,
      cookieManager: this.cookieManager,
    };
  }

  /**
   * Fetch reservation details (external ID, confirmation number) after a successful booking
   * Uses the GetUnPaidTransactions API to find the reservation by date/time
   */
  async fetchReservationDetails(
    date: Date | string,
    startTime: string
  ): Promise<{ externalId: string; confirmationNumber: string } | null> {
    log.debug('Fetching reservation details', {
      date: typeof date === 'string' ? date : date.toISOString(),
      startTime,
    });

    await this.ensureAuthenticated();

    try {
      const transactions = await api.getUnpaidTransactions(this.getApiConfig());
      const match = api.findReservationInTransactions(transactions, date, startTime);

      if (match) {
        log.info('Found reservation details', {
          externalId: match.ReservationId.toString(),
          confirmationNumber: match.ReservationNumber,
        });
        return {
          externalId: match.ReservationId.toString(),
          confirmationNumber: match.ReservationNumber,
        };
      }

      log.warn('Could not find reservation in unpaid transactions', {
        date,
        startTime,
        transactionCount: transactions.length,
      });
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to fetch reservation details', { error: errorMessage });
      return null;
    }
  }

  /**
   * Pre-fetch the booking form for a specific court/time/duration
   * Called during prep phase at 11:59 to avoid form-fetching latency at noon
   */
  async prefetchBookingForm(
    date: string,
    startTime: string,
    duration: number,
    courtId: number
  ): Promise<PreFetchedForm> {
    log.debug('Pre-fetching booking form', {
      date,
      startTime,
      duration,
      courtId,
      venue: this.venue.name,
    });

    await this.ensureAuthenticated();

    const fetchStartTime = Date.now();
    const formData = await api.fetchReservationForm(this.getApiConfig(), date, startTime, duration);
    const fetchElapsed = Date.now() - fetchStartTime;

    log.debug('Booking form pre-fetched', {
      date,
      startTime,
      duration,
      courtId,
      elapsed: `${fetchElapsed}ms`,
      hasCSRFToken: !!formData.__RequestVerificationToken,
    });

    return {
      formData,
      timeSlot: startTime,
      duration,
      courtId,
      fetchedAt: new Date(),
    };
  }

  /**
   * Book a court using pre-fetched form data (fast path)
   * Falls back to regular bookCourt() if pre-fetched form fails
   */
  async bookCourtWithPrefetchedForm(
    params: BookingParams,
    preFetchedForm: PreFetchedForm
  ): Promise<BookingResult> {
    log.info('Attempting to book court with pre-fetched form', {
      date: params.date,
      startTime: params.startTime,
      duration: params.duration,
      courtId: params.courtId,
      venue: this.venue.name,
      formAge: `${Date.now() - preFetchedForm.fetchedAt.getTime()}ms`,
    });

    const startTime = Date.now();
    await this.ensureAuthenticated();

    try {
      log.debug('Submitting reservation with pre-fetched form (fast path)...');
      const response = await api.submitReservationWithForm(
        this.getApiConfig(),
        preFetchedForm.formData,
        params.date,
        params.startTime,
        params.duration,
        params.courtId
      );

      const elapsed = Date.now() - startTime;

      if (response.isValid) {
        log.info('BOOKING SUCCESSFUL (fast path)!', {
          date: params.date,
          startTime: params.startTime,
          duration: params.duration,
          courtId: params.courtId,
          externalId: response.reservationId,
          confirmationNumber: response.confirmationNumber,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: true,
          courtId: params.courtId,
          message: 'Booking successful',
          externalId: response.reservationId,
          confirmationNumber: response.confirmationNumber,
        };
      } else {
        const message = response.message || 'Booking failed';

        // Check if this is a booking window error
        if (message.toLowerCase().includes('only allowed to reserve up to')) {
          log.info('Booking window not yet open (fast path)', {
            date: params.date,
            startTime: params.startTime,
            message,
            elapsed: `${elapsed}ms`,
          });
          return {
            success: false,
            message: 'Booking window not yet open',
            windowClosed: true,
            error: message,
          };
        }

        // Check if this might be a form/CSRF error that warrants fallback
        const isFormError = 
          message.toLowerCase().includes('token') ||
          message.toLowerCase().includes('expired') ||
          message.toLowerCase().includes('session') ||
          message.toLowerCase().includes('antiforgery') ||
          message.toLowerCase().includes('verification');

        if (isFormError) {
          log.warn('Pre-fetched form may be stale, falling back to slow path', {
            message,
            date: params.date,
            startTime: params.startTime,
            formAge: `${Date.now() - preFetchedForm.fetchedAt.getTime()}ms`,
          });
          // Fall back to regular booking which fetches fresh form
          return await this.bookCourt(params);
        }

        log.warn('Booking rejected by server (fast path)', {
          message,
          date: params.date,
          startTime: params.startTime,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: false,
          message,
          error: message,
        };
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it's a booking window error
      if (errorMessage.toLowerCase().includes('only allowed to reserve up to')) {
        log.info('Booking window not yet open (fast path)', {
          date: params.date,
          startTime: params.startTime,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: false,
          message: 'Booking window not yet open',
          error: errorMessage,
        };
      }

      // Check if this might be a form/CSRF/auth error that warrants fallback
      const isRecoverableError =
        errorMessage.includes('401') ||
        errorMessage.includes('403') ||
        errorMessage.toLowerCase().includes('token') ||
        errorMessage.toLowerCase().includes('expired') ||
        errorMessage.toLowerCase().includes('session') ||
        errorMessage.toLowerCase().includes('csrf');

      if (isRecoverableError) {
        log.warn('Error with pre-fetched form, falling back to slow path', {
          error: errorMessage,
          date: params.date,
          startTime: params.startTime,
          formAge: `${Date.now() - preFetchedForm.fetchedAt.getTime()}ms`,
        });
        // Refresh session and fall back to regular booking
        await this.refreshSession();
        return await this.bookCourt(params);
      }

      log.error('Booking failed with error (fast path)', {
        error: errorMessage,
        date: params.date,
        startTime: params.startTime,
        elapsed: `${elapsed}ms`,
      });

      return {
        success: false,
        message: errorMessage,
        error: errorMessage,
      };
    }
  }
}
