import { describe, expect, it } from 'vitest'
import { buildPerformance } from '../src/music/perform'
import { generateTakes } from '../src/music/take'

/**
 * 「同じ進行でも毎周ちがう響き」がこのアプリの主目的なので、
 * 複数コーラスで同じボイシングが繰り返されていないことを見張る。
 * 仕様: docs/IMPLEMENTATION_PLAN.md §9
 */

const PROGRESSION = 'Dm7 G7 | Cmaj7 | A7alt | Dm7 G7'

const takeOptions = {
  density: 'thick' as const,
  randomness: 0.6,
  topLineWeight: 0.6,
  beatsPerBar: 4,
  withBass: true,
}

const performOptions = {
  tempo: 180,
  beatsPerBar: 4,
  withBass: true,
  strict: true,
  swing: 'auto' as const,
  density: 'thick' as const,
  choruses: 3,
}

function pianoPitchesByChorus(events: { track: string; midi: number; startBeat: number }[], beatsPerChorus: number) {
  return [0, 1, 2].map((chorus) =>
    events
      .filter(
        (e) =>
          e.track === 'piano' &&
          e.startBeat >= chorus * beatsPerChorus &&
          e.startBeat < (chorus + 1) * beatsPerChorus,
      )
      .map((e) => e.midi)
      .join(','),
  )
}

describe('複数コーラス', () => {
  it('takeForChorus を渡すとコーラスごとにボイシングが変わる', () => {
    const [take] = generateTakes(PROGRESSION, takeOptions)
    const beatsPerChorus = take.chords.reduce((sum, c) => sum + c.beats, 0)

    const performance = buildPerformance(take, {
      ...performOptions,
      takeForChorus: () => generateTakes(PROGRESSION, takeOptions)[0],
    })

    const perChorus = pianoPitchesByChorus(performance.events, beatsPerChorus)
    expect(new Set(perChorus).size).toBeGreaterThan(1)
  })

  it('1コーラス目は画面に出ているテイクと一致する', () => {
    const [take] = generateTakes(PROGRESSION, takeOptions)
    const beatsPerChorus = take.chords.reduce((sum, c) => sum + c.beats, 0)

    const performance = buildPerformance(take, {
      ...performOptions,
      takeForChorus: () => generateTakes(PROGRESSION, takeOptions)[0],
    })

    const firstChorusPitches = new Set(
      performance.events
        .filter((e) => e.track === 'piano' && e.startBeat < beatsPerChorus)
        .map((e) => e.midi),
    )
    const takePitches = new Set(take.voicings.flatMap((v) => [...v.left, ...v.right]))
    firstChorusPitches.forEach((midi) => expect(takePitches.has(midi)).toBe(true))
  })

  it('totalBeats がコーラス数分ある', () => {
    const [take] = generateTakes(PROGRESSION, takeOptions)
    const beatsPerChorus = take.chords.reduce((sum, c) => sum + c.beats, 0)
    const performance = buildPerformance(take, performOptions)
    expect(performance.totalBeats).toBeCloseTo(beatsPerChorus * 3, 5)
  })
})
