/**
 * Noon Mode Handler - High-performance booking at 12:00 PM PST
 *
 * Optimizations:
 * - Pre-fetch court IDs 60 seconds before noon (no availability check at execution)
 * - Serial execution by priority (no double-booking risk)
 * - Try all courts per slot before moving to next slot
 * - Deferred logging (no I/O blocking during booking)
 */

import { CourtReserveClient, generateTimeSlots, generateDurations } from '../courtreserve';
import { LockManager } from './lock-manager';
import { PreparedJob, JobResult, BookingAttempt, JobWithAccount } from './types';
import {
  fetchActiveJobs,
  getTargetDate,
  hasExistingReservation,
  recordReservation,
  updateJobTimestamps,
  archiveJob,
  updateLastAttempt,
  shouldRecordHistory,
  recordRunHistory,
} from './job-processor';
import { notifyBookingFailure, isNotificationConfigured } from '../notifications';
import { createLogger } from '../logger';

const log = createLogger('Scheduler:NoonMode');

export class NoonModeHandler {
  private preparedJobs: Map<string, PreparedJob> = new Map();

  constructor() {
    log.debug('NoonModeHandler initialized');
  }

  /**
   * Prepare phase - Called at 11:59:00 AM (60 seconds before noon)
   * Pre-authenticate clients, calculate target dates, generate time slots, pre-fetch court IDs
   */
  async prepare(): Promise<void> {
    log.info('=== NOON PREPARATION STARTING ===');
    const prepareStartTime = Date.now();

    try {
      // Fetch all active jobs sorted by priority
      const jobs = await fetchActiveJobs();
      log.info('Fetched active jobs', { count: jobs.length });

      if (jobs.length === 0) {
        log.info('No active jobs to prepare');
        return;
      }

      // Prepare each job
      for (const job of jobs) {
        try {
          log.debug('Preparing job', {
            jobId: job.id,
            jobName: job.name,
            venue: job.venue,
            account: job.account.email,
          });
          await this.prepareJob(job);
        } catch (error) {
          log.error('Failed to prepare job', {
            jobId: job.id,
            jobName: job.name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      const prepareTime = Date.now() - prepareStartTime;
      log.info('=== NOON PREPARATION COMPLETE ===', {
        preparedJobs: this.preparedJobs.size,
        totalJobs: jobs.length,
        durationMs: prepareTime,
      });
    } catch (error) {
      log.error('Preparation phase failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Prepare a single job
   */
  private async prepareJob(job: JobWithAccount): Promise<void> {
    log.trace('prepareJob starting', { jobId: job.id, jobName: job.name });

    // Calculate target date (8 days ahead)
    // Skip window check - we know the window opens at noon (execution time)
    const targetDate = getTargetDate(job, true);
    if (!targetDate) {
      log.debug('No target date for job - skipping', {
        jobName: job.name,
        recurrence: job.recurrence,
        days: job.days,
      });
      return;
    }

    log.trace('Target date calculated', { jobName: job.name, targetDate });

    // Check if already booked
    const alreadyBooked = await hasExistingReservation(job.accountId, job.venue, targetDate);
    if (alreadyBooked) {
      log.info('Job already has booking for target date - skipping', {
        jobName: job.name,
        targetDate,
        venue: job.venue,
      });
      return;
    }

    // Parse preferences (handle both old and new schema formats)
    let preferredTime: string;
    let timeFlexibility: number;
    let preferredDuration: number;
    let minDuration: number;
    let strictDuration: boolean;

    // Try new schema first
    const hasNewSchema = 'preferredTime' in job && job.preferredTime !== null;
    if (hasNewSchema) {
      preferredTime = job.preferredTime!;
      timeFlexibility = (job.timeFlexibility as number) ?? 30;
      preferredDuration = (job.preferredDuration as number) ?? 120;
      minDuration = (job.minDuration as number) ?? 60;
      strictDuration = (job.strictDuration as boolean) ?? false;
    } else {
      // Fallback to old schema format
      try {
        const timeSlots = job.timeSlots ? JSON.parse(job.timeSlots) as string[] : ['18:00'];
        const durations = job.durations ? JSON.parse(job.durations) as number[] : [120, 90, 60, 30];

        preferredTime = timeSlots[0] || '18:00';
        timeFlexibility = timeSlots.length > 1 ? 30 : 0;
        preferredDuration = durations[0] || 120;
        minDuration = durations[durations.length - 1] || 60;
        strictDuration = durations.length === 1;
      } catch (error) {
        log.error('Failed to parse job preferences (old schema)', {
          jobName: job.name,
          timeSlots: job.timeSlots,
          durations: job.durations,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    // Generate time slots and durations
    const timeSlots = generateTimeSlots(preferredTime, timeFlexibility);
    const durations = generateDurations(preferredDuration, minDuration, strictDuration);

    log.info('Job preferences parsed', {
      jobName: job.name,
      preferredTime,
      timeFlexibility,
      preferredDuration,
      minDuration,
      strictDuration,
      generatedTimeSlots: timeSlots,
      generatedDurations: durations,
      totalAttempts: timeSlots.length * durations.length,
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
      const loginDuration = Date.now() - loginStartTime;
      log.info('Client authenticated', {
        jobName: job.name,
        email: job.account.email,
        venue: job.venue,
        loginDurationMs: loginDuration,
      });
    } catch (error) {
      log.error('Client authentication FAILED', {
        jobName: job.name,
        email: job.account.email,
        venue: job.venue,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Pre-fetch available courts for each time slot/duration combination
    // This happens 60 seconds before noon so we can book directly at 12:00:00
    const courtAvailability = new Map<string, number[]>();
    const prefetchStartTime = Date.now();

    log.info('Pre-fetching court availability', {
      jobName: job.name,
      targetDate,
      slotsCount: timeSlots.length,
      durationsCount: durations.length,
    });

    for (const duration of durations) {
      for (const timeSlot of timeSlots) {
        const key = `${timeSlot}-${duration}`;
        try {
          const courts = await client.getAvailableCourts(targetDate, timeSlot, duration);
          courtAvailability.set(key, courts.map((c) => c.id));
        } catch (error) {
          log.warn('Failed to pre-fetch courts for slot', {
            jobName: job.name,
            timeSlot,
            duration,
            error: error instanceof Error ? error.message : String(error),
          });
          courtAvailability.set(key, []); // Empty array on failure
        }
      }
    }

    const prefetchDuration = Date.now() - prefetchStartTime;
    const totalCourts = Array.from(courtAvailability.values()).reduce((sum, ids) => sum + ids.length, 0);

    log.info('Court availability pre-fetched', {
      jobName: job.name,
      targetDate,
      slotsWithCourts: Array.from(courtAvailability.entries()).filter(([, ids]) => ids.length > 0).length,
      totalCourts,
      prefetchDurationMs: prefetchDuration,
    });

    // Store prepared job with pre-fetched court availability
    this.preparedJobs.set(job.id, {
      job,
      client,
      targetDate,
      timeSlots,
      durations,
      courtAvailability,
    });

    log.debug('Job prepared and stored', {
      jobId: job.id,
      jobName: job.name,
      targetDate,
      slotsCount: timeSlots.length,
      durationsCount: durations.length,
      courtAvailabilityKeys: Array.from(courtAvailability.keys()),
    });
  }

  /**
   * Execute phase - Called at 12:00:00 PM
   * Execute all prepared jobs (each job runs serial booking attempts)
   */
  async execute(lockManager: LockManager): Promise<JobResult[]> {
    log.info('=== NOON EXECUTION STARTING ===', {
      preparedJobsCount: this.preparedJobs.size,
      activeLocks: lockManager.getActiveLockCount(),
    });
    const executeStartTime = Date.now();

    if (this.preparedJobs.size === 0) {
      log.warn('No prepared jobs to execute');
      return [];
    }

    // Log all jobs about to be executed
    const jobsList = Array.from(this.preparedJobs.values());
    log.info('Executing jobs', {
      count: jobsList.length,
      jobs: jobsList.map((p) => ({
        id: p.job.id,
        name: p.job.name,
        targetDate: p.targetDate,
        preFetchedCourts: Array.from(p.courtAvailability.values()).reduce((sum, ids) => sum + ids.length, 0),
      })),
    });

    // Execute all jobs in parallel (but each job uses serial booking attempts)
    const results = await Promise.allSettled(
      jobsList.map((prepared) => this.executeJob(prepared, lockManager))
    );

    // Process results
    const jobResults: JobResult[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const prepared = jobsList[i];
      const executeStarted = new Date(executeStartTime);

      if (result.status === 'fulfilled') {
        jobResults.push(result.value);
        log.debug('Job execution result', {
          jobName: prepared.job.name,
          status: result.value.status,
          attemptsCount: result.value.attempts.length,
        });

        // Update last attempt with result details (always, even for non-meaningful events)
        const targetDate = getTargetDate(prepared.job);
        await updateLastAttempt(prepared.job.id, result.value, targetDate || undefined);

        // Record history if meaningful
        if (shouldRecordHistory(result.value, 'noon')) {
          try {
            await recordRunHistory(
              prepared.job.id,
              'noon',
              result.value,
              executeStarted,
              new Date()
            );
            log.debug('Run history recorded', {
              jobName: prepared.job.name,
              status: result.value.status,
            });

            // Send failure notification for meaningful failures
            if (result.value.status !== 'success' && isNotificationConfigured()) {
              const targetDate = getTargetDate(prepared.job);
              const reason =
                result.value.errorMessage ||
                'Courts were available but booking failed';

              await notifyBookingFailure({
                jobName: prepared.job.name,
                venue: prepared.job.venue,
                date: targetDate || 'Unknown',
                reason,
                attemptsCount: result.value.attempts.length,
              }).catch((err) => {
                log.warn('Failed to send failure notification', {
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }
          } catch (error) {
            log.error('Failed to record run history', {
              jobName: prepared.job.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        log.error('Job execution rejected', {
          jobName: prepared.job.name,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    // Clear prepared jobs
    this.preparedJobs.clear();

    const executeTime = Date.now() - executeStartTime;
    const successCount = jobResults.filter((r) => r.status === 'success').length;
    const failureCount = jobResults.filter((r) => r.status === 'error' || r.status === 'no_courts').length;
    const lockedCount = jobResults.filter((r) => r.status === 'locked').length;

    log.info('=== NOON EXECUTION COMPLETE ===', {
      totalJobs: jobResults.length,
      successCount,
      failureCount,
      lockedCount,
      durationMs: executeTime,
      avgDurationPerJob: Math.round(executeTime / jobResults.length),
    });

    return jobResults;
  }

  /**
   * Execute a single job - Optimized serial execution with pre-fetched court IDs
   * No availability check at noon - uses pre-fetched court IDs from prep phase
   */
  private async executeJob(
    prepared: PreparedJob,
    lockManager: LockManager
  ): Promise<JobResult> {
    const lockKey = `${prepared.job.accountId}-${prepared.job.venue}-${prepared.targetDate}`;
    const jobStartTime = Date.now();
    const attempts: BookingAttempt[] = [];
    const deferredLogs: Array<{ level: 'info' | 'warn' | 'debug' | 'error'; msg: string; data: object }> = [];

    // Attempt to acquire lock (no logging in critical path)
    if (!lockManager.acquire(lockKey, prepared.job.id)) {
      log.warn('Lock not acquired - job skipped', {
        jobName: prepared.job.name,
        lockKey,
      });
      return {
        jobId: prepared.job.id,
        status: 'locked',
        attempts: [],
      };
    }

    try {
      // Try durations in order (longest first: 120 → 90 → 60)
      for (const duration of prepared.durations) {
        // Try time slots in priority order (preferred first, then +30, -30, etc.)
        for (const timeSlot of prepared.timeSlots) {
          const key = `${timeSlot}-${duration}`;
          const courtIds = prepared.courtAvailability.get(key) || [];

          if (courtIds.length === 0) continue;

          // Try ALL courts for this slot before moving to next slot
          for (const courtId of courtIds) {
            const result = await prepared.client.bookCourt({
              date: prepared.targetDate,
              startTime: timeSlot,
              duration,
              courtId,
            });

            attempts.push({
              date: prepared.targetDate,
              timeSlot,
              duration,
              courtId,
              success: result.success,
              message: result.message || (result.success ? 'Booked successfully' : 'Booking failed'),
              timestamp: new Date(),
              externalId: result.externalId,
              confirmationNumber: result.confirmationNumber,
            });

            if (result.success) {
              // SUCCESS - defer logging, handle post-booking tasks
              deferredLogs.push({
                level: 'info',
                msg: 'BOOKING SUCCESS!',
                data: {
                  jobName: prepared.job.name,
                  date: prepared.targetDate,
                  timeSlot,
                  duration,
                  courtId,
                  totalAttempts: attempts.length,
                  durationMs: Date.now() - jobStartTime,
                },
              });

              // Fetch reservation details if not returned
              let externalId = result.externalId;
              let confirmationNumber = result.confirmationNumber;

              if (!externalId) {
                const details = await prepared.client.fetchReservationDetails(
                  prepared.targetDate,
                  timeSlot
                );
                if (details) {
                  externalId = details.externalId;
                  confirmationNumber = details.confirmationNumber;
                }
              }

              // Record reservation to database
              await recordReservation(
                prepared.job,
                attempts[attempts.length - 1],
                externalId,
                confirmationNumber
              );

              // Update job timestamps
              await updateJobTimestamps(prepared.job.id, prepared.job.recurrence);

              // Archive if one-time job
              if (prepared.job.recurrence === 'once') {
                await archiveJob(prepared.job.id);
              }

              // Flush deferred logs
              this.flushLogs(deferredLogs);

              return {
                jobId: prepared.job.id,
                status: 'success',
                attempts,
                courtId,
                date: prepared.targetDate,
                startTime: timeSlot,
                duration,
              };
            }

            // If window closed, stop trying entirely (won't succeed)
            if (result.windowClosed || result.message?.includes('only allowed to reserve up to')) {
              deferredLogs.push({
                level: 'warn',
                msg: 'Booking window not open',
                data: {
                  jobName: prepared.job.name,
                  timeSlot,
                  message: result.message,
                },
              });
              this.flushLogs(deferredLogs);

              return {
                jobId: prepared.job.id,
                status: 'window_closed',
                attempts,
                errorMessage: 'Booking window not open yet',
              };
            }

            // Court taken - immediately try next court (no delay, no logging)
          }
        }
      }

      // All courts/slots exhausted
      deferredLogs.push({
        level: 'warn',
        msg: 'All slots failed',
        data: {
          jobName: prepared.job.name,
          targetDate: prepared.targetDate,
          totalAttempts: attempts.length,
          durationMs: Date.now() - jobStartTime,
        },
      });
      this.flushLogs(deferredLogs);

      return {
        jobId: prepared.job.id,
        status: 'no_courts',
        attempts,
      };
    } catch (error) {
      deferredLogs.push({
        level: 'error',
        msg: 'Job execution error',
        data: {
          jobName: prepared.job.name,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - jobStartTime,
        },
      });
      this.flushLogs(deferredLogs);

      return {
        jobId: prepared.job.id,
        status: 'error',
        attempts,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Always release the lock
      lockManager.release(lockKey, prepared.job.id);
    }
  }

  /**
   * Flush deferred logs (called after booking completes)
   */
  private flushLogs(logs: Array<{ level: 'info' | 'warn' | 'debug' | 'error'; msg: string; data: object }>): void {
    for (const { level, msg, data } of logs) {
      log[level](msg, data);
    }
  }

  /**
   * Get number of prepared jobs
   */
  getPreparedJobCount(): number {
    return this.preparedJobs.size;
  }
}
