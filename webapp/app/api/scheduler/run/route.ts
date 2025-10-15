import { NextResponse } from 'next/server'
import { runScheduler } from '@/lib/scheduler'

// POST /api/scheduler/run - Manually trigger the scheduler
export async function POST() {
  try {
    console.log('[API] Manual scheduler run triggered (FORCED)')

    // Run the scheduler with force=true to bypass schedule checks
    await runScheduler(true)

    return NextResponse.json({
      success: true,
      message: 'Scheduler executed successfully',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[API] Error running scheduler:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run scheduler',
      },
      { status: 500 }
    )
  }
}
