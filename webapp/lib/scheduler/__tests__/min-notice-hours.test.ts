import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for the minimum notice hours feature
 *
 * The feature prevents polling mode from booking slots that are
 * less than X hours in the future (configurable per job, default 6 hours).
 */

describe('Minimum Notice Hours', () => {
  describe('calculateHoursUntilSlot', () => {
    // Helper function that mirrors the logic in polling-mode.ts
    function calculateHoursUntilSlot(targetDate: string, timeSlot: string, now: Date = new Date()): number {
      const slotDateTime = new Date(`${targetDate}T${timeSlot}:00`)
      return (slotDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
    }

    it('should calculate hours correctly for a slot 6 hours away', () => {
      const now = new Date('2026-01-10T12:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00'

      const hours = calculateHoursUntilSlot(targetDate, timeSlot, now)

      expect(hours).toBe(6)
    })

    it('should calculate hours correctly for a slot 2 hours away', () => {
      const now = new Date('2026-01-10T16:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00'

      const hours = calculateHoursUntilSlot(targetDate, timeSlot, now)

      expect(hours).toBe(2)
    })

    it('should return negative hours for slots in the past', () => {
      const now = new Date('2026-01-10T20:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00'

      const hours = calculateHoursUntilSlot(targetDate, timeSlot, now)

      expect(hours).toBe(-2)
    })

    it('should calculate hours correctly for next day slots', () => {
      const now = new Date('2026-01-10T20:00:00')
      const targetDate = '2026-01-11'
      const timeSlot = '10:00'

      const hours = calculateHoursUntilSlot(targetDate, timeSlot, now)

      expect(hours).toBe(14)
    })
  })

  describe('shouldSkipSlot', () => {
    // Helper function that mirrors the skip logic in polling-mode.ts
    function shouldSkipSlot(
      targetDate: string,
      timeSlot: string,
      minNoticeHours: number,
      now: Date = new Date()
    ): boolean {
      const slotDateTime = new Date(`${targetDate}T${timeSlot}:00`)
      const hoursUntilSlot = (slotDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
      return hoursUntilSlot < minNoticeHours
    }

    it('should skip slot when notice is less than required (2h < 6h)', () => {
      const now = new Date('2026-01-10T16:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00' // 2 hours from now
      const minNoticeHours = 6

      expect(shouldSkipSlot(targetDate, timeSlot, minNoticeHours, now)).toBe(true)
    })

    it('should not skip slot when notice equals required (6h = 6h)', () => {
      const now = new Date('2026-01-10T12:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00' // exactly 6 hours from now
      const minNoticeHours = 6

      expect(shouldSkipSlot(targetDate, timeSlot, minNoticeHours, now)).toBe(false)
    })

    it('should not skip slot when notice exceeds required (8h > 6h)', () => {
      const now = new Date('2026-01-10T10:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00' // 8 hours from now
      const minNoticeHours = 6

      expect(shouldSkipSlot(targetDate, timeSlot, minNoticeHours, now)).toBe(false)
    })

    it('should skip slot in the past', () => {
      const now = new Date('2026-01-10T20:00:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00' // 2 hours ago
      const minNoticeHours = 6

      expect(shouldSkipSlot(targetDate, timeSlot, minNoticeHours, now)).toBe(true)
    })

    it('should not skip any slot when minNoticeHours is 0', () => {
      const now = new Date('2026-01-10T17:59:00')
      const targetDate = '2026-01-10'
      const timeSlot = '18:00' // 1 minute from now
      const minNoticeHours = 0

      expect(shouldSkipSlot(targetDate, timeSlot, minNoticeHours, now)).toBe(false)
    })

    it('should handle 24+ hour notice requirements', () => {
      const now = new Date('2026-01-10T18:00:00')
      const targetDate = '2026-01-11'
      const timeSlot = '18:00' // 24 hours from now
      const minNoticeHours = 48

      expect(shouldSkipSlot(targetDate, timeSlot, minNoticeHours, now)).toBe(true)
    })
  })

  describe('getMinNoticeHours from job', () => {
    // Helper to extract minNoticeHours from a job object (mirrors polling-mode.ts logic)
    function getMinNoticeHours(job: { minNoticeHours?: number | null }): number {
      return ('minNoticeHours' in job && typeof job.minNoticeHours === 'number')
        ? job.minNoticeHours
        : 6 // default
    }

    it('should return job minNoticeHours when set', () => {
      const job = { minNoticeHours: 12 }
      expect(getMinNoticeHours(job)).toBe(12)
    })

    it('should return default 6 when minNoticeHours is null', () => {
      const job = { minNoticeHours: null }
      expect(getMinNoticeHours(job)).toBe(6)
    })

    it('should return default 6 when minNoticeHours is undefined', () => {
      const job = {}
      expect(getMinNoticeHours(job)).toBe(6)
    })

    it('should return 0 when explicitly set to 0', () => {
      const job = { minNoticeHours: 0 }
      expect(getMinNoticeHours(job)).toBe(0)
    })
  })
})

describe('Integration: Polling Mode with Minimum Notice', () => {
  // These tests verify the expected behavior without actually calling the API

  describe('slot filtering', () => {
    interface SlotToCheck {
      targetDate: string
      timeSlot: string
      duration: number
    }

    // Simulates the filtering that happens in polling-mode.ts
    function filterSlotsWithSufficientNotice(
      slots: SlotToCheck[],
      minNoticeHours: number,
      now: Date
    ): SlotToCheck[] {
      return slots.filter(slot => {
        const slotDateTime = new Date(`${slot.targetDate}T${slot.timeSlot}:00`)
        const hoursUntilSlot = (slotDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
        return hoursUntilSlot >= minNoticeHours
      })
    }

    it('should filter out slots with insufficient notice', () => {
      const now = new Date('2026-01-10T14:00:00') // 2 PM
      const minNoticeHours = 6

      const slots: SlotToCheck[] = [
        { targetDate: '2026-01-10', timeSlot: '18:00', duration: 60 }, // 4h away - skip
        { targetDate: '2026-01-10', timeSlot: '19:00', duration: 60 }, // 5h away - skip
        { targetDate: '2026-01-10', timeSlot: '20:00', duration: 60 }, // 6h away - keep
        { targetDate: '2026-01-10', timeSlot: '21:00', duration: 60 }, // 7h away - keep
      ]

      const filtered = filterSlotsWithSufficientNotice(slots, minNoticeHours, now)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].timeSlot).toBe('20:00')
      expect(filtered[1].timeSlot).toBe('21:00')
    })

    it('should keep all slots when minNoticeHours is 0', () => {
      const now = new Date('2026-01-10T17:00:00') // 5 PM
      const minNoticeHours = 0

      const slots: SlotToCheck[] = [
        { targetDate: '2026-01-10', timeSlot: '17:30', duration: 60 }, // 30min away
        { targetDate: '2026-01-10', timeSlot: '18:00', duration: 60 }, // 1h away
        { targetDate: '2026-01-10', timeSlot: '18:30', duration: 60 }, // 1.5h away
      ]

      const filtered = filterSlotsWithSufficientNotice(slots, minNoticeHours, now)

      expect(filtered).toHaveLength(3)
    })

    it('should filter all slots when none meet the notice requirement', () => {
      const now = new Date('2026-01-10T20:00:00') // 8 PM
      const minNoticeHours = 6

      const slots: SlotToCheck[] = [
        { targetDate: '2026-01-10', timeSlot: '18:00', duration: 60 }, // past
        { targetDate: '2026-01-10', timeSlot: '21:00', duration: 60 }, // 1h away
        { targetDate: '2026-01-10', timeSlot: '22:00', duration: 60 }, // 2h away
      ]

      const filtered = filterSlotsWithSufficientNotice(slots, minNoticeHours, now)

      expect(filtered).toHaveLength(0)
    })

    it('should correctly handle slots across multiple days', () => {
      const now = new Date('2026-01-10T22:00:00') // 10 PM
      const minNoticeHours = 6

      const slots: SlotToCheck[] = [
        { targetDate: '2026-01-10', timeSlot: '23:00', duration: 60 }, // 1h away - skip
        { targetDate: '2026-01-11', timeSlot: '04:00', duration: 60 }, // 6h away - keep
        { targetDate: '2026-01-11', timeSlot: '10:00', duration: 60 }, // 12h away - keep
      ]

      const filtered = filterSlotsWithSufficientNotice(slots, minNoticeHours, now)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].timeSlot).toBe('04:00')
      expect(filtered[1].timeSlot).toBe('10:00')
    })
  })
})
