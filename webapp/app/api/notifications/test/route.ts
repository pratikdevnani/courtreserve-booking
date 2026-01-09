import { NextResponse } from 'next/server';
import { testNotification, getNotificationConfig } from '@/lib/notifications';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:Notifications:Test');

export async function POST() {
  try {
    const config = getNotificationConfig();

    if (!config.configured) {
      return NextResponse.json({
        success: false,
        message: 'Notifications are not configured',
        config: {
          enabled: config.enabled,
          server: config.server,
          topic: config.topic,
          configured: config.configured,
        },
      });
    }

    const result = await testNotification();

    return NextResponse.json({
      success: result,
      message: result
        ? 'Test notification sent successfully'
        : 'Test notification failed',
      config: {
        enabled: config.enabled,
        server: config.server,
        topic: config.topic,
        configured: config.configured,
      },
    });
  } catch (error) {
    log.error('Error sending test notification', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        success: false,
        message: 'Error sending test notification',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const config = getNotificationConfig();

  return NextResponse.json({
    enabled: config.enabled,
    server: config.server,
    topic: config.topic,
    configured: config.configured,
  });
}
