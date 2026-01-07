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
// Supports both new schema (preferredTime, etc.) and legacy schema (timeSlots, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()

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
    if (body.venue && !['sunnyvale', 'santa_clara'].includes(body.venue)) {
      return NextResponse.json(
        { error: 'Venue must be either "sunnyvale" or "santa_clara"' },
        { status: 400 }
      )
    }

    // Validate recurrence if provided
    if (body.recurrence && !['once', 'weekly'].includes(body.recurrence)) {
      return NextResponse.json(
        { error: 'Recurrence must be either "once" or "weekly"' },
        { status: 400 }
      )
    }

    // Build update data - support both schemas
    const updateData: Record<string, unknown> = {}

    // Common fields
    if (body.name !== undefined) updateData.name = body.name
    if (body.accountId !== undefined) updateData.accountId = body.accountId
    if (body.venue !== undefined) updateData.venue = body.venue
    if (body.recurrence !== undefined) updateData.recurrence = body.recurrence
    if (body.days !== undefined) updateData.days = JSON.stringify(body.days)
    if (body.active !== undefined) updateData.active = body.active

    // Check if using new schema (preferredTime is the indicator)
    if (body.preferredTime !== undefined) {
      // New schema fields
      updateData.preferredTime = body.preferredTime
      updateData.timeFlexibility = body.timeFlexibility ?? 30
      updateData.preferredDuration = body.preferredDuration ?? 120
      updateData.minDuration = body.minDuration ?? 60
      updateData.strictDuration = body.strictDuration ?? false
      updateData.maxBookingsPerDay = body.maxBookingsPerDay ?? 1
      updateData.priority = body.priority ?? 0
      // Clear legacy fields when using new schema
      updateData.slotMode = null
      updateData.timeSlots = null
      updateData.durations = null
    } else {
      // Legacy schema fields (backward compat)
      if (body.slotMode !== undefined) {
        if (!['single', 'multi'].includes(body.slotMode)) {
          return NextResponse.json(
            { error: 'Slot mode must be either "single" or "multi"' },
            { status: 400 }
          )
        }
        updateData.slotMode = body.slotMode
      }
      if (body.timeSlots !== undefined) updateData.timeSlots = JSON.stringify(body.timeSlots)
      if (body.durations !== undefined) updateData.durations = JSON.stringify(body.durations)
    }

    const bookingJob = await prisma.bookingJob.update({
      where: { id: params.id },
      data: updateData,
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
