/**
 * Noon Mode Handler - High-performance parallel booking at 12:00 PM PST
 * With extensive logging for debugging
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
} from './job-processor';
import { createLogger } from '../logger';

const log = createLogger('Scheduler:NoonMode');

export class NoonModeHandler {
  private preparedJobs: Map<string, PreparedJob> = new Map();

  constructor() {
    log.debug('NoonModeHandler initialized');
  }

  /**
   * Prepare phase - Called at 11:59:50 AM (10 seconds before noon)
   * Pre-authenticate clients, calculate target dates, generate time slots
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

    // Calculate target date (7 days ahead)
    const targetDate = getTargetDate(job);
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

    // Store prepared job
    this.preparedJobs.set(job.id, {
      job,
      client,
      targetDate,
      timeSlots,
      durations,
    });

    log.debug('Job prepared and stored', {
      jobId: job.id,
      jobName: job.name,
      targetDate,
      slotsCount: timeSlots.length,
      durationsCount: durations.length,
    });
  }

  /**
   * Execute phase - Called at 12:00:00 PM
   * Execute all prepared jobs in parallel
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
    log.info('Executing jobs in PARALLEL', {
      count: jobsList.length,
      jobs: jobsList.map((p) => ({
        id: p.job.id,
        name: p.job.name,
        targetDate: p.targetDate,
        slotsCount: p.timeSlots.length,
        durationsCount: p.durations.length,
      })),
    });

    // Execute all jobs in parallel
    const results = await Promise.allSettled(
      jobsList.map((prepared) => this.executeJob(prepared, lockManager))
    );

    // Process results
    const jobResults: JobResult[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const prepared = jobsList[i];

      if (result.status === 'fulfilled') {
        jobResults.push(result.value);
        log.debug('Job execution result', {
          jobName: prepared.job.name,
          status: result.value.status,
          attemptsCount: result.value.attempts.length,
        });
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
   * Execute a single job
   */
  private async executeJob(
    prepared: PreparedJob,
    lockManager: LockManager
  ): Promise<JobResult> {
    const lockKey = `${prepared.job.accountId}-${prepared.job.venue}-${prepared.targetDate}`;
    const jobStartTime = Date.now();

    log.debug('Executing job', {
      jobId: prepared.job.id,
      jobName: prepared.job.name,
      targetDate: prepared.targetDate,
      timeSlots: prepared.timeSlots,
      durations: prepared.durations,
      lockKey,
    });

    // Attempt to acquire lock
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

    log.trace('Lock acquired for job', { jobName: prepared.job.name, lockKey });
    const attempts: BookingAttempt[] = [];

    try {
      // Try durations in order (longest first)
      for (const duration of prepared.durations) {
        log.info('Trying duration with parallel time slots', {
          jobName: prepared.job.name,
          duration,
          slotsCount: prepared.timeSlots.length,
          slots: prepared.timeSlots,
        });

        // Try ALL time slots in PARALLEL for speed (user requested parallel mode)
        const slotAttempts = await Promise.allSettled(
          prepared.timeSlots.map(async (timeSlot) => {
            try {
              // Check court availability
              const courts = await prepared.client.getAvailableCourts(
                prepared.targetDate,
                timeSlot,
                duration
              );

              if (courts.length === 0) {
                throw new Error('No courts available');
              }

              // Book the first available court
              const result = await prepared.client.bookCourt({
                date: prepared.targetDate,
                startTime: timeSlot,
                duration,
                courtId: courts[0].id,
              });

              if (!result.success) {
                throw new Error(result.message || 'Booking failed');
              }

              return {
                date: prepared.targetDate,
                timeSlot,
                duration,
                courtId: courts[0].id,
                success: true,
                message: 'Booked successfully',
                timestamp: new Date(),
              };
            } catch (error) {
              return {
                date: prepared.targetDate,
                timeSlot,
                duration,
                success: false,
                message: error instanceof Error ? error.message : String(error),
                timestamp: new Date(),
              };
            }
          })
        );

        // Collect all attempts
        for (const attemptResult of slotAttempts) {
          if (attemptResult.status === 'fulfilled') {
            attempts.push(attemptResult.value);
          }
        }

        // Check if any slot succeeded
        const successfulAttempt = attempts.find((a) => a.success);
        if (successfulAttempt) {
          log.info('BOOKING SUCCESS!', {
            jobName: prepared.job.name,
            date: successfulAttempt.date,
            timeSlot: successfulAttempt.timeSlot,
            duration: successfulAttempt.duration,
            courtId: successfulAttempt.courtId,
            totalAttempts: attempts.length,
            durationMs: Date.now() - jobStartTime,
          });

          // Record reservation
          log.debug('Recording reservation to database', { jobName: prepared.job.name });
          await recordReservation(prepared.job, successfulAttempt);

          // Update job timestamps
          log.debug('Updating job timestamps', { jobId: prepared.job.id });
          await updateJobTimestamps(prepared.job.id, prepared.job.recurrence);

          // Archive if one-time job
          if (prepared.job.recurrence === 'once') {
            log.info('Archiving one-time job after success', { jobId: prepared.job.id });
            await archiveJob(prepared.job.id);
          }

          return {
            jobId: prepared.job.id,
            status: 'success',
            attempts,
            courtId: successfulAttempt.courtId,
            date: successfulAttempt.date,
            startTime: successfulAttempt.timeSlot,
            duration: successfulAttempt.duration,
          };
        }

        log.debug('No successful booking for this duration', {
          jobName: prepared.job.name,
          duration,
          attemptsSoFar: attempts.length,
        });
      }

      // No successful bookings
      log.warn('No courts available for any slot/duration combination', {
        jobName: prepared.job.name,
        targetDate: prepared.targetDate,
        slotsAttempted: prepared.timeSlots.length,
        durationsAttempted: prepared.durations.length,
        totalAttempts: attempts.length,
        durationMs: Date.now() - jobStartTime,
      });

      return {
        jobId: prepared.job.id,
        status: 'no_courts',
        attempts,
      };
    } catch (error) {
      log.error('Job execution error', {
        jobName: prepared.job.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - jobStartTime,
      });
      return {
        jobId: prepared.job.id,
        status: 'error',
        attempts,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Always release the lock
      log.trace('Releasing lock', { jobName: prepared.job.name, lockKey });
      lockManager.release(lockKey, prepared.job.id);
    }
  }

  /**
   * Get number of prepared jobs
   */
  getPreparedJobCount(): number {
    return this.preparedJobs.size;
  }
}
