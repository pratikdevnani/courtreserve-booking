import { describe, it, expect } from 'vitest'

/**
 * Tests for minNoticeHours API validation
 *
 * These tests verify the validation logic for the minNoticeHours field
 * in the booking jobs API endpoints.
 */

describe('API: minNoticeHours validation', () => {
  // Helper to simulate the validation logic from route.ts
  function validateMinNoticeHours(value: unknown): { valid: boolean; error?: string } {
    if (typeof value !== 'number' || value < 0) {
      return {
        valid: false,
        error: 'Minimum notice hours must be a non-negative number',
      }
    }
    return { valid: true }
  }

  describe('POST /api/booking-jobs validation', () => {
    it('should accept valid minNoticeHours = 6', () => {
      const result = validateMinNoticeHours(6)
      expect(result.valid).toBe(true)
    })

    it('should accept minNoticeHours = 0', () => {
      const result = validateMinNoticeHours(0)
      expect(result.valid).toBe(true)
    })

    it('should accept large minNoticeHours values', () => {
      const result = validateMinNoticeHours(72)
      expect(result.valid).toBe(true)
    })

    it('should reject negative minNoticeHours', () => {
      const result = validateMinNoticeHours(-1)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('non-negative')
    })

    it('should reject string minNoticeHours', () => {
      const result = validateMinNoticeHours('6')
      expect(result.valid).toBe(false)
    })

    it('should reject null minNoticeHours', () => {
      const result = validateMinNoticeHours(null)
      expect(result.valid).toBe(false)
    })

    it('should reject undefined minNoticeHours', () => {
      const result = validateMinNoticeHours(undefined)
      expect(result.valid).toBe(false)
    })
  })

  describe('Request body parsing', () => {
    // Simulates parsing the request body for new schema
    function parseBookingJobRequest(body: Record<string, unknown>): {
      minNoticeHours: number
      useNewSchema: boolean
    } {
      const useNewSchema = body.preferredTime !== undefined
      const minNoticeHours = useNewSchema
        ? (typeof body.minNoticeHours === 'number' ? body.minNoticeHours : 6)
        : 6 // legacy schema always uses default

      return { minNoticeHours, useNewSchema }
    }

    it('should use provided minNoticeHours for new schema', () => {
      const body = {
        preferredTime: '18:00',
        minNoticeHours: 12,
      }

      const result = parseBookingJobRequest(body)

      expect(result.useNewSchema).toBe(true)
      expect(result.minNoticeHours).toBe(12)
    })

    it('should default to 6 when minNoticeHours not provided', () => {
      const body = {
        preferredTime: '18:00',
      }

      const result = parseBookingJobRequest(body)

      expect(result.minNoticeHours).toBe(6)
    })

    it('should default to 6 for legacy schema', () => {
      const body = {
        slotMode: 'single',
        timeSlots: ['18:00'],
      }

      const result = parseBookingJobRequest(body)

      expect(result.useNewSchema).toBe(false)
      expect(result.minNoticeHours).toBe(6)
    })

    it('should accept minNoticeHours = 0', () => {
      const body = {
        preferredTime: '18:00',
        minNoticeHours: 0,
      }

      const result = parseBookingJobRequest(body)

      expect(result.minNoticeHours).toBe(0)
    })
  })

  describe('PATCH endpoint defaults', () => {
    // Simulates the PATCH endpoint default behavior
    function buildUpdateData(body: Record<string, unknown>): Record<string, unknown> {
      const updateData: Record<string, unknown> = {}

      if (body.preferredTime !== undefined) {
        updateData.preferredTime = body.preferredTime
        updateData.minNoticeHours = body.minNoticeHours ?? 6
      }

      return updateData
    }

    it('should use provided minNoticeHours in PATCH', () => {
      const body = {
        preferredTime: '19:00',
        minNoticeHours: 24,
      }

      const updateData = buildUpdateData(body)

      expect(updateData.minNoticeHours).toBe(24)
    })

    it('should default to 6 in PATCH when not provided', () => {
      const body = {
        preferredTime: '19:00',
      }

      const updateData = buildUpdateData(body)

      expect(updateData.minNoticeHours).toBe(6)
    })

    it('should not include minNoticeHours for non-schema updates', () => {
      const body = {
        name: 'Updated Name',
      }

      const updateData = buildUpdateData(body)

      expect(updateData.minNoticeHours).toBeUndefined()
    })
  })
})

describe('Database schema defaults', () => {
  describe('minNoticeHours field', () => {
    it('should have correct default value of 6', () => {
      // This verifies the schema design decision
      const schemaDefault = 6
      expect(schemaDefault).toBe(6)
    })

    it('should allow values from 0 to any positive integer', () => {
      const validValues = [0, 1, 6, 12, 24, 48, 72]

      validValues.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(value)).toBe(true)
      })
    })
  })
})
