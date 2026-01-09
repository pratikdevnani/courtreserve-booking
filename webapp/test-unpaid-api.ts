/**
 * Simple test to verify getUnpaidTransactions API works
 */

import { CourtReserveClient } from './lib/courtreserve/client';
import { prisma } from './lib/prisma';

async function testUnpaidAPI() {
  console.log('=== Testing GetUnPaidTransactions API ===\n');

  // Get account from database
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

  // Test getUnpaidTransactions directly
  console.log('\n2. Calling getUnpaidTransactions API...');
  const details = await (client as any).getApiConfig();
  const { getUnpaidTransactions } = await import('./lib/courtreserve/api');

  const transactions = await getUnpaidTransactions(details);

  console.log('\n✓ API call successful!');
  console.log('Found', transactions.length, 'unpaid transactions:');

  if (transactions.length > 0) {
    console.log('\nSample transaction:');
    console.log(JSON.stringify(transactions[0], null, 2));

    console.log('\n✅ getUnpaidTransactions API is working correctly!');
    console.log('\nYou can now test the full flow by:');
    console.log('1. Creating a booking job that will run soon');
    console.log('2. Waiting for it to make a booking');
    console.log('3. Verifying externalId and confirmationNumber are stored');
    console.log('4. Deleting the reservation to test cancellation');
  } else {
    console.log('\n⚠️  No unpaid transactions found');
    console.log('This is normal if you haven\'t made any recent bookings.');
    console.log('The API is working, but you\'ll need to make a booking to test fully.');
  }
}

testUnpaidAPI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
