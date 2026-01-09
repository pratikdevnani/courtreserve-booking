/**
 * Main Scheduler Service
 * Coordinates noon and polling modes with cron scheduling
 * With extensive logging for debugging
 */

import * as cron from 'node-cron';
import { LockManager } from './lock-manager';
import { NoonModeHandler } from './noon-mode';
import { PollingModeHandler } from './polling-mode';
import { SchedulerMode, SchedulerRunResult, JobResult } from './types';
import { notifySchedulerError, isNotificationConfigured } from '../notifications';
import { createLogger } from '../logger';

const log = createLogger('Scheduler:Main');

export class SchedulerService {
  private lockManager: LockManager;
  private noonModeHandler: NoonModeHandler;
  private pollingModeHandler: PollingModeHandler;
  private isRunning: boolean = false;
  private currentMode: SchedulerMode | null = null;
  private lastNoonRun: Date | null = null;
  private lastPollingRun: Date | null = null;
  private cronJobs: cron.ScheduledTask[] = [];
  private startTime: Date | null = null;

  constructor() {
    log.debug('Initializing SchedulerService');
    this.lockManager = new LockManager();
    this.noonModeHandler = new NoonModeHandler();
    this.pollingModeHandler = new PollingModeHandler();
    log.info('SchedulerService initialized');
  }

