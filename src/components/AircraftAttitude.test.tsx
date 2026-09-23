import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AircraftAttitude } from './AircraftAttitude'

const sampleTimestamp = 1_800_000_000_000
const healthy = { state: 'online' as const, calibrated: true, lastUpdate: sampleTimestamp }

describe('aircraft attitude readout', () => {
  it('shows simulated fused orientation only with healthy calibrated sensors', () => {
    const html = renderToStaticMarkup(createElement(AircraftAttitude, {
      roll: 12.5, pitch: -3.2, heading: 284, imu: healthy, magnetometer: healthy,
      sampleTimestamp, status: 'SIMULATION', source: 'simulation',
    }))
    expect(html).toContain('+12.5°')
    expect(html).toContain('-3.2°')
    expect(html).toContain('284°')
    expect(html).toContain('SIMULATED')
  })

  it('does not present faulty sensor values as valid orientation', () => {
    const html = renderToStaticMarkup(createElement(AircraftAttitude, {
      roll: 12.5, pitch: -3.2, heading: 284,
      imu: { state: 'error', calibrated: false, lastUpdate: null },
      magnetometer: { state: 'degraded', calibrated: false, lastUpdate: null },
      sampleTimestamp, status: 'LIVE', source: 'direct',
    }))
    expect(html).toContain('ATTITUDE UNAVAILABLE')
    expect(html).toContain('MAG NEEDS CALIBRATION')
    expect(html).not.toContain('284°')
    expect(html).not.toContain('+12.5°')
  })

  it('labels held sensor values after telemetry is lost', () => {
    const html = renderToStaticMarkup(createElement(AircraftAttitude, {
      roll: 12.5, pitch: -3.2, heading: 284, imu: healthy, magnetometer: healthy,
      sampleTimestamp, status: 'LOST', source: 'simulation',
    }))
    expect(html).toContain('LAST RECEIVED')
    expect(html).toContain('MAG LAST RECEIVED')
  })

  it('does not call old sensor measurements a current attitude', () => {
    const html = renderToStaticMarkup(createElement(AircraftAttitude, {
      roll: 12.5, pitch: -3.2, heading: 284,
      imu: { ...healthy, lastUpdate: sampleTimestamp - 2_000 },
      magnetometer: { ...healthy, lastUpdate: null },
      sampleTimestamp, status: 'LIVE', source: 'cloud',
    }))
    expect(html).toContain('ATTITUDE UNAVAILABLE')
    expect(html).not.toContain('284°')
  })
})
