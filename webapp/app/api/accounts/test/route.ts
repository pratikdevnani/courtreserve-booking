import { NextRequest, NextResponse } from 'next/server'
import { CourtReserveClient } from '@/lib/courtreserve/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('API:Accounts:Test')

// POST /api/accounts/test - Test account credentials
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, venue } = body

    if (!email || !password || !venue) {
      return NextResponse.json(
        { error: 'Missing required fields: email, password, venue' },
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

    // Test the credentials using the TypeScript client
    const testResult = await testCredentials(email, password, venue)

    if (testResult.success) {
      return NextResponse.json({
        success: true,
        message: 'Login successful! Credentials are valid.',
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: testResult.error || 'Login failed. Please check your credentials.',
        },
        { status: 401 }
      )
    }
  } catch (error) {
    log.error('Error testing account', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to test account credentials' },
      { status: 500 }
    )
  }
}

async function testCredentials(
  email: string,
  password: string,
  venue: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create a CourtReserve client and attempt to login
    const client = new CourtReserveClient({
      email,
      password,
      venue,
    })

    // Attempt login - this will throw an error if credentials are invalid
    await client.login()

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: errorMessage.includes('Login failed')
        ? 'Invalid credentials. Please check your email and password.'
        : errorMessage,
    }
  }
}
