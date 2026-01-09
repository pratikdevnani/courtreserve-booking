import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('API:BookingJobs:History')

// GET /api/booking-jobs/[id]/history - Get run history for a booking job
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if the model exists (for graceful handling during dev)
    if (!prisma.bookingRunHistory) {
      log.warn('BookingRunHistory model not available yet. Restart the dev server.')
      return NextResponse.json([])
    }

    const history = await prisma.bookingRunHistory.findMany({
      where: {
        bookingJobId: id,
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: 50, // Limit to last 50 runs
    })

    return NextResponse.json(history)
  } catch (error) {
    log.error('Error fetching booking run history', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to fetch booking run history' },
      { status: 500 }
    )
  }
}
