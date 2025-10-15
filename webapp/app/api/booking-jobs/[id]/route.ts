import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/booking-jobs/[id] - Get single booking job
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const bookingJob = await prisma.bookingJob.findUnique({
      where: { id: params.id },
      include: {
        account: true,
        reservations: {
          orderBy: { date: 'desc' },
        },
        _count: {
          select: {
            reservations: true,
          },
        },
      },
    })

    if (!bookingJob) {
      return NextResponse.json(
        { error: 'Booking job not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(bookingJob)
  } catch (error) {
    console.error('Error fetching booking job:', error)
    return NextResponse.json(
      { error: 'Failed to fetch booking job' },
      { status: 500 }
    )
  }
}

// PATCH /api/booking-jobs/[id] - Update booking job
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const {
      name,
      accountId,
      venue,
      recurrence,
      slotMode,
      days,
      timeSlots,
      durations,
      active,
    } = body

    // Check if booking job exists
    const existing = await prisma.bookingJob.findUnique({
      where: { id: params.id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Booking job not found' },
        { status: 404 }
      )
    }

    // Validate venue if provided
    if (venue && !['sunnyvale', 'santa_clara'].includes(venue)) {
      return NextResponse.json(
        { error: 'Venue must be either "sunnyvale" or "santa_clara"' },
        { status: 400 }
      )
    }

    // Validate recurrence if provided
    if (recurrence && !['once', 'weekly'].includes(recurrence)) {
      return NextResponse.json(
        { error: 'Recurrence must be either "once" or "weekly"' },
        { status: 400 }
      )
    }

    // Validate slotMode if provided
    if (slotMode && !['single', 'multi'].includes(slotMode)) {
      return NextResponse.json(
        { error: 'Slot mode must be either "single" or "multi"' },
        { status: 400 }
      )
    }

    const bookingJob = await prisma.bookingJob.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(accountId !== undefined && { accountId }),
        ...(venue !== undefined && { venue }),
        ...(recurrence !== undefined && { recurrence }),
        ...(slotMode !== undefined && { slotMode }),
        ...(days !== undefined && { days: JSON.stringify(days) }),
        ...(timeSlots !== undefined && { timeSlots: JSON.stringify(timeSlots) }),
        ...(durations !== undefined && { durations: JSON.stringify(durations) }),
        ...(active !== undefined && { active }),
      },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    return NextResponse.json(bookingJob)
  } catch (error) {
    console.error('Error updating booking job:', error)
    return NextResponse.json(
      { error: 'Failed to update booking job' },
      { status: 500 }
    )
  }
}

// DELETE /api/booking-jobs/[id] - Delete booking job
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check if booking job exists
    const bookingJob = await prisma.bookingJob.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: {
            reservations: true,
          },
        },
      },
    })

    if (!bookingJob) {
      return NextResponse.json(
        { error: 'Booking job not found' },
        { status: 404 }
      )
    }

    // Delete booking job (reservations will have their bookingJobId set to null)
    await prisma.bookingJob.delete({
      where: { id: params.id },
    })

    return NextResponse.json({
      message: 'Booking job deleted successfully',
      affectedReservations: bookingJob._count.reservations,
    })
  } catch (error) {
    console.error('Error deleting booking job:', error)
    return NextResponse.json(
      { error: 'Failed to delete booking job' },
      { status: 500 }
    )
  }
}
