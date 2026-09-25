import { describe, expect, it } from 'vitest'
import { seriesStats } from './TelemetryAnalysis'

describe('telemetry analysis statistics', () => {
  it('ignores unavailable and non-finite samples', () => {
    expect(seriesStats([null, 1, undefined, Number.NaN, 3])).toMatchObject({ count: 2, first: 1, last: 3, min: 1, max: 3, mean: 2 })
  })

  it('returns unavailable statistics for an empty series', () => {
    expect(seriesStats([null, undefined])).toEqual({ count: 0, first: null, last: null, min: null, max: null, mean: null, deviation: null })
  })
})
