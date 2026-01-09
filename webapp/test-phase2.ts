/**
 * Test Phase 2 implementation - Verify getUnpaidTransactions fetches reservation IDs
 */

import { CourtReserveClient } from './lib/courtreserve/client';
import { getUnpaidTransactions, findReservationInTransactions } from './lib/courtreserve/api';
import { prisma } from './lib/prisma';

async function testPhase2() {
  console.log('=== Phase 2 Verification Test ===\n');

  // Get ashay account from database
  const account = await prisma.account.findFirst({
    where: { email: 'ashaychangwani@gmail.com' },
  });

  if (!account) {
    console.error('❌ Account not found');
    process.exit(1);
  }

  console.log('✓ Found account:', account.email);

  // Create client and login
  const client = new CourtReserveClient({
    venue: account.venue,
    email: account.email,
    password: account.password,
  });

  console.log('\n1. Logging in...');
  await client.login();
  console.log('✓ Logged in successfully');

  // Make a test booking for next available Wednesday 1pm
  const today = new Date();
  const daysUntilWednesday = (3 - today.getDay() + 7) % 7 || 7;
  const nextWednesday = new Date(today);
  nextWednesday.setDate(today.getDate() + daysUntilWednesday);
  const targetDate = nextWednesday.toISOString().split('T')[0];

  console.log('\n2. Checking availability for', targetDate, 'at 13:00...');
  const courts = await client.getAvailableCourts(targetDate, '13:00', 120);

  if (courts.length === 0) {
    console.log('❌ No courts available - trying different time');
    const courts2 = await client.getAvailableCourts(targetDate, '18:00', 120);
    if (courts2.length === 0) {
      console.log('❌ No courts available at all');
      process.exit(1);
    }
    console.log('✓ Found courts at 18:00:', courts2.length);

    // Book at 18:00
    console.log('\n3. Making test booking...');
    const result = await client.bookCourt({
      date: targetDate,
      startTime: '18:00',
      duration: 120,
      courtId: courts2[0].id,
    });

    if (!result.success) {
      console.log('❌ Booking failed:', result.message);
      process.exit(1);
    }
    console.log('✓ Booking successful!');

    // Test getUnpaidTransactions
    console.log('\n4. Testing getUnpaidTransactions API...');
    const details = await client.fetchReservationDetails(targetDate, '18:00');

    if (!details) {
      console.log('❌ Failed to fetch reservation details');
      process.exit(1);
    }

    console.log('✓ Successfully fetched reservation details:');
    console.log('  - External ID:', details.externalId);
    console.log('  - Confirmation Number:', details.confirmationNumber);

    console.log('\n✅ Phase 2 verification PASSED!');
    console.log('\nTo complete verification:');
    console.log('1. Check reservations page at http://localhost:3002/reservations');
    console.log('2. Try deleting this reservation to verify cancellation works');
    console.log('3. Reservation details:', {
      date: targetDate,
      time: '18:00',
      externalId: details.externalId,
      confirmationNumber: details.confirmationNumber,
    });
  } else {
    console.log('✓ Found courts at 13:00:', courts.length);

    // Book at 13:00
    console.log('\n3. Making test booking...');
    const result = await client.bookCourt({
      date: targetDate,
      startTime: '13:00',
      duration: 120,
      courtId: courts[0].id,
    });

    if (!result.success) {
      console.log('❌ Booking failed:', result.message);
      process.exit(1);
    }
    console.log('✓ Booking successful!');

    // Test getUnpaidTransactions
    console.log('\n4. Testing getUnpaidTransactions API...');
    const details = await client.fetchReservationDetails(targetDate, '13:00');

    if (!details) {
      console.log('❌ Failed to fetch reservation details');
      process.exit(1);
    }

    console.log('✓ Successfully fetched reservation details:');
    console.log('  - External ID:', details.externalId);
    console.log('  - Confirmation Number:', details.confirmationNumber);

    console.log('\n✅ Phase 2 verification PASSED!');
    console.log('\nTo complete verification:');
    console.log('1. Add this reservation to the database manually');
    console.log('2. Check reservations page at http://localhost:3002/reservations');
    console.log('3. Try deleting it to verify cancellation works');
    console.log('4. Reservation details:', {
      date: targetDate,
      time: '13:00',
      externalId: details.externalId,
      confirmationNumber: details.confirmationNumber,
    });
  }
}

testPhase2()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
