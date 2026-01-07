/**
 * CourtReserve API Client
 * With extensive logging for debugging
 */

import { CookieManager } from './auth';
import * as api from './api';
import { BookingParams, BookingResult, Court, VENUES, VenueConfig } from './types';
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
   * Login to CourtReserve
   */
  async login(): Promise<boolean> {
    this.loginAttempts++;
    log.info('Starting login', {
      attempt: this.loginAttempts,
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
          attempt: this.loginAttempts,
        });
        return true;
      } else {
        this.isAuthenticated = false;
        log.warn('Login failed - invalid response', {
          message: response.Message,
          email: this.email,
          elapsed: `${elapsed}ms`,
        });
        throw new Error(response.Message || 'Login failed');
      }
    } catch (error) {
      this.isAuthenticated = false;
      const elapsed = Date.now() - startTime;
      log.error('Login error', {
        error: error instanceof Error ? error.message : String(error),
        email: this.email,
        elapsed: `${elapsed}ms`,
        attempt: this.loginAttempts,
      });
      throw error;
    }
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
          elapsed: `${elapsed}ms`,
        });
        return {
          success: true,
          courtId: params.courtId,
          message: 'Booking successful',
        };
      } else {
        log.warn('Booking rejected by server', {
          message: response.message,
          date: params.date,
          startTime: params.startTime,
          elapsed: `${elapsed}ms`,
        });
        return {
          success: false,
          message: response.message || 'Booking failed',
          error: response.message,
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
   * Get API config for internal use
   */
  private getApiConfig(): api.ApiClientConfig {
    return {
      venue: this.venue,
      cookieManager: this.cookieManager,
    };
  }
}
