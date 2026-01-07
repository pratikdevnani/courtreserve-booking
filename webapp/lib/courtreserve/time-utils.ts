/**
 * Time formatting utilities for CourtReserve API
 *
 * CourtReserve uses different time formats in different contexts:
 * - StartTime API param: "HH:MM:SS" (24-hour)
 * - EndTime API param: "H:MM AM/PM" (12-hour)
 * - Display times: "H:MM:SS AM/PM"
 * - Dates: "MM/DD/YYYY"
 */

/**
 * Convert 24-hour time to 12-hour format with AM/PM
 * @param time24 - Time in "HH:MM" format
 * @returns Time in "H:MM AM/PM" format
 */
export function to12Hour(time24: string): string {
  const [hoursStr, minutes] = time24.split(':');
  const hours = parseInt(hoursStr, 10);

  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

  return `${hours12}:${minutes} ${period}`;
}

/**
 * Convert 24-hour time to 12-hour format with seconds
 * @param time24 - Time in "HH:MM" format
 * @returns Time in "H:MM:SS AM/PM" format
 */
export function to12HourWithSeconds(time24: string): string {
  const [hoursStr, minutes] = time24.split(':');
  const hours = parseInt(hoursStr, 10);

  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

  return `${hours12}:${minutes}:00 ${period}`;
}

/**
 * Add ':00' seconds to time
 * @param time - Time in "HH:MM" format
 * @returns Time in "HH:MM:SS" format
 */
export function addSeconds(time: string): string {
  return `${time}:00`;
}

/**
 * Calculate end time given start time and duration
 * @param startTime - Start time in "HH:MM" format
 * @param durationMinutes - Duration in minutes
 * @returns End time in "H:MM AM/PM" format
 */
export function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hoursStr, minutesStr] = startTime.split(':');
  let totalMinutes = parseInt(hoursStr, 10) * 60 + parseInt(minutesStr, 10) + durationMinutes;

  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  const endTime24 = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  return to12Hour(endTime24);
}

/**
 * Format date as MM/DD/YYYY
 * @param date - Date object or YYYY-MM-DD string
 * @returns Date in "MM/DD/YYYY" format
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const year = d.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Format date with time as "MM/DD/YYYY HH:MM:SS AM/PM"
 * @param date - Date object or YYYY-MM-DD string
 * @param time - Time in "HH:MM" format
 * @returns Formatted string
 */
export function formatDateTime(date: Date | string, time: string): string {
  return `${formatDate(date)} ${to12HourWithSeconds(time)}`;
}

/**
 * Format date with midnight time "MM/DD/YYYY 12:00:00 AM"
 * @param date - Date object or YYYY-MM-DD string
 * @returns Formatted string
 */
export function formatDateMidnight(date: Date | string): string {
  return `${formatDate(date)} 12:00:00 AM`;
}

/**
 * Generate time slots with flexibility
 * @param preferredTime - Preferred time in "HH:MM" format
 * @param flexibilityMinutes - Minutes of flexibility (0, 30, 60, 90)
 * @returns Array of time slots in "HH:MM" format, ordered by preference
 */
export function generateTimeSlots(preferredTime: string, flexibilityMinutes: number): string[] {
  if (flexibilityMinutes === 0) {
    return [preferredTime];
  }

  const [hoursStr, minutesStr] = preferredTime.split(':');
  const baseMinutes = parseInt(hoursStr, 10) * 60 + parseInt(minutesStr, 10);

  const slots: string[] = [preferredTime]; // Preferred time first

  // Add slots in order of increasing distance: +30, -30, +60, -60, +90, -90
  for (let offset = 30; offset <= flexibilityMinutes; offset += 30) {
    // Later slot
    const laterMinutes = baseMinutes + offset;
    if (laterMinutes < 24 * 60) {
      const hours = Math.floor(laterMinutes / 60);
      const minutes = laterMinutes % 60;
      slots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
    }

    // Earlier slot
    const earlierMinutes = baseMinutes - offset;
    if (earlierMinutes >= 0) {
      const hours = Math.floor(earlierMinutes / 60);
      const minutes = earlierMinutes % 60;
      slots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
    }
  }

  return slots;
}

/**
 * Generate duration list from preferred to minimum
 * @param preferredDuration - Preferred duration in minutes
 * @param minDuration - Minimum acceptable duration in minutes
 * @param strict - If true, only return preferred duration
 * @returns Array of durations in descending order
 */
export function generateDurations(preferredDuration: number, minDuration: number, strict: boolean): number[] {
  if (strict) {
    return [preferredDuration];
  }

  const durations: number[] = [];
  for (let d = preferredDuration; d >= minDuration; d -= 30) {
    durations.push(d);
  }

  return durations;
}

/**
 * URL-encode a value for use in query parameters
 * @param value - Value to encode
 * @returns URL-encoded string
 */
export function urlEncode(value: string): string {
  return encodeURIComponent(value);
}
