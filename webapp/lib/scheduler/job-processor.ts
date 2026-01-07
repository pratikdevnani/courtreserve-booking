/**
 * Shared job processing utilities
 * With extensive logging for debugging
 */

import { prisma } from '../prisma';
import { JobWithAccount, BookingAttempt, JobResult } from './types';
import { addDays, format, startOfDay } from 'date-fns';
import { createLogger } from '../logger';
import { notifyBookingSuccess, notifyBookingFailure, isNotificationConfigured } from '../notifications';

const log = createLogger('Scheduler:JobProcessor');

/**
 * Calculate target date for booking (7 days ahead)
 * @param job - Booking job
 * @returns Date string in YYYY-MM-DD format, or null if no valid date
 */
export function getTargetDate(job: JobWithAccount): string | null {
  const today = startOfDay(new Date());
  const targetDate = addDays(today, 7); // Book 7 days ahead

  log.trace('Calculating target date', {
    jobName: job.name,
    recurrence: job.recurrence,
    today: format(today, 'yyyy-MM-dd'),
    targetDate: format(targetDate, 'yyyy-MM-dd'),
    targetDayName: format(targetDate, 'EEEE'),
  });

  // For recurring jobs, check if target date matches one of the configured days
  if (job.recurrence === 'weekly') {
    try {
      const days = JSON.parse(job.days) as string[];
      const dayName = format(targetDate, 'EEEE'); // Monday, Tuesday, etc.

      log.trace('Weekly job day check', {
        jobName: job.name,
        configuredDays: days,
        targetDayName: dayName,
        matches: days.includes(dayName),
      });

      if (!days.includes(dayName)) {
        log.debug('Target date does not match configured days', {
          jobName: job.name,
          targetDayName: dayName,
          configuredDays: days,
        });
        return null; // Target date doesn't match configured days
      }
    } catch (error) {
      log.error('Failed to parse days JSON for weekly job', {
        jobName: job.name,
        days: job.days,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // For one-time jobs, check if the specific date matches
  if (job.recurrence === 'once') {
    try {
      const days = JSON.parse(job.days) as string[];
      const targetDateStr = format(targetDate, 'yyyy-MM-dd');

      log.trace('One-time job date check', {
        jobName: job.name,
        configuredDates: days,
        targetDate: targetDateStr,
        matches: days.includes(targetDateStr),
      });

      if (!days.includes(targetDateStr)) {
        log.debug('Target date does not match configured date for one-time job', {
          jobName: job.name,
          targetDate: targetDateStr,
          configuredDates: days,
        });
        return null; // Target date doesn't match configured date
      }
    } catch (error) {
      log.error('Failed to parse days JSON for one-time job', {
        jobName: job.name,
        days: job.days,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  const result = format(targetDate, 'yyyy-MM-dd');
  log.debug('Target date calculated', {
    jobName: job.name,
    targetDate: result,
  });

  return result;
}

/**
 * Get all target dates within the booking window
 * @param job - Booking job
 * @returns Array of date strings in YYYY-MM-DD format
 */
export function getTargetDates(job: JobWithAccount): string[] {
  const today = startOfDay(new Date());
  const dates: string[] = [];

  log.trace('Getting target dates for job', {
    jobName: job.name,
    recurrence: job.recurrence,
    today: format(today, 'yyyy-MM-dd'),
  });

  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const checkDate = addDays(today, i);

    if (job.recurrence === 'weekly') {
      try {
        const days = JSON.parse(job.days) as string[];
        const dayName = format(checkDate, 'EEEE');

        if (days.includes(dayName)) {
          dates.push(format(checkDate, 'yyyy-MM-dd'));
        }
      } catch (error) {
        log.error('Failed to parse days JSON for weekly job', {
          jobName: job.name,
          days: job.days,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (job.recurrence === 'once') {
      try {
        const days = JSON.parse(job.days) as string[];
        const dateStr = format(checkDate, 'yyyy-MM-dd');

        if (days.includes(dateStr)) {
          dates.push(dateStr);
        }
      } catch (error) {
        log.error('Failed to parse days JSON for one-time job', {
          jobName: job.name,
          days: job.days,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  log.debug('Target dates calculated', {
    jobName: job.name,
    targetDatesCount: dates.length,
    targetDates: dates,
  });

  return dates;
}

/**
 * Count existing reservations for an account/venue/date
 */
export async function countExistingBookings(
  accountId: string,
  venue: string,
  date: string
): Promise<number> {
  log.trace('Counting existing bookings', { accountId, venue, date });

  const count = await prisma.reservation.count({
    where: {
      accountId,
      venue,
      date,
    },
  });

  log.trace('Existing bookings count', { accountId, venue, date, count });
  return count;
}

/**
 * Check if a reservation already exists
 */
export async function hasExistingReservation(
  accountId: string,
  venue: string,
  date: string
): Promise<boolean> {
  log.trace('Checking for existing reservation', { accountId, venue, date });
  const count = await countExistingBookings(accountId, venue, date);
  const hasReservation = count > 0;
  log.trace('Existing reservation check result', { accountId, venue, date, hasReservation });
  return hasReservation;
}

/**
 * Record a successful reservation in the database
 */
export async function recordReservation(
  job: JobWithAccount,
  attempt: BookingAttempt
): Promise<void> {
  log.debug('Recording reservation', {
    jobId: job.id,
    jobName: job.name,
    date: attempt.date,
    timeSlot: attempt.timeSlot,
    duration: attempt.duration,
    courtId: attempt.courtId,
  });

  if (!attempt.success || !attempt.courtId) {
    log.error('Cannot record unsuccessful attempt as reservation', {
      jobId: job.id,
      success: attempt.success,
      courtId: attempt.courtId,
    });
    throw new Error('Cannot record unsuccessful attempt as reservation');
  }

  const reservation = await prisma.reservation.create({
    data: {
      accountId: job.accountId,
      venue: job.venue,
      courtId: attempt.courtId.toString(),
      date: attempt.date,
      startTime: attempt.timeSlot,
      duration: attempt.duration,
      bookingJobId: job.id,
      bookedAt: new Date(),
    },
  });

  log.info('Reservation recorded successfully', {
    reservationId: reservation.id,
    email: job.account.email,
    venue: job.venue,
    date: attempt.date,
    timeSlot: attempt.timeSlot,
    duration: attempt.duration,
    courtId: attempt.courtId,
  });

  // Send success notification
  if (isNotificationConfigured()) {
    log.debug('Sending booking success notification');
    await notifyBookingSuccess({
      jobName: job.name,
      venue: job.venue,
      date: attempt.date,
      time: attempt.timeSlot,
      duration: attempt.duration,
      courtId: attempt.courtId,
    }).catch((err) => {
      log.warn('Failed to send success notification', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Record run history in the database
 */
export async function recordRunHistory(
  jobId: string,
  mode: 'noon' | 'polling' | 'manual',
  result: JobResult,
  startedAt: Date,
  completedAt: Date
): Promise<void> {
  const durationMs = completedAt.getTime() - startedAt.getTime();

  log.debug('Recording run history', {
    jobId,
    mode,
    status: result.status,
    attemptsCount: result.attempts.length,
    durationMs,
  });

  const history = await prisma.bookingRunHistory.create({
    data: {
      bookingJobId: jobId,
      startedAt,
      completedAt,
      status: result.status,
      attempts: JSON.stringify(result.attempts),
      successCount: result.attempts.filter((a) => a.success).length,
      failureCount: result.attempts.filter((a) => !a.success).length,
      errorMessage: result.errorMessage,
      // Note: runMode and durationMs will need to be added to schema
    },
  });

  log.trace('Run history recorded', { historyId: history.id, jobId, mode });
}

/**
 * Update job's lastRun and nextRun timestamps
 */
export async function updateJobTimestamps(
  jobId: string,
  recurrence: string
): Promise<void> {
  const now = new Date();

  // For recurring jobs, set nextRun to tomorrow at noon Pacific
  let nextRun: Date | null = null;
  if (recurrence === 'weekly') {
    nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setHours(12, 0, 0, 0);
  }

  log.debug('Updating job timestamps', {
    jobId,
    recurrence,
    lastRun: now.toISOString(),
    nextRun: nextRun?.toISOString() || null,
  });

  await prisma.bookingJob.update({
    where: { id: jobId },
    data: {
      lastRun: now,
      nextRun,
    },
  });

  log.trace('Job timestamps updated', { jobId });
}

/**
 * Archive a one-time job after successful booking
 */
export async function archiveJob(jobId: string): Promise<void> {
  log.info('Archiving one-time job', { jobId });

  await prisma.bookingJob.update({
    where: { id: jobId },
    data: {
      active: false,
      // Note: archived field will need to be added to schema
    },
  });

  log.info('Job archived successfully', { jobId });
}

/**
 * Send notification when all booking attempts failed
 */
export async function notifyJobFailure(
  job: JobWithAccount,
  targetDate: string,
  reason: string,
  attemptsCount: number
): Promise<void> {
  if (!isNotificationConfigured()) {
    return;
  }

  log.debug('Sending booking failure notification', {
    jobName: job.name,
    targetDate,
    reason,
    attemptsCount,
  });

  await notifyBookingFailure({
    jobName: job.name,
    venue: job.venue,
    date: targetDate,
    reason,
    attemptsCount,
  }).catch((err) => {
    log.warn('Failed to send failure notification', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Fetch active jobs with account details
 */
export async function fetchActiveJobs(): Promise<JobWithAccount[]> {
  log.debug('Fetching active jobs from database');

  const jobs = await prisma.bookingJob.findMany({
    where: {
      active: true,
    },
    include: {
      account: {
        select: {
          id: true,
          email: true,
          password: true,
          venue: true,
        },
      },
    },
    orderBy: [
      // Note: priority field will need to be added to schema
      { createdAt: 'asc' },
    ],
  });

  log.info('Active jobs fetched', {
    count: jobs.length,
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      venue: j.venue,
      recurrence: j.recurrence,
      email: j.account.email,
    })),
  });

  return jobs as JobWithAccount[];
}

/**
 * Fetch jobs that need bookings (for polling mode)
 */
export async function fetchJobsNeedingBookings(): Promise<JobWithAccount[]> {
  log.debug('Fetching jobs that need bookings');

  const jobs = await fetchActiveJobs();

  // Filter to jobs that don't have bookings for their target dates
  const jobsNeedingBookings: JobWithAccount[] = [];

  for (const job of jobs) {
    const targetDates = getTargetDates(job);

    log.trace('Checking job for missing bookings', {
      jobName: job.name,
      targetDatesCount: targetDates.length,
    });

    for (const targetDate of targetDates) {
      const hasBooking = await hasExistingReservation(job.accountId, job.venue, targetDate);

      if (!hasBooking) {
        log.debug('Job needs booking for date', {
          jobName: job.name,
          targetDate,
        });
        jobsNeedingBookings.push(job);
        break; // Only add job once, even if multiple dates need booking
      }
    }
  }

  log.info('Jobs needing bookings', {
    totalActive: jobs.length,
    needingBookings: jobsNeedingBookings.length,
    jobs: jobsNeedingBookings.map((j) => j.name),
  });

  return jobsNeedingBookings;
}
