/**
 * Notifications utility using ntfy.sh
 *
 * ntfy.sh is a simple HTTP-based pub-sub notification service.
 * Configure via environment variables:
 * - NTFY_TOPIC: The topic name (required)
 * - NTFY_SERVER: The server URL (default: https://ntfy.sh)
 * - NTFY_ENABLED: Enable/disable notifications (default: true)
 *
 * Example:
 *   NTFY_TOPIC=courtreserve-bookings
 *   NTFY_SERVER=https://ntfy.sh
 */

import { createLogger } from './logger';

const log = createLogger('Notifications');

// Configuration from environment
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const NTFY_ENABLED = process.env.NTFY_ENABLED !== 'false';
const NTFY_CLICK_BASE_URL = process.env.NTFY_CLICK_BASE_URL || 'https://pickleball.ashayc.com';

// Priority levels for ntfy
type Priority = 'min' | 'low' | 'default' | 'high' | 'max';

interface NotificationOptions {
  title?: string;
  priority?: Priority;
  tags?: string[];
  click?: string;
  attach?: string;
  icon?: string;
  markdown?: boolean;
  actions?: NotificationAction[];
}

interface NotificationAction {
  action: 'view' | 'broadcast' | 'http';
  label: string;
  url?: string;
  clear?: boolean;
}

/**
 * Send a notification via ntfy.sh
 */
