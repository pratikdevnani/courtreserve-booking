/**
 * Job Scheduler for Court Booking
 *
 * This module handles the execution of booking jobs by:
 * 1. Fetching active booking jobs from the database
 * 2. Determining which jobs need to run based on their schedule
 * 3. Executing Python booking scripts with the appropriate configuration
 * 4. Recording successful reservations back to the database
 */

import { spawn } from 'child_process'
import path from 'path'
import { addDays, addWeeks, format, parse, startOfDay } from 'date-fns'
import { prisma } from './prisma'

// Get the root directory - use process.cwd() for the current working directory
// In Docker, Python scripts are copied to the same directory as the app
const ROOT_DIR = process.cwd()
const PYTHON_SCRIPTS = {
  sunnyvale: path.join(ROOT_DIR, 'book_court_sunnyvale.py'),
  santa_clara: path.join(ROOT_DIR, 'book_court_santa_clara.py'),
}

export type BookingJob = {
  id: string
  name: string
  accountId: string
  venue: string
  recurrence: string
  slotMode: string
  days: string
  timeSlots: string
  durations: string
  active: boolean
  lastRun: Date | null
  nextRun: Date | null
  account: {
    email: string
    password: string
  }
}

/**
 * Calculate the next target date for a booking job
 */
export function calculateNextTargetDate(
  job: BookingJob,
  fromDate: Date = new Date()
): Date | null {
  const days: string[] = JSON.parse(job.days)
  const today = startOfDay(fromDate)

  // If days contain specific dates (YYYY-MM-DD format)
  const specificDates = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (specificDates.length > 0) {
    // Find the next future date
    const futureDates = specificDates
      .map((d) => parse(d, 'yyyy-MM-dd', new Date()))
      .filter((d) => d >= today)
      .sort((a, b) => a.getTime() - b.getTime())

    if (futureDates.length > 0) {
      return futureDates[0]
    }

    // If recurring weekly, cycle through the dates
    if (job.recurrence === 'weekly') {
      const dates = specificDates.map((d) => parse(d, 'yyyy-MM-dd', new Date()))
      // Find next occurrence by adding weeks
      const nearest = dates.reduce((prev, curr) => {
        const prevDiff = (prev.getTime() - today.getTime()) % (7 * 24 * 60 * 60 * 1000)
        const currDiff = (curr.getTime() - today.getTime()) % (7 * 24 * 60 * 60 * 1000)
        return prevDiff < currDiff ? prev : curr
      })
      return addWeeks(nearest, 1)
    }

    return null // No future dates and not recurring
  }

  // If days contain weekday names
  const weekdayMap: { [key: string]: number } = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  }

  const targetWeekdays = days
    .filter((d) => d in weekdayMap)
    .map((d) => weekdayMap[d])
    .sort((a, b) => a - b)

  if (targetWeekdays.length === 0) {
    return null
  }

  // Find the next occurrence of any target weekday
  for (let i = 0; i < 7; i++) {
    const checkDate = addDays(today, i)
    if (targetWeekdays.includes(checkDate.getDay())) {
      return checkDate
    }
  }

  return null
}

/**
 * Parse time slot in format "HH:MM" or "HH:MM-DURATION"
 * Returns { time: "HH:MM", duration: number (in minutes) }
 */
function parseTimeSlot(timeSlot: string): { time: string; duration: number } {
  const parts = timeSlot.split('-')

  if (parts.length === 2) {
    // New format: "HH:MM-DURATION"
    return {
      time: parts[0],
      duration: parseInt(parts[1], 10),
    }
  }

  // Old format: just "HH:MM", default to 60 minutes
  return {
    time: timeSlot,
    duration: 60,
  }
}

/**
 * Execute a Python booking script
 */
export async function executeBookingScript(
  job: BookingJob,
  targetDate: Date,
  timeSlot: string
): Promise<{ success: boolean; output: string; courtId?: string; duration: number }> {
  const scriptPath = PYTHON_SCRIPTS[job.venue as keyof typeof PYTHON_SCRIPTS]
  if (!scriptPath) {
    throw new Error(`Unknown venue: ${job.venue}`)
  }

  const { time, duration } = parseTimeSlot(timeSlot)
  const dateStr = format(targetDate, 'yyyy-MM-dd')
  const env = {
    ...process.env,
    CR_EMAIL_1: job.account.email,
    CR_PASSWORD_1: job.account.password,
    CR_DATE: dateStr,
    CR_START_TIME: time,
    CR_DURATION: duration.toString(),
    CR_SINGLE_SHOT: '1',  // Single-shot mode for scheduler
    DEBUG: '1',  // Enable detailed logging
  }

  console.log(`[Scheduler] Executing booking: ${job.name} for ${dateStr} at ${time} (${duration}min)`)

  return new Promise((resolve) => {
    const python = spawn('python3', [scriptPath], { env })
    let output = ''
    let errorOutput = ''

    python.stdout.on('data', (data) => {
      const text = data.toString()
      output += text
      // Log Python output in real-time
      process.stdout.write(text)
    })

    python.stderr.on('data', (data) => {
      const text = data.toString()
      errorOutput += text
      // Log Python errors in real-time
      process.stderr.write(text)
    })

    python.on('close', (code) => {
      const fullOutput = output + errorOutput
      // Better success detection: look for actual booking success message
      const success = code === 0 && (
        fullOutput.includes('✅') &&
        fullOutput.includes('Booked') &&
        !fullOutput.includes('❌ No courts available')
      )

      // Try to extract court ID from output
      const courtMatch = fullOutput.match(/court (\d+)/i)
      const courtId = courtMatch ? courtMatch[1] : undefined

      console.log(`[Scheduler] Python script exited with code ${code}`)
      if (success) {
        console.log(`[Scheduler] ✅ Booking successful!`)
      } else {
        console.log(`[Scheduler] ❌ No booking made (no available courts or error)`)
      }

      resolve({
        success,
        output: fullOutput,
        courtId,
        duration,
      })
    })
  })
}

