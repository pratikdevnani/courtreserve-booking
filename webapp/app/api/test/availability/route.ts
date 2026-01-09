import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CourtReserveClient } from '@/lib/courtreserve/client';
import { addDays, format } from 'date-fns';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:Test:Availability');

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// GET /api/test/availability - Test court availability discovery
export async function GET(request: NextRequest) {
  try {
    // Get the test account
    const account = await prisma.account.findFirst({
      where: { email: 'thakkerurvish15@gmail.com' },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Test account not found' },
        { status: 404 }
      );
    }

    // Create client
    const client = new CourtReserveClient({
      email: account.email,
      password: account.password,
      venue: account.venue,
    });

    // Login
    await client.login();

    // Test dates 9-11 days out
    const today = new Date();
    const results: any[] = [];

    for (let daysAhead = 9; daysAhead <= 11; daysAhead++) {
      const testDate = addDays(today, daysAhead);
      const dateStr = format(testDate, 'yyyy-MM-dd');
      const dayName = format(testDate, 'EEEE');

      const dateResults: any = {
        date: dateStr,
        dayName,
        daysAhead,
        tests: [],
      };

      // Test common time slots
      const testCases = [
        { time: '18:00', duration: 120 },
        { time: '18:00', duration: 90 },
        { time: '18:00', duration: 60 },
        { time: '17:30', duration: 120 },
        { time: '19:00', duration: 60 },
      ];

      for (const testCase of testCases) {
        try {
          const courts = await client.getAvailableCourts(
            testDate,
            testCase.time,
            testCase.duration
          );

          dateResults.tests.push({
            time: testCase.time,
            duration: testCase.duration,
            courtCount: courts.length,
            courtIds: courts.slice(0, 5).map((c) => c.id),
            success: true,
          });
        } catch (error) {
          dateResults.tests.push({
            time: testCase.time,
            duration: testCase.duration,
            courtCount: 0,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }

      results.push(dateResults);
    }

    // Calculate summary
    const totalTests = results.reduce((sum, r) => sum + r.tests.length, 0);
    const successfulTests = results.reduce(
      (sum, r) => sum + r.tests.filter((t: any) => t.success).length,
      0
    );
    const testsWithCourts = results.reduce(
      (sum, r) => sum + r.tests.filter((t: any) => t.courtCount > 0).length,
      0
    );

    return NextResponse.json({
      success: true,
      account: {
        email: account.email,
        venue: account.venue,
      },
      summary: {
        totalTests,
        successfulTests,
        testsWithCourts,
      },
      results,
    });
  } catch (error) {
    log.error('Availability test error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
