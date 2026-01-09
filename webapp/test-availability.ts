#!/usr/bin/env tsx
/**
 * Test script to verify court availability discovery
 * Tests dates 9-10 days out where courts should be visible
 */

import { PrismaClient } from '@prisma/client';
import { CourtReserveClient } from './lib/courtreserve/client';
import { addDays, format } from 'date-fns';

const prisma = new PrismaClient();

async function testAvailability() {
  console.log('=== Court Availability Test ===\n');

  // Get the test account
  const account = await prisma.account.findFirst({
    where: { email: 'thakkerurvish15@gmail.com' },
  });

  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }

  console.log(`Testing with account: ${account.email}`);
  console.log(`Venue: ${account.venue}\n`);

  // Create client
  const client = new CourtReserveClient({
    email: account.email,
    password: account.password,
    venue: account.venue,
  });

  // Login
  console.log('Logging in...');
  await client.login();
  console.log('Login successful\n');

  // Test dates 9-10 days out
  const today = new Date();
  const testDates = [
    addDays(today, 9),  // 9 days out
    addDays(today, 10), // 10 days out
    addDays(today, 11), // 11 days out
  ];

  const testTimes = ['18:00', '17:30', '19:00'];
  const testDurations = [120, 90, 60];

  console.log('Testing availability for dates 9-11 days out...\n');

  for (const date of testDates) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayName = format(date, 'EEEE');
    console.log(`\n📅 ${dateStr} (${dayName})`);
    console.log('─'.repeat(50));

    for (const time of testTimes) {
      for (const duration of testDurations) {
        try {
          const courts = await client.getAvailableCourts(date, time, duration);

          if (courts.length > 0) {
            console.log(`✅ ${time} for ${duration}min: ${courts.length} courts available`);
            // Show first few court IDs
            const courtIds = courts.slice(0, 3).map(c => c.id).join(', ');
            console.log(`   Court IDs: ${courtIds}${courts.length > 3 ? '...' : ''}`);
          } else {
            console.log(`❌ ${time} for ${duration}min: No courts`);
          }
        } catch (error) {
          console.log(`⚠️  ${time} for ${duration}min: Error - ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  console.log('\n\n=== Test Complete ===');
  await prisma.$disconnect();
}

testAvailability().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
