import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('API:Reservations:ById')

// GET /api/reservations/[id] - Get single reservation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        account: true,
        bookingJob: true,
      },
    })

    if (!reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(reservation)
  } catch (error) {
    log.error('Error fetching reservation', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to fetch reservation' },
      { status: 500 }
    )
  }
}

// DELETE /api/reservations/[id] - Delete reservation (with optional CourtReserve cancellation)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({ cancellationReason: 'Cancelled via UI' }));
    const cancellationReason = body.cancellationReason || 'Cancelled via UI';

    // Handle external-only reservations (ID starts with "ext-")
    if (id.startsWith('ext-')) {
      const externalId = id.substring(4) // Remove "ext-" prefix
      log.info('Deleting external-only reservation', { externalId })

      // Need to fetch from server to find which account it belongs to
      const accounts = await prisma.account.findMany({ where: { active: true } })

      for (const account of accounts) {
        try {
          const { CourtReserveClient } = await import('@/lib/courtreserve/client')
          const client = new CourtReserveClient({
            venue: account.venue,
            email: account.email,
            password: account.password,
          })
          await client.login()

          const { getUnpaidTransactions } = await import('@/lib/courtreserve/api')
          const transactions = await getUnpaidTransactions(client.getApiConfig())
          const match = transactions.find((t: any) => t.ReservationId?.toString() === externalId)

          if (match) {
            // Found the reservation - now cancel it
            log.info('Found external reservation, cancelling', {
              externalId,
              account: account.email,
            })

            const { cancelReservation } = await import('@/lib/courtreserve/api')

            // Parse date and time from server response
            const [month, day, year] = match.ReservationDateDisplay.split('/')
            const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
            const [startStr, endStr] = match.ReservationTimeDisplay.split(' - ')
            const startTime = parseTime12to24(startStr)
            const endTime = parseTime12to24(endStr)
            const [startHour, startMin] = startTime.split(':').map(Number)
            const [endHour, endMin] = endTime.split(':').map(Number)
            const duration = (endHour * 60 + endMin) - (startHour * 60 + startMin)

            const cancelResult = await cancelReservation(
              client.getApiConfig(),
              externalId,
              match.ReservationNumber || '',
              date,
              startTime,
              duration,
              cancellationReason
            )

            if (!cancelResult.isValid) {
              log.warn('External reservation cancellation failed', {
                message: cancelResult.message,
              })
              return NextResponse.json(
                { error: `Cancellation failed: ${cancelResult.message}` },
                { status: 400 }
              )
            }

            // Send notification
            const { notifyReservationCancelled, isNotificationConfigured } = await import('@/lib/notifications')
            if (isNotificationConfigured()) {
              await notifyReservationCancelled({
                venue: account.venue,
                date,
                time: startTime,
                duration,
                reason: cancellationReason,
              }).catch((err) => {
                log.warn('Failed to send cancellation notification', {
                  error: err instanceof Error ? err.message : String(err),
                })
              })
            }

            return NextResponse.json({
              message: 'External reservation deleted successfully',
              courtReserveCancelled: true,
            })
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          log.warn('Error checking account for external reservation', {
            accountId: account.id,
            error: errorMsg,
          })
          // Continue with next account
        }
      }

      // If we get here, reservation wasn't found in any account
      return NextResponse.json(
        { error: 'External reservation not found' },
        { status: 404 }
      )
    }

    // Handle local DB reservations (original logic)
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        account: true,
      },
    })

    if (!reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      )
    }

    // Track if CourtReserve cancellation was attempted/successful
    let courtReserveCancelled = false;
    let courtReserveWarning: string | null = null;

    // Try to cancel on CourtReserve if we have external ID
    if (reservation.externalId) {
      log.info('Canceling reservation on CourtReserve', {
        reservationId: reservation.externalId,
        confirmationNumber: reservation.confirmationNumber || '(not set)',
      });

      try {
        // Import the cancellation function
        const { CourtReserveClient } = await import('@/lib/courtreserve/client');

        // Create client
        const client = new CourtReserveClient({
          venue: reservation.venue,
          email: reservation.account.email,
          password: reservation.account.password,
        });

        // Login
        await client.login();

        // Cancel reservation using the API directly
        const { cancelReservation } = await import('@/lib/courtreserve/api');
        const cancelResult = await cancelReservation(
          { venue: client.getVenueInfo(), cookieManager: (client as any).cookieManager },
          reservation.externalId,
          reservation.confirmationNumber || '', // Optional - works without it
          reservation.date,
          reservation.startTime,
          reservation.duration,
          cancellationReason
        );

        if (!cancelResult.isValid) {
          log.warn('CourtReserve cancellation failed, will still delete locally', {
            message: cancelResult.message,
          });
          courtReserveWarning = `CourtReserve cancellation failed: ${cancelResult.message}`;
        } else {
          log.info('Reservation cancelled successfully on CourtReserve');
          courtReserveCancelled = true;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error('Error canceling on CourtReserve, will still delete locally', {
          error: errorMsg,
        });
        courtReserveWarning = `CourtReserve cancellation error: ${errorMsg}`;
      }
    } else {
      log.info('No external ID, skipping CourtReserve cancellation');
      courtReserveWarning = 'Reservation not cancelled on CourtReserve (no external ID stored)';
    }

    // Delete from local database
    await prisma.reservation.delete({
      where: { id },
    })

    // Send cancellation notification
    const { notifyReservationCancelled, isNotificationConfigured } = await import('@/lib/notifications');
    if (isNotificationConfigured()) {
      await notifyReservationCancelled({
        venue: reservation.venue,
        date: reservation.date,
        time: reservation.startTime,
        duration: reservation.duration,
        reason: cancellationReason,
      }).catch((err) => {
        log.warn('Failed to send cancellation notification', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return NextResponse.json({
      message: 'Reservation deleted successfully',
      courtReserveCancelled,
      ...(courtReserveWarning && { warning: courtReserveWarning }),
    })
  } catch (error) {
    log.error('Error deleting reservation', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to delete reservation' },
      { status: 500 }
    )
  }
}

// Helper function
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
