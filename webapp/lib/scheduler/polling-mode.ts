/**
 * Polling Mode Handler - Check for cancellations every 15 minutes
 * With extensive logging for debugging
 */

import { CourtReserveClient, generateTimeSlots, generateDurations } from '../courtreserve';
import { LockManager } from './lock-manager';
import { JobResult, BookingAttempt, JobWithAccount } from './types';
import {
  fetchJobsNeedingBookings,
  getTargetDates,
  countExistingBookings,
  recordReservation,
  updateJobTimestamps,
  archiveJob,
  updateLastAttempt,
  shouldRecordHistory,
  recordRunHistory,
} from './job-processor';
import { notifyBookingFailure, isNotificationConfigured } from '../notifications';
import { createLogger } from '../logger';

const log = createLogger('Scheduler:PollingMode');

const DELAY_BETWEEN_JOBS_MS = 2000; // 2 seconds between jobs

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PollingModeHandler {
  constructor() {
    log.debug('PollingModeHandler initialized', { delayBetweenJobsMs: DELAY_BETWEEN_JOBS_MS });
  }

  /**
   * Execute polling mode
   * Runs every 15 minutes, skips noon window (11:55-12:15)
   */
  async execute(lockManager: LockManager): Promise<JobResult[]> {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    log.trace('Checking noon window', { hour, minute });

    // Skip during noon window
    if ((hour === 11 && minute >= 55) || (hour === 12 && minute <= 15)) {
      log.info('Skipping polling - within noon window', { hour, minute });
      return [];
    }

    log.info('=== POLLING MODE STARTING ===', {
      time: now.toISOString(),
    });
    const pollingStartTime = Date.now();

    try {
      // Fetch jobs that need bookings
      const jobs = await fetchJobsNeedingBookings();
      log.info('Fetched jobs needing bookings', {
        count: jobs.length,
        jobs: jobs.map((j) => ({ id: j.id, name: j.name, venue: j.venue })),
      });

      if (jobs.length === 0) {
        log.debug('No jobs need bookings');
        return [];
      }

      const results: JobResult[] = [];

      // Process jobs sequentially with delays (less aggressive than noon mode)
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const jobStartTime = new Date();
        try {
          log.debug('Processing job', {
            index: i + 1,
            total: jobs.length,
            jobName: job.name,
          });

          const result = await this.processJob(job, lockManager);
          results.push(result);

          log.debug('Job processing complete', {
            jobName: job.name,
            status: result.status,
            attemptsCount: result.attempts.length,
          });

          // Update last attempt with result details (always, even for non-meaningful events)
          await updateLastAttempt(job.id, result, result.date);

          // Record history if meaningful
          if (shouldRecordHistory(result, 'polling')) {
            try {
              await recordRunHistory(
                job.id,
                'polling',
                result,
                jobStartTime,
                new Date()
              );
              log.debug('Run history recorded', {
                jobName: job.name,
                status: result.status,
              });

              // Send failure notification for meaningful failures
              if (result.status !== 'success' && isNotificationConfigured()) {
                const targetDates = getTargetDates(job);
                const reason =
                  result.errorMessage ||
                  'Courts were available but booking failed';

                await notifyBookingFailure({
                  jobName: job.name,
                  venue: job.venue,
                  date: targetDates[0] || 'Unknown',
                  reason,
                  attemptsCount: result.attempts.length,
                }).catch((err) => {
                  log.warn('Failed to send failure notification', {
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
              }
            } catch (error) {
              log.error('Failed to record run history', {
                jobName: job.name,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // Delay between jobs to avoid rate limiting
          if (i < jobs.length - 1) {
            log.trace('Sleeping between jobs', { delayMs: DELAY_BETWEEN_JOBS_MS });
            await sleep(DELAY_BETWEEN_JOBS_MS);
          }
        } catch (error) {
          log.error('Error processing job', {
            jobName: job.name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          results.push({
            jobId: job.id,
            status: 'error',
            attempts: [],
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const pollingTime = Date.now() - pollingStartTime;
      const successCount = results.filter((r) => r.status === 'success').length;
      const failureCount = results.filter((r) => r.status === 'error' || r.status === 'no_courts').length;
      const lockedCount = results.filter((r) => r.status === 'locked').length;

      log.info('=== POLLING MODE COMPLETE ===', {
        totalJobs: results.length,
        successCount,
        failureCount,
        lockedCount,
        durationMs: pollingTime,
      });

      return results;
    } catch (error) {
      log.error('Polling mode failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return [];
    }
  }

  /**
   * Process a single job
   */
  private async processJob(
    job: JobWithAccount,
    lockManager: LockManager
  ): Promise<JobResult> {
    const jobStartTime = Date.now();

    log.info('Processing job', {
      jobId: job.id,
      jobName: job.name,
      venue: job.venue,
      recurrence: job.recurrence,
    });

    // Create and authenticate client
    log.debug('Creating CourtReserve client', {
      jobName: job.name,
      venue: job.venue,
      email: job.account.email,
    });

    const client = new CourtReserveClient({
      venue: job.venue,
      email: job.account.email,
      password: job.account.password,
    });

    try {
      const loginStartTime = Date.now();
      await client.login();
      log.info('Client authenticated', {
        jobName: job.name,
        loginDurationMs: Date.now() - loginStartTime,
      });
    } catch (error) {
      log.error('Authentication failed', {
        jobName: job.name,
        email: job.account.email,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        jobId: job.id,
        status: 'error',
        attempts: [],
        errorMessage: 'Authentication failed',
      };
    }

    // Get all target dates within booking window
    const targetDates = getTargetDates(job);
    log.info('Target dates for job', {
      jobName: job.name,
      targetDatesCount: targetDates.length,
      targetDates,
    });

    const attempts: BookingAttempt[] = [];

    // Process each target date
    for (const targetDate of targetDates) {
      log.debug('Processing target date', { jobName: job.name, targetDate });

      // Check max bookings per day
      const maxBookingsPerDay = ('maxBookingsPerDay' in job && job.maxBookingsPerDay) || 1;
      const existingCount = await countExistingBookings(job.accountId, job.venue, targetDate);

      log.trace('Checking existing bookings', {
        jobName: job.name,
        targetDate,
        existingCount,
        maxBookingsPerDay,
      });

      if (existingCount >= maxBookingsPerDay) {
        log.info('Max bookings reached for date - skipping', {
          jobName: job.name,
          targetDate,
          existingCount,
          maxBookingsPerDay,
        });
        continue;
      }

      // Try to acquire lock
      const lockKey = `${job.accountId}-${job.venue}-${targetDate}`;
      if (!lockManager.acquire(lockKey, job.id)) {
        log.debug('Lock not acquired for date - skipping', {
          jobName: job.name,
          targetDate,
          lockKey,
        });
        continue;
      }

      log.trace('Lock acquired', { jobName: job.name, lockKey });

      try {
        // Parse preferences (handle both old and new schema formats)
        let preferredTime: string;
        let timeFlexibility: number;
        let preferredDuration: number;
        let minDuration: number;
        let strictDuration: boolean;

        const hasNewSchema = 'preferredTime' in job && job.preferredTime !== null;
        if (hasNewSchema) {
          preferredTime = job.preferredTime!;
          timeFlexibility = (job.timeFlexibility as number) ?? 30;
          preferredDuration = (job.preferredDuration as number) ?? 120;
          minDuration = (job.minDuration as number) ?? 60;
          strictDuration = (job.strictDuration as boolean) ?? false;
        } else {
          // Fallback to old schema
          try {
            const timeSlots = job.timeSlots ? JSON.parse(job.timeSlots) as string[] : ['18:00'];
            const durations = job.durations ? JSON.parse(job.durations) as number[] : [120, 90, 60, 30];

            preferredTime = timeSlots[0] || '18:00';
            timeFlexibility = timeSlots.length > 1 ? 30 : 0;
            preferredDuration = durations[0] || 120;
            minDuration = durations[durations.length - 1] || 60;
            strictDuration = durations.length === 1;

            log.trace('Parsed old schema preferences', {
              jobName: job.name,
              preferredTime,
              timeFlexibility,
              preferredDuration,
              minDuration,
              strictDuration,
            });
          } catch (error) {
            log.error('Failed to parse job preferences (old schema)', {
              jobName: job.name,
              timeSlots: job.timeSlots,
              durations: job.durations,
              error: error instanceof Error ? error.message : String(error),
            });
            lockManager.release(lockKey, job.id);
            continue;
          }
        }

        // Generate time slots and durations
        const timeSlots = generateTimeSlots(preferredTime, timeFlexibility);
        const durations = generateDurations(preferredDuration, minDuration, strictDuration);

        log.debug('Generated slots and durations', {
          jobName: job.name,
          targetDate,
          timeSlots,
          durations,
          totalCombinations: timeSlots.length * durations.length,
        });

        // Try slots SEQUENTIALLY (less aggressive than noon mode)
        let booked = false;
        for (const duration of durations) {
          if (booked) break;

          for (const timeSlot of timeSlots) {
            if (booked) break;

            try {
              // Check availability
              const courts = await client.getAvailableCourts(targetDate, timeSlot, duration);

              if (courts.length === 0) {
                attempts.push({
                  date: targetDate,
                  timeSlot,
                  duration,
                  success: false,
                  message: 'No courts available',
                  timestamp: new Date(),
                });
                continue;
              }

              // Attempt booking
              const result = await client.bookCourt({
                date: targetDate,
                startTime: timeSlot,
                duration,
                courtId: courts[0].id,
              });

              const attempt: BookingAttempt = {
                date: targetDate,
                timeSlot,
                duration,
                courtId: courts[0].id,
                success: result.success,
                message: result.message || (result.success ? 'Booked' : 'Failed'),
                timestamp: new Date(),
                externalId: result.externalId,
                confirmationNumber: result.confirmationNumber,
              };

              attempts.push(attempt);

              if (result.success) {
                log.info('BOOKING SUCCESS!', {
                  jobName: job.name,
                  targetDate,
                  timeSlot,
                  duration,
                  courtId: attempt.courtId,
                  durationMs: Date.now() - jobStartTime,
                });

                // Fetch reservation details (external ID, confirmation number) from unpaid transactions
                let externalId = result.externalId;
                let confirmationNumber = result.confirmationNumber;

                if (!externalId) {
                  log.debug('Fetching reservation details from API', { jobName: job.name });
                  const details = await client.fetchReservationDetails(targetDate, timeSlot);
                  if (details) {
                    externalId = details.externalId;
                    confirmationNumber = details.confirmationNumber;
                    log.info('Reservation details fetched successfully', {
                      jobName: job.name,
                      externalId,
                      confirmationNumber,
                    });
                  } else {
                    log.warn('Could not fetch reservation details', { jobName: job.name });
                  }
                }

                // Record reservation
                log.debug('Recording reservation to database', { jobName: job.name });
                await recordReservation(job, attempt, externalId, confirmationNumber);

                // Update timestamps
                log.debug('Updating job timestamps', { jobId: job.id });
                await updateJobTimestamps(job.id, job.recurrence);

                // Archive if one-time
                if (job.recurrence === 'once') {
                  log.info('Archiving one-time job after success', { jobId: job.id });
                  await archiveJob(job.id);
                }

                booked = true;

                // Return early on successful booking
                log.trace('Releasing lock after success', { lockKey });
                lockManager.release(lockKey, job.id);
                return {
                  jobId: job.id,
                  status: 'success',
                  attempts,
                  courtId: attempt.courtId,
                  date: attempt.date,
                  startTime: attempt.timeSlot,
                  duration: attempt.duration,
                };
              } else {
                log.debug('Booking attempt failed', {
                  jobName: job.name,
                  timeSlot,
                  duration,
                  message: result.message,
                });
              }
            } catch (error) {
              attempts.push({
                date: targetDate,
                timeSlot,
                duration,
                success: false,
                message: error instanceof Error ? error.message : String(error),
                timestamp: new Date(),
              });
            }
          }
        }
      } finally {
        lockManager.release(lockKey, job.id);
      }
    }

    // No successful bookings - check if window closed
    const allWindowClosed = attempts.length > 0 && attempts.every(
      (a) => a.message?.includes('window not yet open') ||
             a.message?.includes('only allowed to reserve up to')
    );

    return {
      jobId: job.id,
      status: allWindowClosed ? 'window_closed' : (attempts.length > 0 ? 'no_courts' : 'error'),
      attempts,
      errorMessage: allWindowClosed ? 'Booking window not open yet' : undefined,
    };
  }
}
