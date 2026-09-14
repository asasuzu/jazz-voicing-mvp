import { describe, expect, it } from 'vitest'
import { swingRatio, applySwing, humanize } from '../src/music/humanize'
import type { PerformanceEvent } from '../src/music/types'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §8 */

const event = (startBeat: number, midi = 60): PerformanceEvent => ({
  track: 'piano',
  midi,
  startBeat,
  durationBeats: 0.5,
  velocity: 72,
})

describe('スウィング比率', () => {
  it('遅いテンポでは 0.62', () => {
    expect(swingRatio(120, 'auto')).toBeCloseTo(0.62, 2)
  })

  it('速いテンポではイーブンに寄る', () => {
    expect(swingRatio(260, 'auto')).toBeCloseTo(0.5, 2)
  })

  it('その間は線形に補間される', () => {
    const mid = swingRatio(210, 'auto')
    expect(mid).toBeGreaterThan(0.5)
    expect(mid).toBeLessThan(0.62)
  })

  it('スウィング0を指定したらイーブン', () => {
    expect(swingRatio(120, 0)).toBeCloseTo(0.5, 5)
  })
})

describe('スウィングの適用', () => {
  it('8分裏が後ろへ移動する', () => {
    expect(applySwing(1.5, 0.62)).toBeCloseTo(1.62, 5)
  })

  it('表拍は動かない', () => {
    expect(applySwing(2, 0.62)).toBeCloseTo(2, 5)
  })
})

describe('きっちりモード', () => {
  it('揺れが一切入らない', () => {
    const input = [event(0), event(1.5)]
    const out = humanize(input, { strict: true, tempo: 120, swing: 'auto' })
    expect(out[0].startBeat).toBeCloseTo(0, 5)
    expect(out.every((e) => e.velocity === 72)).toBe(true)
  })

  it('きっちりモードでもスウィングは残る', () => {
    const out = humanize([event(1.5)], { strict: true, tempo: 120, swing: 'auto' })
    expect(out[0].startBeat).toBeGreaterThan(1.5)
  })
})

describe('通常モード', () => {
  it('startBeat が負にならない', () => {
    const out = humanize([event(0)], { strict: false, tempo: 120, swing: 'auto' })
    expect(out[0].startBeat).toBeGreaterThanOrEqual(0)
  })

  it('ベロシティが 1..127 に収まる', () => {
    const many = Array.from({ length: 200 }, (_, i) => event(i * 0.5))
    const out = humanize(many, { strict: false, tempo: 120, swing: 'auto' })
    out.forEach((e) => {
      expect(e.velocity).toBeGreaterThanOrEqual(1)
      expect(e.velocity).toBeLessThanOrEqual(127)
    })
  })
})
