/**
 * Scheduler types and interfaces
 */

import { BookingJob } from '@prisma/client';
import { CourtReserveClient } from '../courtreserve';

export type SchedulerMode = 'noon' | 'polling' | 'manual';

export interface JobWithAccount extends BookingJob {
  account: {
    id: string;
    email: string;
    password: string;
    venue: string;
    isResident: boolean;
  };
}

export interface PreparedJob {
  job: JobWithAccount;
  client: CourtReserveClient;
  targetDate: string; // YYYY-MM-DD
  timeSlots: string[]; // HH:MM format, ordered by preference
  durations: number[]; // minutes, longest first
  courtAvailability: Map<string, number[]>; // key: "HH:MM-duration" -> court IDs
}

export interface BookingAttempt {
  date: string;
  timeSlot: string;
  duration: number;
  courtId?: number;
  success: boolean;
  message: string;
  timestamp: Date;
  externalId?: string;  // Reservation ID from CourtReserve
  confirmationNumber?: string;  // Confirmation number from CourtReserve
}

export interface JobResult {
  jobId: string;
  status: 'success' | 'no_courts' | 'locked' | 'error' | 'window_closed';
  attempts: BookingAttempt[];
  courtId?: number;
  date?: string;
  startTime?: string;
  duration?: number;
  errorMessage?: string;
}

export interface SchedulerRunResult {
  mode: SchedulerMode;
  startedAt: Date;
  completedAt: Date;
  results: JobResult[];
  successCount: number;
  failureCount: number;
  lockedCount: number;
  totalDurationMs: number;
}

export interface SchedulerState {
  isRunning: boolean;
  currentMode: SchedulerMode | null;
  lastNoonRun: Date | null;
  lastPollingRun: Date | null;
}