  /**
   * Start the scheduler with cron jobs
   */
  start(): void {
    log.info('Starting scheduler service...');
    this.startTime = new Date();

    // Noon preparation - 11:59:00 AM Pacific (60 seconds before noon)
    log.debug('Setting up noon preparation cron job', {
      schedule: '0 59 11 * * *',
      timezone: 'America/Los_Angeles',
    });
    const prepareJob = cron.schedule(
      '0 59 11 * * *',
      async () => {
        log.info('=== NOON PREPARATION TRIGGERED ===');
        try {
          await this.noonModeHandler.prepare();
          log.info('Noon preparation completed');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Noon preparation failed', { error: errorMessage });

          if (isNotificationConfigured()) {
            await notifySchedulerError({
              mode: 'noon',
              error: errorMessage,
            }).catch((err) => {
              log.warn('Failed to send scheduler error notification', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      },
      {
        timezone: 'America/Los_Angeles',
      }
    );

    // Noon execution - 12:00:00 PM Pacific
    log.debug('Setting up noon execution cron job', {
      schedule: '0 0 12 * * *',
      timezone: 'America/Los_Angeles',
    });
    const noonJob = cron.schedule(
      '0 0 12 * * *',
      async () => {
        log.info('=== NOON EXECUTION TRIGGERED ===');
        try {
          await this.runNoonMode();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Noon execution failed', { error: errorMessage });

          if (isNotificationConfigured()) {
            await notifySchedulerError({
              mode: 'noon',
              error: errorMessage,
            }).catch((err) => {
              log.warn('Failed to send scheduler error notification', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      },
      {
        timezone: 'America/Los_Angeles',
      }
    );

    // Polling mode - Every 15 minutes
    log.debug('Setting up polling cron job', {
      schedule: '*/15 * * * *',
      timezone: 'America/Los_Angeles',
    });
    const pollingJob = cron.schedule(
      '*/15 * * * *',
      async () => {
        log.debug('=== POLLING MODE TRIGGERED ===');
        try {
          await this.runPollingMode();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Polling mode failed', { error: errorMessage });

          if (isNotificationConfigured()) {
            await notifySchedulerError({
              mode: 'polling',
              error: errorMessage,
            }).catch((err) => {
              log.warn('Failed to send scheduler error notification', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      },
      {
        timezone: 'America/Los_Angeles',
      }
    );

    this.cronJobs = [prepareJob, noonJob, pollingJob];

    log.info('Scheduler started successfully', {
      cronJobs: 3,
      startTime: this.startTime.toISOString(),
    });
    log.info('Schedule:', {
      noonPreparation: '11:59:00 AM Pacific (60s before noon)',
      noonExecution: '12:00:00 PM Pacific',
      pollingMode: 'Every 15 minutes',
    });
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    log.info('Stopping scheduler service...');

    for (const job of this.cronJobs) {
      job.stop();
    }

    const uptime = this.startTime
      ? `${Math.round((Date.now() - this.startTime.getTime()) / 1000)}s`
      : 'unknown';

    this.cronJobs = [];
    log.info('Scheduler stopped', { uptime });
  }

  /**
   * Run noon mode
   */
  private async runNoonMode(): Promise<SchedulerRunResult> {
    log.info('Starting noon mode execution');

    if (this.isRunning) {
      log.warn('Scheduler already running, skipping noon mode', {
        currentMode: this.currentMode,
      });
      return this.createEmptyResult('noon');
    }

    this.isRunning = true;
    this.currentMode = 'noon';
    const startedAt = new Date();
    log.debug('Noon mode state set', { isRunning: true, startedAt: startedAt.toISOString() });

    try {
      log.info('Executing noon mode handler...');
      const results = await this.noonModeHandler.execute(this.lockManager);

      const completedAt = new Date();
      this.lastNoonRun = completedAt;

      const runResult = this.createResult('noon', startedAt, completedAt, results);

      log.info('Noon mode completed', {
        totalJobs: results.length,
        successCount: runResult.successCount,
        failureCount: runResult.failureCount,
        lockedCount: runResult.lockedCount,
        duration: `${runResult.totalDurationMs}ms`,
      });

      return runResult;
    } catch (error) {
      log.error('Noon mode failed with exception', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return this.createEmptyResult('noon');
    } finally {
      this.isRunning = false;
      this.currentMode = null;
      log.debug('Noon mode state cleared');
    }
  }

  /**
   * Run polling mode
   */
  private async runPollingMode(): Promise<SchedulerRunResult> {
    log.debug('Starting polling mode execution');

    if (this.isRunning) {
      log.debug('Scheduler already running, skipping polling mode', {
        currentMode: this.currentMode,
      });
      return this.createEmptyResult('polling');
    }

    this.isRunning = true;
    this.currentMode = 'polling';
    const startedAt = new Date();

    try {
      const results = await this.pollingModeHandler.execute(this.lockManager);

      const completedAt = new Date();
      this.lastPollingRun = completedAt;

      const runResult = this.createResult('polling', startedAt, completedAt, results);

      if (results.length > 0) {
        log.info('Polling mode completed', {
          totalJobs: results.length,
          successCount: runResult.successCount,
          failureCount: runResult.failureCount,
          duration: `${runResult.totalDurationMs}ms`,
        });
      } else {
        log.debug('Polling mode completed (no jobs to process)', {
          duration: `${runResult.totalDurationMs}ms`,
        });
      }

      return runResult;
    } catch (error) {
      log.error('Polling mode failed with exception', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createEmptyResult('polling');
    } finally {
      this.isRunning = false;
      this.currentMode = null;
    }
  }

  /**
   * Manually trigger scheduler (for API endpoint)
   */
  async runManual(mode: 'noon' | 'polling' | 'both' = 'both'): Promise<SchedulerRunResult[]> {
    log.info('Manual trigger requested', { mode });

    const results: SchedulerRunResult[] = [];

    if (mode === 'noon' || mode === 'both') {
      // For manual noon mode, we need to prepare first
      const preparedCount = this.noonModeHandler.getPreparedJobCount();
      if (preparedCount === 0) {
        log.info('Preparing jobs for manual noon mode...');
        await this.noonModeHandler.prepare();
      } else {
        log.debug('Jobs already prepared', { count: preparedCount });
      }

      log.info('Running manual noon mode...');
      const noonResult = await this.runNoonMode();
      results.push(noonResult);
    }

    if (mode === 'polling' || mode === 'both') {
      log.info('Running manual polling mode...');
      const pollingResult = await this.runPollingMode();
      results.push(pollingResult);
    }

    log.info('Manual trigger completed', {
      mode,
      resultsCount: results.length,
      totalSuccess: results.reduce((sum, r) => sum + r.successCount, 0),
    });

    return results;
  }

  /**
   * Get current scheduler state
   */
  getState() {
    const state = {
      isRunning: this.isRunning,
      currentMode: this.currentMode,
      lastNoonRun: this.lastNoonRun,
      lastPollingRun: this.lastPollingRun,
      activeLocks: this.lockManager.getActiveLockCount(),
      uptime: this.startTime
        ? Math.round((Date.now() - this.startTime.getTime()) / 1000)
        : null,
    };
    log.trace('State requested', state);
    return state;
  }

  /**
   * Create a result object
   */
  private createResult(
    mode: SchedulerMode,
    startedAt: Date,
    completedAt: Date,
    results: JobResult[]
  ): SchedulerRunResult {
    const result: SchedulerRunResult = {
      mode,
      startedAt,
      completedAt,
      results,
      successCount: results.filter((r) => r.status === 'success').length,
      failureCount: results.filter((r) => r.status === 'error' || r.status === 'no_courts').length,
      lockedCount: results.filter((r) => r.status === 'locked').length,
      totalDurationMs: completedAt.getTime() - startedAt.getTime(),
    };

    log.trace('Created run result', {
      mode,
      successCount: result.successCount,
      failureCount: result.failureCount,
      duration: result.totalDurationMs,
    });

    return result;
  }

  /**
   * Create an empty result (for skipped runs)
   */
  private createEmptyResult(mode: SchedulerMode): SchedulerRunResult {
    const now = new Date();
    return {
      mode,
      startedAt: now,
      completedAt: now,
      results: [],
      successCount: 0,
      failureCount: 0,
      lockedCount: 0,
      totalDurationMs: 0,
    };
  }
}

// Export singleton instance
export const schedulerService = new SchedulerService();
