import { NextResponse } from 'next/server';
import { schedulerService } from '@/lib/scheduler/scheduler';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:SchedulerRun');

// POST /api/scheduler/run - Manually trigger the scheduler
// Query params:
// - mode: 'noon' | 'polling' | 'both' (default: 'both')
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = (url.searchParams.get('mode') as 'noon' | 'polling' | 'both') || 'both';

    log.info('Manual scheduler run triggered', { mode });

    // Run the scheduler manually
    const results = await schedulerService.runManual(mode);

    // Calculate totals
    const totalJobs = results.reduce((sum, r) => sum + r.results.length, 0);
    const totalSuccess = results.reduce((sum, r) => sum + r.successCount, 0);
    const totalFailure = results.reduce((sum, r) => sum + r.failureCount, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.totalDurationMs, 0);

    log.info('Manual scheduler run completed', {
      mode,
      totalJobs,
      totalSuccess,
      totalFailure,
      totalDurationMs: totalDuration,
    });

    return NextResponse.json({
      success: true,
      message: 'Scheduler executed successfully',
      timestamp: new Date().toISOString(),
      mode,
      results: results.map((r) => ({
        mode: r.mode,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt.toISOString(),
        successCount: r.successCount,
        failureCount: r.failureCount,
        lockedCount: r.lockedCount,
        durationMs: r.totalDurationMs,
        jobs: r.results.map((job) => ({
          jobId: job.jobId,
          status: job.status,
          attemptsCount: job.attempts.length,
          courtId: job.courtId,
          date: job.date,
          startTime: job.startTime,
          duration: job.duration,
        })),
      })),
      totals: {
        jobs: totalJobs,
        success: totalSuccess,
        failure: totalFailure,
        durationMs: totalDuration,
      },
    });
  } catch (error) {
    log.error('Error running scheduler', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run scheduler',
      },
      { status: 500 }
    );
  }
}

// GET /api/scheduler/run - Get scheduler state
export async function GET() {
  try {
    const state = schedulerService.getState();

    log.debug('Scheduler state requested', state);

    return NextResponse.json({
      success: true,
      state: {
        isRunning: state.isRunning,
        currentMode: state.currentMode,
        lastNoonRun: state.lastNoonRun?.toISOString() || null,
        lastPollingRun: state.lastPollingRun?.toISOString() || null,
        activeLocks: state.activeLocks,
        uptimeSeconds: state.uptime,
      },
    });
  } catch (error) {
    log.error('Error getting scheduler state', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get scheduler state',
      },
      { status: 500 }
    );
  }
}
