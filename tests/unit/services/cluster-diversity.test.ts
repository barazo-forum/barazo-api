import { describe, it, expect } from 'vitest'
import { computeClusterDiversityFactor } from '../../../src/services/cluster-diversity.js'

describe('computeClusterDiversityFactor', () => {
  it('should return 1.0 when voter is not in any flagged cluster', () => {
    const factor = computeClusterDiversityFactor(false, 0)
    expect(factor).toBe(1.0)
  })

  it('should return log2(1 + count) when in a flagged cluster', () => {
    // count=3 -> log2(4) = 2.0
    const factor = computeClusterDiversityFactor(true, 3)
    expect(factor).toBeCloseTo(2.0, 5)
  })

  it('should return log2(1) = 0 when in cluster with zero external interactions', () => {
    const factor = computeClusterDiversityFactor(true, 0)
    expect(factor).toBeCloseTo(0.0, 5)
  })

  it('should return log2(2) = 1 when in cluster with 1 external interaction', () => {
    const factor = computeClusterDiversityFactor(true, 1)
    expect(factor).toBeCloseTo(1.0, 5)
  })

  it('should return log2(8) = 3 when in cluster with 7 external interactions', () => {
    const factor = computeClusterDiversityFactor(true, 7)
    expect(factor).toBeCloseTo(3.0, 5)
  })
})
