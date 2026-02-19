import { describe, it, expect } from 'vitest'
import {
  getAgeThreshold,
  getSupportedCountries,
  DEFAULT_AGE_THRESHOLD,
  JURISDICTION_AGE_THRESHOLDS,
} from '../../../src/lib/jurisdiction.js'

describe('jurisdiction', () => {
  describe('getAgeThreshold', () => {
    it('returns 13 for Belgium (BE)', () => {
      expect(getAgeThreshold('BE')).toBe(13)
    })

    it('returns 14 for Italy (IT)', () => {
      expect(getAgeThreshold('IT')).toBe(14)
    })

    it('returns 15 for France (FR)', () => {
      expect(getAgeThreshold('FR')).toBe(15)
    })

    it('returns 16 for Netherlands (NL)', () => {
      expect(getAgeThreshold('NL')).toBe(16)
    })

    it('returns 13 for US', () => {
      expect(getAgeThreshold('US')).toBe(13)
    })

    it('returns default (16) for unknown country', () => {
      expect(getAgeThreshold('ZZ')).toBe(DEFAULT_AGE_THRESHOLD)
    })

    it('returns default (16) for null', () => {
      expect(getAgeThreshold(null)).toBe(DEFAULT_AGE_THRESHOLD)
    })

    it('returns default (16) for undefined', () => {
      expect(getAgeThreshold(undefined)).toBe(DEFAULT_AGE_THRESHOLD)
    })

    it('handles lowercase country codes', () => {
      expect(getAgeThreshold('be')).toBe(13)
      expect(getAgeThreshold('nl')).toBe(16)
    })
  })

  describe('getSupportedCountries', () => {
    it('returns a sorted array of country codes', () => {
      const countries = getSupportedCountries()
      expect(countries.length).toBeGreaterThan(0)
      expect(countries).toEqual([...countries].sort())
    })

    it('includes expected countries', () => {
      const countries = getSupportedCountries()
      expect(countries).toContain('NL')
      expect(countries).toContain('US')
      expect(countries).toContain('DE')
      expect(countries).toContain('FR')
    })
  })

  describe('JURISDICTION_AGE_THRESHOLDS', () => {
    it('all thresholds are between 13 and 18', () => {
      for (const [code, threshold] of Object.entries(JURISDICTION_AGE_THRESHOLDS)) {
        expect(threshold, `${code} threshold out of range`).toBeGreaterThanOrEqual(13)
        expect(threshold, `${code} threshold out of range`).toBeLessThanOrEqual(18)
      }
    })
  })

  describe('DEFAULT_AGE_THRESHOLD', () => {
    it('is 16', () => {
      expect(DEFAULT_AGE_THRESHOLD).toBe(16)
    })
  })
})
