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
 * Get the maximum booking date based on residency and time of day
 * - Before noon Pacific: Residents day+7, Non-residents day+6
 * - At/after noon Pacific: Residents day+8, Non-residents day+7
 */
function getMaxBookingDate(isResident: boolean): Date {
  const now = new Date();
  const pacificHour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
  );

  const isAfterNoon = pacificHour >= 12;

  let daysAhead: number;
  if (isResident) {
    daysAhead = isAfterNoon ? 8 : 7;
  } else {
    daysAhead = isAfterNoon ? 7 : 6;
  }

  const maxDate = addDays(startOfDay(now), daysAhead);
  // Set to end of day (11:59:59 PM)
  maxDate.setHours(23, 59, 59, 999);

  log.trace('Calculated max booking date', {
    isResident,
    pacificHour,
    isAfterNoon,
    daysAhead,
    maxDate: format(maxDate, 'yyyy-MM-dd HH:mm:ss'),
  });

  return maxDate;
}

/**
 * Get today's date in Pacific timezone (where CourtReserve operates)
 */
function getTodayPacific(): Date {
  const now = new Date();
  // Get date string in Pacific timezone (YYYY-MM-DD format)
  const pacificDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  // Parse as a date (at midnight local time, but we only care about the date portion)
  const [year, month, day] = pacificDateStr.split('-').map(Number);
  const result = new Date(year, month - 1, day, 0, 0, 0, 0);
  
  // Diagnostic logging
  log.debug('getTodayPacific calculation', {
    nowUTC: now.toISOString(),
    nowPST: now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    nowLocal: now.toString(),
    pacificDateStr,
    resultLocal: result.toString(),
    resultUTC: result.toISOString(),
  });
  
  return result;
}

/**
 * Calculate target date for booking (8 days ahead in Pacific time)
 * @param job - Booking job
 * @param skipWindowCheck - Skip booking window validation (for noon mode prep)
 * @returns Date string in YYYY-MM-DD format, or null if no valid date
 */
export function getTargetDate(job: JobWithAccount, skipWindowCheck = false): string | null {
  const today = getTodayPacific();
  const targetDate = addDays(today, 8); // Book 8 days ahead

  log.trace('Calculating target date', {
    jobName: job.name,
    recurrence: job.recurrence,
    today: format(today, 'yyyy-MM-dd'),
    targetDate: format(targetDate, 'yyyy-MM-dd'),
    targetDayName: format(targetDate, 'EEEE'),
    skipWindowCheck,
    pacificTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  });

  // Check if target date is within booking window
  // Skip this check for noon mode - we know the window opens at execution time (12:00 PM)
  if (!skipWindowCheck) {
    const isResident = job.account.isResident ?? true;
    const maxBookingDate = getMaxBookingDate(isResident);

    if (targetDate > maxBookingDate) {
      log.debug('Target date beyond booking window', {
        jobName: job.name,
        targetDate: format(targetDate, 'yyyy-MM-dd'),
        maxBookingDate: format(maxBookingDate, 'yyyy-MM-dd'),
        isResident,
      });
      return null;
    }
  }

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
  attempt: BookingAttempt,
  externalId?: string,
  confirmationNumber?: string
): Promise<void> {
  log.debug('Recording reservation', {
    jobId: job.id,
    jobName: job.name,
    date: attempt.date,
    timeSlot: attempt.timeSlot,
    duration: attempt.duration,
    courtId: attempt.courtId,
    externalId,
    confirmationNumber,
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
      externalId: externalId || null,
      confirmationNumber: confirmationNumber || null,
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
 * Update last attempt timestamp and result details for a job
 */
export async function updateLastAttempt(
  jobId: string,
  result: JobResult,
  targetDate?: string
): Promise<void> {
  const now = new Date();

  log.trace('Updating last attempt with result', {
    jobId,
    timestamp: now.toISOString(),
    status: result.status,
    targetDate: targetDate || result.date,
  });

  await prisma.bookingJob.update({
    where: { id: jobId },
    data: {
      lastAttemptAt: now,
      lastAttemptStatus: result.status,
      lastAttemptMessage: formatResultMessage(result),
      lastAttemptDate: targetDate || result.date,
    },
  });

  log.trace('Last attempt updated with result details', { jobId });
}

/**
 * Format a human-readable message from job result
 */
function formatResultMessage(result: JobResult): string {
  if (result.status === 'success') {
    const attempt = result.attempts.find((a) => a.success);
    if (attempt) {
      return `Court ${attempt.courtId} at ${attempt.timeSlot}`;
    }
    return 'Booking successful';
  }

  if (result.status === 'no_courts') {
    // Show how many slots were tried for context
    const slotsCount = result.attempts.length;
    if (slotsCount > 1) {
      return `Tried ${slotsCount} slots, none available`;
    }
    return 'No courts available';
  }

  if (result.status === 'window_closed') {
    return result.errorMessage || 'Booking window not open yet';
  }

  if (result.status === 'locked') {
    return 'Skipped (another job running)';
  }

  if (result.status === 'error') {
    // Truncate long error messages
    const msg = result.errorMessage || 'Error occurred';
    return msg.length > 50 ? msg.substring(0, 47) + '...' : msg;
  }

  return result.errorMessage || 'Unknown status';
}

/**
 * Determine if a job result should be recorded in run history
 */
export function shouldRecordHistory(result: JobResult, mode: 'noon' | 'polling' | 'manual'): boolean {
  // Always record success
  if (result.status === 'success') {
    log.trace('Should record history: success', { jobId: result.jobId });
    return true;
  }

  // Always record unexpected errors
  if (result.status === 'error') {
    log.trace('Should record history: error', { jobId: result.jobId });
    return true;
  }

  // For noon mode: record if we found courts but couldn't book
  // (indicates we should have gotten the slot but lost the race)
  if (mode === 'noon') {
    const foundCourtsButFailed = result.attempts.some(
      (a) => a.courtId !== undefined && !a.success
    );
    if (foundCourtsButFailed) {
      log.trace('Should record history: noon mode found courts but failed', { jobId: result.jobId });
      return true;
    }
  }

  // Don't record: no_courts, locked, window_closed
  log.trace('Should NOT record history', {
    jobId: result.jobId,
    status: result.status,
    mode,
  });
  return false;
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
          isResident: true,
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
