import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/booking-jobs - List all booking jobs
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const accountId = searchParams.get('accountId')
    const active = searchParams.get('active')

    const bookingJobs = await prisma.bookingJob.findMany({
      where: {
        ...(accountId && { accountId }),
        ...(active !== null && { active: active === 'true' }),
      },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            reservations: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(bookingJobs)
  } catch (error) {
    console.error('Error fetching booking jobs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch booking jobs' },
      { status: 500 }
    )
  }
}

// POST /api/booking-jobs - Create new booking job
export async function POST(request: NextRequest) {
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
      durations = [120, 90, 60, 30],
      active = true,
    } = body

    // Validate required fields
    if (!name || !accountId || !venue || !recurrence || !slotMode || !days || !timeSlots) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate venue
    if (!['sunnyvale', 'santa_clara'].includes(venue)) {
      return NextResponse.json(
        { error: 'Venue must be either "sunnyvale" or "santa_clara"' },
        { status: 400 }
      )
    }

    // Validate recurrence
    if (!['once', 'weekly'].includes(recurrence)) {
      return NextResponse.json(
        { error: 'Recurrence must be either "once" or "weekly"' },
        { status: 400 }
      )
    }

    // Validate slotMode
    if (!['single', 'multi'].includes(slotMode)) {
      return NextResponse.json(
        { error: 'Slot mode must be either "single" or "multi"' },
        { status: 400 }
      )
    }

    // Validate days is an array
    if (!Array.isArray(days) || days.length === 0) {
      return NextResponse.json(
        { error: 'Days must be a non-empty array' },
        { status: 400 }
      )
    }

    // Validate timeSlots is an array
    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
      return NextResponse.json(
        { error: 'Time slots must be a non-empty array' },
        { status: 400 }
      )
    }

    // Validate account exists
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
    }

    const bookingJob = await prisma.bookingJob.create({
      data: {
        name,
        accountId,
        venue,
        recurrence,
        slotMode,
        days: JSON.stringify(days),
        timeSlots: JSON.stringify(timeSlots),
        durations: JSON.stringify(durations),
        active,
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

    return NextResponse.json(bookingJob, { status: 201 })
  } catch (error) {
    console.error('Error creating booking job:', error)
    return NextResponse.json(
      { error: 'Failed to create booking job' },
      { status: 500 }
    )
  }
}