export async function sendNotification(
  message: string,
  options: NotificationOptions = {}
): Promise<boolean> {
  if (!NTFY_ENABLED) {
    log.debug('Notifications disabled, skipping', { message });
    return false;
  }

  if (!NTFY_TOPIC) {
    log.warn('NTFY_TOPIC not configured, skipping notification', { message });
    return false;
  }

  const url = `${NTFY_SERVER}/${NTFY_TOPIC}`;

  log.debug('Sending notification', {
    url,
    message: message.substring(0, 100),
    title: options.title,
    priority: options.priority,
    tags: options.tags,
  });

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
    };

    if (options.title) {
      headers['Title'] = options.title;
    }

    if (options.priority) {
      headers['Priority'] = options.priority;
    }

    if (options.tags && options.tags.length > 0) {
      headers['Tags'] = options.tags.join(',');
    }

    if (options.click) {
      headers['Click'] = options.click;
    }

    if (options.attach) {
      headers['Attach'] = options.attach;
    }

    if (options.icon) {
      headers['Icon'] = options.icon;
    }

    if (options.markdown) {
      headers['Markdown'] = 'yes';
    }

    if (options.actions && options.actions.length > 0) {
      headers['Actions'] = options.actions
        .map((a) => {
          if (a.action === 'view') {
            return `view, ${a.label}, ${a.url}`;
          }
          return `${a.action}, ${a.label}`;
        })
        .join('; ');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: message,
    });

    if (!response.ok) {
      log.error('Failed to send notification', {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    log.info('Notification sent successfully', {
      topic: NTFY_TOPIC,
      title: options.title || '(none)',
    });
    return true;
  } catch (error) {
    log.error('Error sending notification', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Send a booking success notification
 */
export async function notifyBookingSuccess(params: {
  jobName: string;
  venue: string;
  date: string;
  time: string;
  duration: number;
  courtId: number;
}): Promise<boolean> {
  const message = [
    `Court booked successfully!`,
    ``,
    `**Job:** ${params.jobName}`,
    `**Venue:** ${params.venue}`,
    `**Date:** ${params.date}`,
    `**Time:** ${params.time}`,
    `**Duration:** ${params.duration} minutes`,
    `**Court:** ${params.courtId}`,
  ].join('\n');

  return sendNotification(message, {
    title: `Booking Confirmed - ${params.venue}`,
    priority: 'high',
    tags: ['white_check_mark', 'tennis'],
    markdown: true,
    click: `${NTFY_CLICK_BASE_URL}/reservations`,
    actions: [
      {
        action: 'view',
        label: 'View Reservations',
        url: `${NTFY_CLICK_BASE_URL}/reservations`,
      },
    ],
  });
}

/**
 * Send a booking failure notification
 */
export async function notifyBookingFailure(params: {
  jobName: string;
  venue: string;
  date: string;
  reason: string;
  attemptsCount: number;
}): Promise<boolean> {
  const message = [
    `Failed to book court at noon`,
    ``,
    `**Job:** ${params.jobName}`,
    `**Venue:** ${params.venue}`,
    `**Date:** ${params.date}`,
    `**Reason:** ${params.reason}`,
    `**Attempts:** ${params.attemptsCount}`,
  ].join('\n');

  return sendNotification(message, {
    title: `Booking Failed - ${params.venue}`,
    priority: 'high',
    tags: ['x', 'warning'],
    markdown: true,
    click: `${NTFY_CLICK_BASE_URL}/booking-jobs`,
    actions: [
      {
        action: 'view',
        label: 'View Jobs',
        url: `${NTFY_CLICK_BASE_URL}/booking-jobs`,
      },
    ],
  });
}

/**
 * Send a scheduler error notification
 */
export async function notifySchedulerError(params: {
  mode: 'noon' | 'polling' | 'manual';
  error: string;
}): Promise<boolean> {
  const message = [
    `Scheduler encountered an error`,
    ``,
    `**Mode:** ${params.mode}`,
    `**Error:** ${params.error}`,
  ].join('\n');

  return sendNotification(message, {
    title: 'Scheduler Error',
    priority: 'max',
    tags: ['rotating_light', 'skull'],
    markdown: true,
  });
}

/**
 * Send a daily summary notification
 */
export async function notifyDailySummary(params: {
  date: string;
  totalJobs: number;
  successCount: number;
  failureCount: number;
  bookings: Array<{ venue: string; time: string; duration: number }>;
}): Promise<boolean> {
  const lines = [
    `Daily Booking Summary`,
    ``,
    `Date: ${params.date}`,
    `Jobs Processed: ${params.totalJobs}`,
    `Successful: ${params.successCount}`,
    `Failed: ${params.failureCount}`,
  ];

  if (params.bookings.length > 0) {
    lines.push('', 'Bookings:');
    for (const booking of params.bookings) {
      lines.push(`  - ${booking.venue}: ${booking.time} (${booking.duration}min)`);
    }
  }

  return sendNotification(lines.join('\n'), {
    title: `Daily Summary - ${params.successCount} Bookings`,
    priority: params.failureCount > 0 ? 'default' : 'low',
    tags: params.successCount > 0 ? ['chart_with_upwards_trend'] : ['chart_with_downwards_trend'],
  });
}

/**
 * Send a reservation cancellation notification
 */
export async function notifyReservationCancelled(params: {
  venue: string;
  date: string;
  time: string;
  duration: number;
  reason: string;
}): Promise<boolean> {
  const message = [
    `Reservation cancelled`,
    ``,
    `**Venue:** ${params.venue}`,
    `**Date:** ${params.date}`,
    `**Time:** ${params.time}`,
    `**Duration:** ${params.duration} minutes`,
    `**Reason:** ${params.reason}`,
  ].join('\n');

  return sendNotification(message, {
    title: 'Reservation Cancelled',
    priority: 'default',
    tags: ['wastebasket'],
    markdown: true,
    click: `${NTFY_CLICK_BASE_URL}/reservations`,
  });
}

/**
 * Send a reservation reminder notification (day before)
 */
export async function notifyReservationReminder(params: {
  reservations: Array<{
    venue: string;
    date: string;
    time: string;
    duration: number;
    courtId?: string;
  }>;
}): Promise<boolean> {
  if (params.reservations.length === 0) {
    return false;
  }

  const lines = [
    `You have ${params.reservations.length} reservation${params.reservations.length > 1 ? 's' : ''} tomorrow:`,
    ``,
  ];

  for (const res of params.reservations) {
    lines.push(`- **${res.venue}** at ${res.time} (${res.duration}min)${res.courtId ? ` - Court ${res.courtId}` : ''}`);
  }

  return sendNotification(lines.join('\n'), {
    title: `Reminder: ${params.reservations.length} Court${params.reservations.length > 1 ? 's' : ''} Booked Tomorrow`,
    priority: 'default',
    tags: ['calendar', 'bell'],
    markdown: true,
    click: `${NTFY_CLICK_BASE_URL}/reservations`,
    actions: [
      {
        action: 'view',
        label: 'View Reservations',
        url: `${NTFY_CLICK_BASE_URL}/reservations`,
      },
    ],
  });
}

/**
 * Test the notification configuration
 */
export async function testNotification(): Promise<boolean> {
  log.info('Sending test notification');

  const result = await sendNotification('Test notification from Court Booking System', {
    title: 'Test Notification',
    priority: 'low',
    tags: ['loudspeaker', 'test'],
  });

  if (result) {
    log.info('Test notification sent successfully');
  } else {
    log.warn('Test notification failed or disabled');
  }

  return result;
}

/**
 * Check if notifications are configured
 */
export function isNotificationConfigured(): boolean {
  return NTFY_ENABLED && !!NTFY_TOPIC;
}

/**
 * Get notification configuration (for debugging)
 */
export function getNotificationConfig(): {
  enabled: boolean;
  server: string;
  topic: string;
  configured: boolean;
} {
  return {
    enabled: NTFY_ENABLED,
    server: NTFY_SERVER,
    topic: NTFY_TOPIC || '(not set)',
    configured: isNotificationConfigured(),
  };
}
