import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { CourtReserveClient } from '@/lib/courtreserve/client'
import { getUnpaidTransactions } from '@/lib/courtreserve/api'

const log = createLogger('API:Reservations')

// GET /api/reservations - List all reservations (merged from DB + server)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const accountId = searchParams.get('accountId')
    const venue = searchParams.get('venue')
    const includeServer = searchParams.get('includeServer') !== 'false'

    // Fetch local DB reservations
    const localReservations = await prisma.reservation.findMany({
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
            password: true,
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

    // If not including server data, return local only
    if (!includeServer) {
      return NextResponse.json(localReservations.map(r => ({
        ...r,
        source: 'portal' as const,
        account: {
          id: r.account.id,
          name: r.account.name,
          email: r.account.email,
          venue: r.account.venue,
        },
      })))
    }

    // Fetch server reservations for each account
    const serverReservationsMap = new Map<string, any[]>()
    const accountsToFetch = accountId
      ? await prisma.account.findMany({ where: { id: accountId, active: true } })
      : await prisma.account.findMany({ where: { active: true, ...(venue && { venue }) } })

    log.info('Fetching server data for accounts', { count: accountsToFetch.length })

    for (const account of accountsToFetch) {
      try {
        log.info('Fetching server reservations', { email: account.email })
        const client = new CourtReserveClient({
          venue: account.venue,
          email: account.email,
          password: account.password,
        })
        await client.login()
        const serverReservations = await getUnpaidTransactions(client.getApiConfig())
        serverReservationsMap.set(account.id, serverReservations)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        log.warn('Failed to fetch server reservations for account', {
          accountId: account.id,
          email: account.email,
          error: errorMsg,
        })
        // Continue with other accounts
      }
    }

    // Merge datasets
    const mergedReservations: any[] = []
    const processedServerIds = new Set<string>()

    // Add local reservations (with source: "portal")
    for (const localRes of localReservations) {
      const serverData = serverReservationsMap.get(localRes.accountId) || []
      const match = serverData.find((s: any) =>
        s.ReservationId?.toString() === localRes.externalId ||
        (s.ReservationDateDisplay === formatDateForMatch(localRes.date) &&
         s.ReservationTimeDisplay.startsWith(formatTimeForMatch(localRes.startTime)))
      )

      if (match) {
        processedServerIds.add(match.ReservationId.toString())
      }

      mergedReservations.push({
        ...localRes,
        source: 'portal' as const,
        externalId: localRes.externalId || match?.ReservationId?.toString(),
        confirmationNumber: localRes.confirmationNumber || match?.ReservationNumber,
        account: {
          id: localRes.account.id,
          name: localRes.account.name,
          email: localRes.account.email,
          venue: localRes.account.venue,
        },
      })
    }

    // Add server-only reservations (with source: "external")
    for (const [accountId, serverReservations] of serverReservationsMap.entries()) {
      const account = accountsToFetch.find(a => a.id === accountId)
      if (!account) continue

      for (const serverRes of serverReservations) {
        const externalId = serverRes.ReservationId?.toString()
        if (!externalId || processedServerIds.has(externalId)) continue

        // Parse date and time from server response
        const { date, startTime, duration } = parseServerReservation(serverRes)

        mergedReservations.push({
          id: `ext-${externalId}`,
          source: 'external' as const,
          accountId: account.id,
          venue: account.venue,
          courtId: serverRes.CourtLabel,
          date,
          startTime,
          duration,
          bookedAt: new Date().toISOString(), // Unknown
          externalId,
          confirmationNumber: serverRes.ReservationNumber,
          bookingJobId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          account: {
            id: account.id,
            name: account.name,
            email: account.email,
            venue: account.venue,
          },
          bookingJob: null,
        })
      }
    }

    // Sort by date and time
    mergedReservations.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date)
      if (dateCompare !== 0) return dateCompare
      return b.startTime.localeCompare(a.startTime)
    })

    return NextResponse.json(mergedReservations)
  } catch (error) {
    log.error('Error fetching reservations', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to fetch reservations' },
      { status: 500 }
    )
  }
}

// Helper functions
function formatDateForMatch(date: string): string {
  // Convert "2026-01-14" to "1/14/2026"
  const [year, month, day] = date.split('-')
  return `${parseInt(month)}/${parseInt(day)}/${year}`
}

function formatTimeForMatch(time: string): string {
  // Convert "13:00" to "1:00 PM"
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`
}

function parseServerReservation(serverRes: any): { date: string; startTime: string; duration: number } {
  // Parse "1/14/2026" to "2026-01-14"
  const [month, day, year] = serverRes.ReservationDateDisplay.split('/')
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`

  // Parse "1:00 PM - 2:00 PM" to startTime and duration
  const [startStr, endStr] = serverRes.ReservationTimeDisplay.split(' - ')
  const startTime = parseTime12to24(startStr)
  const endTime = parseTime12to24(endStr)

  // Calculate duration in minutes
  const [startHour, startMin] = startTime.split(':').map(Number)
  const [endHour, endMin] = endTime.split(':').map(Number)
  const duration = (endHour * 60 + endMin) - (startHour * 60 + startMin)

  return { date, startTime, duration }
}

function parseTime12to24(time12: string): string {
  const match = time12.match(/(\d+):(\d+)\s*(AM|PM)/)
  if (!match) return '00:00'

  let [_, hourStr, minStr, period] = match
  let hour = parseInt(hourStr)
  const min = minStr

  if (period === 'PM' && hour !== 12) hour += 12
  if (period === 'AM' && hour === 12) hour = 0

  return `${hour.toString().padStart(2, '0')}:${min}`
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
      confirmationNumber,
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
        confirmationNumber,
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
    log.error('Error creating reservation', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to create reservation' },
      { status: 500 }
    )
  }
}
