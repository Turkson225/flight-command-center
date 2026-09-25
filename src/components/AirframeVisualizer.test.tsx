import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSimulationSnapshot } from '../core/simulation'
import { AirframeVisualizer } from './AirframeVisualizer'

describe('airframe visualizer', () => {
  it('shows attitude and Nano command values from a healthy sample', () => {
    const snapshot = createSimulationSnapshot(6, 1_800_000_000_000)
    const html = renderToStaticMarkup(createElement(AirframeVisualizer, { snapshot, status: 'SIMULATION' }))
    expect(html).toContain('PITCH')
    expect(html).toContain('AILERON')
    expect(html).toContain('ELEVATOR')
    expect(html).toContain('RUDDER')
    expect(html).toContain('THROTTLE COMMAND')
  })

  it('does not animate a faulty IMU value as current attitude', () => {
    const snapshot = createSimulationSnapshot(6, 1_800_000_000_000)
    snapshot.sensors.imu = { ...snapshot.sensors.imu, state: 'error', calibrated: false }
    const html = renderToStaticMarkup(createElement(AirframeVisualizer, { snapshot, status: 'LIVE' }))
    expect(html).toContain('ATTITUDE UNAVAILABLE')
  })
})
