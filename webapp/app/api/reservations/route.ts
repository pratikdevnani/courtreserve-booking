import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/reservations - List all reservations
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const accountId = searchParams.get('accountId')
    const venue = searchParams.get('venue')

    const reservations = await prisma.reservation.findMany({
      where: {
        ...(accountId && { accountId }),
        ...(venue && { venue }),
      },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            email: true,
            venue: true,
          },
        },
        bookingJob: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { date: 'desc' },
        { startTime: 'desc' },
      ],
    })

    return NextResponse.json(reservations)
  } catch (error) {
    console.error('Error fetching reservations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reservations' },
      { status: 500 }
    )
  }
}

// POST /api/reservations - Create new reservation (manual entry)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      accountId,
      venue,
      courtId,
      date,
      startTime,
      duration,
      externalId,
      bookingJobId,
    } = body

    // Validate required fields
    if (!accountId || !venue || !date || !startTime || !duration) {
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

    const reservation = await prisma.reservation.create({
      data: {
        accountId,
        venue,
        courtId,
        date,
        startTime,
        duration: parseInt(duration),
        externalId,
        bookingJobId,
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

    return NextResponse.json(reservation, { status: 201 })
  } catch (error) {
    console.error('Error creating reservation:', error)
    return NextResponse.json(
      { error: 'Failed to create reservation' },
      { status: 500 }
    )
  }
}
