import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/booking-jobs/[id]/history - Get run history for a booking job
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check if the model exists (for graceful handling during dev)
    if (!prisma.bookingRunHistory) {
      console.warn('BookingRunHistory model not available yet. Restart the dev server.')
      return NextResponse.json([])
    }

    const history = await prisma.bookingRunHistory.findMany({
      where: {
        bookingJobId: params.id,
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: 50, // Limit to last 50 runs
    })

    return NextResponse.json(history)
  } catch (error) {
    console.error('Error fetching booking run history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch booking run history' },
      { status: 500 }
    )
  }
}
