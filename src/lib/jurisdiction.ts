// ---------------------------------------------------------------------------
// Jurisdiction-based age threshold mapping
// ---------------------------------------------------------------------------
// Maps ISO 3166-1 alpha-2 country codes to their minimum age for accessing
// mature/adult content. Based on GDPR Art. 8 member state implementations
// and other digital consent regulations.
// ---------------------------------------------------------------------------

/**
 * Minimum age thresholds by country.
 *
 * GDPR Art. 8 allows member states to set between 13-16.
 * Default (unlisted countries): 16 (GDPR strictest default).
 */
export const JURISDICTION_AGE_THRESHOLDS: Readonly<Record<string, number>> = {
  // 13: Belgium, Denmark, Estonia, Finland, Latvia, Portugal, Sweden
  BE: 13,
  DK: 13,
  EE: 13,
  FI: 13,
  LV: 13,
  PT: 13,
  SE: 13,

  // 14: Austria, Bulgaria, Cyprus, Italy, Lithuania, Spain
  AT: 14,
  BG: 14,
  CY: 14,
  IT: 14,
  LT: 14,
  ES: 14,

  // 15: Czechia, France, Greece, Slovenia
  CZ: 15,
  FR: 15,
  GR: 15,
  SI: 15,

  // 16: Croatia, Germany, Hungary, Ireland, Luxembourg, Malta, Netherlands,
  //     Poland, Romania, Slovakia, UK (post-Brexit equivalent)
  HR: 16,
  DE: 16,
  HU: 16,
  IE: 16,
  LU: 16,
  MT: 16,
  NL: 16,
  PL: 16,
  RO: 16,
  SK: 16,
  GB: 16,

  // 13: COPPA (US), PIPEDA (Canada), similar regimes
  US: 13,
  CA: 13,
  AU: 13,
  NZ: 13,
  JP: 13,
  KR: 14,
} as const

/** Default age threshold when country is not listed or not set. */
export const DEFAULT_AGE_THRESHOLD = 16

/**
 * Get the age threshold for a given country code.
 * Returns the country-specific threshold if known, otherwise the default (16).
 */
export function getAgeThreshold(countryCode: string | null | undefined): number {
  if (!countryCode) return DEFAULT_AGE_THRESHOLD
  return JURISDICTION_AGE_THRESHOLDS[countryCode.toUpperCase()] ?? DEFAULT_AGE_THRESHOLD
}

/**
 * Get a sorted list of all supported country codes.
 */
export function getSupportedCountries(): string[] {
  return Object.keys(JURISDICTION_AGE_THRESHOLDS).sort()
}
