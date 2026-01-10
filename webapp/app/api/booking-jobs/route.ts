import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:BookingJobs');

// GET /api/booking-jobs - List all booking jobs
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const accountId = searchParams.get('accountId');
    const active = searchParams.get('active');

    log.debug('Fetching booking jobs', { accountId, active });

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
    });

    log.debug('Fetched booking jobs', { count: bookingJobs.length });
    return NextResponse.json(bookingJobs);
  } catch (error) {
    log.error('Error fetching booking jobs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch booking jobs' }, { status: 500 });
  }
}

// POST /api/booking-jobs - Create new booking job
// Supports both old schema (timeSlots, durations, slotMode) and new schema (preferredTime, etc.)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    log.debug('Creating booking job', { body: { ...body, password: '***' } });

    const {
      name,
      accountId,
      venue,
      recurrence,
      days,
      active = true,
      // New schema fields
      preferredTime,
      timeFlexibility = 30,
      preferredDuration = 120,
      minDuration = 60,
      strictDuration = false,
      maxBookingsPerDay = 1,
      priority = 0,
      minNoticeHours = 6,
      // Legacy schema fields (optional for backward compatibility)
      slotMode,
      timeSlots,
      durations,
    } = body;

    // Validate required fields
    if (!name || !accountId || !venue || !recurrence || !days) {
      log.warn('Missing required fields', { name, accountId, venue, recurrence, days });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate venue
    if (!['sunnyvale', 'santa_clara'].includes(venue)) {
      return NextResponse.json(
        { error: 'Venue must be either "sunnyvale" or "santa_clara"' },
        { status: 400 }
      );
    }

    // Validate recurrence
    if (!['once', 'weekly'].includes(recurrence)) {
      return NextResponse.json(
        { error: 'Recurrence must be either "once" or "weekly"' },
        { status: 400 }
      );
    }

    // Validate days is an array
    if (!Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ error: 'Days must be a non-empty array' }, { status: 400 });
    }

    // Check if using new schema or legacy schema
    const useNewSchema = preferredTime !== undefined;

    if (useNewSchema) {
      // Validate new schema fields
      if (!preferredTime || !/^\d{2}:\d{2}$/.test(preferredTime)) {
        return NextResponse.json({ error: 'Invalid preferred time format (use HH:MM)' }, { status: 400 });
      }
      if (![0, 30, 60, 90].includes(timeFlexibility)) {
        return NextResponse.json(
          { error: 'Time flexibility must be 0, 30, 60, or 90' },
          { status: 400 }
        );
      }
      if (minDuration > preferredDuration) {
        return NextResponse.json(
          { error: 'Minimum duration cannot exceed preferred duration' },
          { status: 400 }
        );
      }
      if (typeof minNoticeHours !== 'number' || minNoticeHours < 0) {
        return NextResponse.json(
          { error: 'Minimum notice hours must be a non-negative number' },
          { status: 400 }
        );
      }
    } else {
      // Validate legacy schema fields
      if (!slotMode || !['single', 'multi'].includes(slotMode)) {
        return NextResponse.json(
          { error: 'Slot mode must be either "single" or "multi" (legacy mode)' },
          { status: 400 }
        );
      }
      if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
        return NextResponse.json(
          { error: 'Time slots must be a non-empty array (legacy mode)' },
          { status: 400 }
        );
      }
    }

    // Validate account exists
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Build data object based on schema type
    const data: Record<string, unknown> = {
      name,
      accountId,
      venue,
      recurrence,
      days: JSON.stringify(days),
      active,
    };

    if (useNewSchema) {
      // New schema
      data.preferredTime = preferredTime;
      data.timeFlexibility = timeFlexibility;
      data.preferredDuration = preferredDuration;
      data.minDuration = minDuration;
      data.strictDuration = strictDuration;
      data.maxBookingsPerDay = maxBookingsPerDay;
      data.priority = priority;
      data.minNoticeHours = minNoticeHours;
      // Clear legacy fields
      data.slotMode = null;
      data.timeSlots = null;
      data.durations = null;
    } else {
      // Legacy schema
      data.slotMode = slotMode;
      data.timeSlots = JSON.stringify(timeSlots);
      data.durations = JSON.stringify(durations || [120, 90, 60, 30]);
    }

    const bookingJob = await prisma.bookingJob.create({
      data: data as Parameters<typeof prisma.bookingJob.create>[0]['data'],
      include: {
        account: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    log.info('Created booking job', { id: bookingJob.id, name: bookingJob.name });
    return NextResponse.json(bookingJob, { status: 201 });
  } catch (error) {
    log.error('Error creating booking job', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to create booking job' }, { status: 500 });
  }
}
