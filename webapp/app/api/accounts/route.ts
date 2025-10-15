import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/accounts - List all accounts
export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(accounts)
  } catch (error) {
    console.error('Error fetching accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    )
  }
}

// POST /api/accounts - Create new account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, password, venue, active = true } = body

    // Validate required fields
    if (!name || !email || !password || !venue) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, password, venue' },
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

    // Check if email already exists
    const existing = await prisma.account.findUnique({
      where: { email },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Account with this email already exists' },
        { status: 409 }
      )
    }

    const account = await prisma.account.create({
      data: {
        name,
        email,
        password,
        venue,
        active,
      },
    })

    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    console.error('Error creating account:', error)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