/**
 * Generate multiple target dates for multi-week booking
 * For weekly jobs with weekdays, generates next N occurrences of each day
 */
function generateTargetDates(job: BookingJob, weeksAhead: number = 2): Date[] {
  const days: string[] = JSON.parse(job.days)
  const today = startOfDay(new Date())
  const targetDates: Date[] = []

  // Handle specific dates (YYYY-MM-DD format)
  const specificDates = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (specificDates.length > 0) {
    // For specific dates, just return those dates if they're in the future
    specificDates.forEach((dateStr) => {
      const date = parse(dateStr, 'yyyy-MM-dd', new Date())
      if (date >= today) {
        targetDates.push(date)
      }
    })
    return targetDates
  }

  // Handle weekday names - find next N occurrences of each weekday
  const weekdayMap: { [key: string]: number } = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  }

  const targetWeekdays = days
    .filter((d) => d in weekdayMap)
    .map((d) => weekdayMap[d])

  if (targetWeekdays.length === 0) {
    return targetDates
  }

  // For each target weekday, find next N occurrences
  targetWeekdays.forEach((weekday) => {
    // Find the first occurrence of this weekday
    let checkDate = today
    for (let i = 0; i < 7; i++) {
      const testDate = addDays(today, i)
      if (testDate.getDay() === weekday) {
        checkDate = testDate
        break
      }
    }

    // Add this weekday for the next N weeks
    for (let week = 0; week < weeksAhead; week++) {
      targetDates.push(addWeeks(checkDate, week))
    }
  })

  // Sort dates chronologically
  return targetDates.sort((a, b) => a.getTime() - b.getTime())
}

/**
 * Process a single booking job
 */
