/**
 * Migrate existing booking jobs from old schema to new schema
 *
 * Old format:
 * - timeSlots: JSON array ["18:00", "18:30", "19:00"]
 * - durations: JSON array [120, 90, 60, 30]
 * - slotMode: "single" | "multi"
 *
 * New format:
 * - preferredTime: "18:00"
 * - timeFlexibility: 30 (based on number of time slots)
 * - preferredDuration: 120
 * - minDuration: 60
 * - strictDuration: false (based on number of durations)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateBookingJobs() {
  console.log('Starting booking job migration...');

  const jobs = await prisma.bookingJob.findMany();
  console.log(`Found ${jobs.length} booking jobs to migrate`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    // Skip if already migrated (has preferredTime)
    if (job.preferredTime) {
      console.log(`Job ${job.id} (${job.name}) already migrated, skipping`);
      skippedCount++;
      continue;
    }

    try {
      // Parse old fields
      const timeSlots = job.timeSlots ? JSON.parse(job.timeSlots) : ['18:00'];
      const durations = job.durations ? JSON.parse(job.durations) : [120, 90, 60, 30];

      // Calculate new fields
      const preferredTime = timeSlots[0] || '18:00';

      // Time flexibility based on number of slots
      // 1 slot = 0 (exact), 2-3 slots = 30min, 4-5 slots = 60min, 6+ slots = 90min
      let timeFlexibility = 0;
      if (timeSlots.length >= 6) timeFlexibility = 90;
      else if (timeSlots.length >= 4) timeFlexibility = 60;
      else if (timeSlots.length >= 2) timeFlexibility = 30;

      const preferredDuration = durations[0] || 120;
      const minDuration = durations[durations.length - 1] || 60;
      const strictDuration = durations.length === 1;

      // Update job
      await prisma.bookingJob.update({
        where: { id: job.id },
        data: {
          preferredTime,
          timeFlexibility,
          preferredDuration,
          minDuration,
          strictDuration,
        },
      });

      console.log(`Migrated job ${job.id} (${job.name}):`);
      console.log(
        `  ${timeSlots.join(', ')} -> ${preferredTime} ±${timeFlexibility}min`
      );
      console.log(
        `  ${durations.join(', ')}min -> ${preferredDuration}-${minDuration}min (strict: ${strictDuration})`
      );

      migratedCount++;
    } catch (error) {
      console.error(`Failed to migrate job ${job.id} (${job.name}):`, error);
    }
  }

  console.log(`\nMigration complete:`);
  console.log(`  Migrated: ${migratedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log(`  Total: ${jobs.length}`);
}

migrateBookingJobs()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
