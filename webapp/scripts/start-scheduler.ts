#!/usr/bin/env tsx
/**
 * Standalone scheduler process
 *
 * Runs the booking job scheduler on a cron schedule.
 * This should be run as a separate process from the Next.js server.
 */

import cron from 'node-cron'
import { runScheduler } from '../lib/scheduler'

console.log('🚀 Court Booking Scheduler starting...')
console.log('⏰ Scheduler will run every day at noon (12:00 PM)')

// Run scheduler every day at noon
cron.schedule('0 12 * * *', async () => {
  console.log(`\n[${ new Date().toISOString()}] Running scheduler...`)
  try {
    await runScheduler()
  } catch (error) {
    console.error('Scheduler error:', error)
  }
})

// Also run on startup
console.log('Running initial scheduler check...')
runScheduler().catch(console.error)

// Keep process alive
process.on('SIGINT', () => {
  console.log('\n👋 Scheduler shutting down...')
  process.exit(0)
})

console.log('✅ Scheduler is running!')
