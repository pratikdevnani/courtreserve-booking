#!/usr/bin/env tsx
/**
 * Standalone scheduler process
 *
 * Runs the booking job scheduler with two modes:
 * - Noon mode (12:00 PM Pacific): High-performance parallel booking
 * - Polling mode (every 15 minutes): Cancellation pickup
 *
 * Log levels (set via LOG_LEVEL environment variable):
 * - TRACE: Most verbose, all internal operations
 * - DEBUG: Debugging info, API calls, state changes
 * - INFO:  Normal operation (default)
 * - WARN:  Warnings only
 * - ERROR: Errors only
 * - SILENT: No logging
 *
 * Example: LOG_LEVEL=TRACE npx tsx scripts/start-scheduler.ts
 */

import { schedulerService } from '../lib/scheduler/scheduler';
import { createLogger, LogLevel, Logger } from '../lib/logger';

const log = createLogger('Scheduler:Startup');

// Display current log level
const currentLevel = Logger.getLevel();
const levelName = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'][currentLevel];
console.log(`\n=== Court Booking Scheduler ===`);
console.log(`Log level: ${levelName} (set LOG_LEVEL env var to change)`);
console.log(`=====================================\n`);

log.info('Scheduler process starting');
log.info('Schedule configuration', {
  noonPreparation: '11:59:50 AM Pacific',
  noonExecution: '12:00:00 PM Pacific',
  pollingMode: 'Every 15 minutes',
});

// Start the scheduler service
schedulerService.start();

// Log initial state
const state = schedulerService.getState();
log.info('Initial scheduler state', {
  isRunning: state.isRunning,
  currentMode: state.currentMode,
  lastNoonRun: state.lastNoonRun?.toISOString() || 'Never',
  lastPollingRun: state.lastPollingRun?.toISOString() || 'Never',
  activeLocks: state.activeLocks,
  uptime: state.uptime,
});

// Keep process alive
process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down...');
  schedulerService.stop();
  log.info('Scheduler stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down...');
  schedulerService.stop();
  log.info('Scheduler stopped');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  schedulerService.stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

log.info('Scheduler is running - press Ctrl+C to stop');
