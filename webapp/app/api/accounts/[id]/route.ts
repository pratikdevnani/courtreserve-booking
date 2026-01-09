import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('API:Accounts')

// GET /api/accounts/[id] - Get single account
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            reservations: true,
            bookingJobs: true,
          },
        },
      },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(account)
  } catch (error) {
    log.error('Error fetching account', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to fetch account' },
      { status: 500 }
    )
  }
}

// PATCH /api/accounts/[id] - Update account
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json()
    const { name, email, password, venue, isResident, active } = body

    // Validate venue if provided
    if (venue && !['sunnyvale', 'santa_clara'].includes(venue)) {
      return NextResponse.json(
        { error: 'Venue must be either "sunnyvale" or "santa_clara"' },
        { status: 400 }
      )
    }

    // Check if account exists
    const existing = await prisma.account.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
    }

    // If updating email, check for conflicts
    if (email && email !== existing.email) {
      const emailExists = await prisma.account.findUnique({
        where: { email },
      })

      if (emailExists) {
        return NextResponse.json(
          { error: 'Account with this email already exists' },
          { status: 409 }
        )
      }
    }

    const account = await prisma.account.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(password !== undefined && { password }),
        ...(venue !== undefined && { venue }),
        ...(isResident !== undefined && { isResident }),
        ...(active !== undefined && { active }),
      },
    })

    return NextResponse.json(account)
  } catch (error) {
    log.error('Error updating account', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to update account' },
      { status: 500 }
    )
  }
}

// DELETE /api/accounts/[id] - Delete account
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if account exists
    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            reservations: true,
            bookingJobs: true,
          },
        },
      },
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      )
    }

    // Delete account (cascade will handle related records)
    await prisma.account.delete({
      where: { id },
    })

    return NextResponse.json({
      message: 'Account deleted successfully',
      deletedReservations: account._count.reservations,
      deletedBookingJobs: account._count.bookingJobs,
    })
  } catch (error) {
    log.error('Error deleting account', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    )
  }
}