export async function processBookingJob(job: BookingJob): Promise<void> {
  console.log(`[Scheduler] Processing job: ${job.name} (${job.id})`)

  const startedAt = new Date()
  const attempts: Array<{
    date: string
    timeSlot: string
    success: boolean
    message: string
    courtId?: string
    duration?: number
  }> = []

  // Generate target dates for the next 2 weeks
  const targetDates = generateTargetDates(job, 2)

  if (targetDates.length === 0) {
    console.log(`[Scheduler] No target dates found for job ${job.name}`)

    // Record the run with no attempts (with graceful fallback)
    try {
      await prisma.bookingRunHistory.create({
        data: {
          bookingJobId: job.id,
          startedAt,
          completedAt: new Date(),
          status: 'failed',
          attempts: JSON.stringify([]),
          successCount: 0,
          failureCount: 0,
          errorMessage: 'No target dates found',
        },
      })
    } catch (historyError) {
      console.error('[Scheduler] Failed to record run history:', historyError)
    }
    return
  }

  console.log(`[Scheduler] Found ${targetDates.length} target date(s): ${targetDates.map(d => format(d, 'yyyy-MM-dd (EEE)')).join(', ')}`)

  const timeSlots: string[] = JSON.parse(job.timeSlots)
  let totalBookings = 0

  // Try to book for each target date
  for (const targetDate of targetDates) {
    console.log(`[Scheduler] Attempting booking for: ${format(targetDate, 'yyyy-MM-dd (EEEE)')}`)
    const dateStr = format(targetDate, 'yyyy-MM-dd')
    let bookedForThisDate = false

    if (job.slotMode === 'single') {
      // Single slot mode: try to book first available slot for this date
      for (const timeSlot of timeSlots) {
        const result = await executeBookingScript(job, targetDate, timeSlot)
        const { time } = parseTimeSlot(timeSlot)

        if (result.success) {
          // Record the reservation
          await prisma.reservation.create({
            data: {
              accountId: job.accountId,
              venue: job.venue,
              courtId: result.courtId,
              date: dateStr,
              startTime: time,
              duration: result.duration,
              bookingJobId: job.id,
            },
          })

          attempts.push({
            date: dateStr,
            timeSlot: time,
            success: true,
            message: `Booked court ${result.courtId || 'unknown'}`,
            courtId: result.courtId,
            duration: result.duration,
          })

          console.log(`[Scheduler] ✅ Successfully booked ${dateStr} at ${time} (${result.duration}min)`)
          totalBookings++
          bookedForThisDate = true
          break // Move to next date after successful booking
        } else {
          // Extract meaningful error message from output
          let message = 'No courts available'
          if (result.output.includes('Booking window not open yet')) {
            message = 'Booking window not open yet'
          } else if (result.output.includes('already used')) {
            message = 'All courts already attempted'
          }

          attempts.push({
            date: dateStr,
            timeSlot: time,
            success: false,
            message,
          })
        }
      }
    } else {
      // Multi slot mode: try to book for this specific date
      for (const timeSlot of timeSlots) {
        const result = await executeBookingScript(job, targetDate, timeSlot)
        const { time } = parseTimeSlot(timeSlot)

        if (result.success) {
          await prisma.reservation.create({
            data: {
              accountId: job.accountId,
              venue: job.venue,
              courtId: result.courtId,
              date: dateStr,
              startTime: time,
              duration: result.duration,
              bookingJobId: job.id,
            },
          })

          attempts.push({
            date: dateStr,
            timeSlot: time,
            success: true,
            message: `Booked court ${result.courtId || 'unknown'}`,
            courtId: result.courtId,
            duration: result.duration,
          })

          console.log(`[Scheduler] ✅ Successfully booked ${dateStr} at ${time} (${result.duration}min)`)
          totalBookings++
          bookedForThisDate = true
          break // Move to next date after successful booking
        } else {
          let message = 'No courts available'
          if (result.output.includes('Booking window not open yet')) {
            message = 'Booking window not open yet'
          } else if (result.output.includes('already used')) {
            message = 'All courts already attempted'
          }

          attempts.push({
            date: dateStr,
            timeSlot: time,
            success: false,
            message,
          })
        }
      }
    }

    // If we didn't book for this date, add a summary attempt
    if (!bookedForThisDate && attempts.filter(a => a.date === dateStr).length === 0) {
      attempts.push({
        date: dateStr,
        timeSlot: 'all',
        success: false,
        message: 'No courts available at any time slot',
      })
    }
  }

  console.log(`[Scheduler] Booking complete: ${totalBookings}/${targetDates.length} successful`)

  // Determine overall status
  let status: string
  if (totalBookings === targetDates.length) {
    status = 'success'
  } else if (totalBookings > 0) {
    status = 'partial'
  } else if (attempts.some(a => a.message.includes('Booking window not open'))) {
    status = 'no_courts'
  } else {
    status = 'no_courts'
  }

  // Record the run history (with graceful fallback)
  try {
    await prisma.bookingRunHistory.create({
      data: {
        bookingJobId: job.id,
        startedAt,
        completedAt: new Date(),
        status,
        attempts: JSON.stringify(attempts),
        successCount: totalBookings,
        failureCount: targetDates.length - totalBookings,
      },
    })
  } catch (historyError) {
    console.error('[Scheduler] Failed to record run history:', historyError)
    // Don't fail the entire job if history recording fails
  }

  // Update job's lastRun and nextRun
  // Set nextRun to the last target date + 1 week for weekly recurring jobs
  const nextRun = job.recurrence === 'weekly'
    ? addWeeks(targetDates[targetDates.length - 1], 1)
    : null

  await prisma.bookingJob.update({
    where: { id: job.id },
    data: {
      lastRun: new Date(),
      nextRun,
    },
  })
}

/**
 * Main scheduler loop - checks for jobs that need to run
 * @param force - If true, runs all active jobs regardless of schedule
 */
export async function runScheduler(force: boolean = false): Promise<void> {
  console.log(`[Scheduler] Checking for jobs to run...${force ? ' (FORCED)' : ''}`)

  const now = new Date()

  // Fetch all active jobs
  const jobs = await prisma.bookingJob.findMany({
    where: {
      active: true,
    },
    include: {
      account: {
        select: {
          email: true,
          password: true,
        },
      },
    },
  })

  console.log(`[Scheduler] Found ${jobs.length} active job(s)`)

  for (const job of jobs) {
    try {
      // Determine if job should run
      const shouldRun = force || // Force run (manual trigger)
        !job.lastRun || // Never run before
        (job.nextRun && job.nextRun <= now) || // Scheduled to run now
        (job.recurrence === 'once' && !job.lastRun) // One-time job not yet run

      if (shouldRun) {
        await processBookingJob(job as BookingJob)
      } else {
        console.log(`[Scheduler] Job ${job.name} not scheduled to run yet (next run: ${job.nextRun})`)
      }
    } catch (error) {
      console.error(`[Scheduler] Error processing job ${job.name}:`, error)
    }
  }

  console.log('[Scheduler] Scheduler run complete')
}
