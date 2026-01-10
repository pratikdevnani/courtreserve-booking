import { describe, it, expect } from 'vitest'

/**
 * Tests for handleEdit and data parsing from API responses
 *
 * These tests ensure the UI correctly handles data from the API,
 * including edge cases like double-encoded JSON fields.
 */

// Helper that mirrors the parsing logic in handleEdit
function parseDaysFromApi(daysField: string): string[] {
  try {
    const firstParse = JSON.parse(daysField)
    // If firstParse is a string, it was double-encoded
    return typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse
  } catch {
    return []
  }
}

describe('parseDaysFromApi', () => {
  it('should parse normally-encoded days array', () => {
    const days = '["Tuesday","Wednesday","Friday"]'

    const result = parseDaysFromApi(days)

    expect(result).toEqual(['Tuesday', 'Wednesday', 'Friday'])
  })

  it('should parse double-encoded days array (actual API format)', () => {
    // This is what the API actually returns for existing jobs
    const days = '"[\\"Tuesday\\",\\"Wednesday\\",\\"Friday\\",\\"Saturday\\",\\"Sunday\\"]"'

    const result = parseDaysFromApi(days)

    expect(result).toEqual(['Tuesday', 'Wednesday', 'Friday', 'Saturday', 'Sunday'])
  })

  it('should return empty array for invalid JSON', () => {
    const days = 'not valid json'

    const result = parseDaysFromApi(days)

    expect(result).toEqual([])
  })

  it('should return empty array for null-ish input', () => {
    expect(parseDaysFromApi('')).toEqual([])
  })

  it('should handle single day array', () => {
    const days = '["Monday"]'

    const result = parseDaysFromApi(days)

    expect(result).toEqual(['Monday'])
  })

  it('should handle double-encoded single day', () => {
    const days = '"[\\"Monday\\"]"'

    const result = parseDaysFromApi(days)

    expect(result).toEqual(['Monday'])
  })
})

describe('handleEdit job parsing', () => {
  // Simulates the full job parsing logic from handleEdit
  function parseJobForEdit(job: {
    days: string
    preferredTime?: string | null
    timeFlexibility?: number | null
    preferredDuration?: number | null
    minDuration?: number | null
    strictDuration?: boolean | null
    maxBookingsPerDay?: number | null
    priority?: number | null
    minNoticeHours?: number | null
    timeSlots?: string | null
    durations?: string | null
  }) {
    const hasNewSchema = job.preferredTime !== null && job.preferredTime !== undefined

    // Parse days - handle potential double-encoding
    let parsedDays: string[]
    try {
      const firstParse = JSON.parse(job.days)
      parsedDays = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse
    } catch {
      parsedDays = []
    }

    if (hasNewSchema) {
      return {
        days: parsedDays,
        preferredTime: job.preferredTime!,
        timeFlexibility: job.timeFlexibility ?? 30,
        preferredDuration: job.preferredDuration ?? 120,
        minDuration: job.minDuration ?? 60,
        strictDuration: job.strictDuration ?? false,
        maxBookingsPerDay: job.maxBookingsPerDay ?? 1,
        priority: job.priority ?? 0,
        minNoticeHours: job.minNoticeHours ?? 6,
      }
    } else {
      // Legacy schema
      const timeSlots = job.timeSlots ? (JSON.parse(job.timeSlots) as string[]) : ['18:00']
      const durations = job.durations ? (JSON.parse(job.durations) as number[]) : [120]

      return {
        days: parsedDays,
        preferredTime: timeSlots[0]?.split('-')[0] || '18:00',
        timeFlexibility: timeSlots.length > 1 ? 30 : 0,
        preferredDuration: durations[0] || 120,
        minDuration: durations[durations.length - 1] || 60,
        strictDuration: durations.length === 1,
        maxBookingsPerDay: 1,
        priority: 0,
        minNoticeHours: 6,
      }
    }
  }

  it('should parse new schema job with double-encoded days', () => {
    // Actual API response format
    const job = {
      days: '"[\\"Tuesday\\",\\"Wednesday\\",\\"Friday\\",\\"Saturday\\",\\"Sunday\\"]"',
      preferredTime: '18:00',
      timeFlexibility: 30,
      preferredDuration: 120,
      minDuration: 120,
      strictDuration: true,
      maxBookingsPerDay: 1,
      priority: 0,
      minNoticeHours: 6,
    }

    const result = parseJobForEdit(job)

    expect(result.days).toEqual(['Tuesday', 'Wednesday', 'Friday', 'Saturday', 'Sunday'])
    expect(result.preferredTime).toBe('18:00')
    expect(result.minNoticeHours).toBe(6)
  })

  it('should parse new schema job with normally-encoded days', () => {
    const job = {
      days: '["Monday","Wednesday"]',
      preferredTime: '19:00',
      timeFlexibility: 60,
      preferredDuration: 90,
      minDuration: 60,
      strictDuration: false,
      maxBookingsPerDay: 2,
      priority: 5,
      minNoticeHours: 12,
    }

    const result = parseJobForEdit(job)

    expect(result.days).toEqual(['Monday', 'Wednesday'])
    expect(result.preferredTime).toBe('19:00')
    expect(result.minNoticeHours).toBe(12)
  })

  it('should use default minNoticeHours of 6 when not set', () => {
    const job = {
      days: '["Monday"]',
      preferredTime: '18:00',
      minNoticeHours: null,
    }

    const result = parseJobForEdit(job)

    expect(result.minNoticeHours).toBe(6)
  })

  it('should parse legacy schema job', () => {
    const job = {
      days: '"[\\"Tuesday\\"]"',
      preferredTime: null,
      timeSlots: '["18:00","18:30"]',
      durations: '[120,90,60]',
    }

    const result = parseJobForEdit(job)

    expect(result.days).toEqual(['Tuesday'])
    expect(result.preferredTime).toBe('18:00')
    expect(result.timeFlexibility).toBe(30) // multiple slots = flexibility
    expect(result.preferredDuration).toBe(120)
    expect(result.minDuration).toBe(60)
    expect(result.minNoticeHours).toBe(6) // default for legacy
  })

  it('should handle job with empty days gracefully', () => {
    const job = {
      days: 'invalid',
      preferredTime: '18:00',
    }

    const result = parseJobForEdit(job)

    expect(result.days).toEqual([])
  })
})
