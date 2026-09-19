import { describe, expect, it } from 'vitest'
import { buildPerformance } from '../src/music/perform'
import { generateTakes } from '../src/music/take'
import { voicingDistance } from '../src/music/voicings'

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

describe('ループの継ぎ目', () => {
  const seamOptions = { density: 'thick' as const, randomness: 0.38, topLineWeight: 0.6, beatsPerBar: 4, withBass: true }
  const notes = (v: { left: number[]; right: number[] }) => [...v.left, ...v.right]

  it('前の周から引き継ぐと、継ぎ目の移動量が小さくなる', () => {
    // ループ再生は1周ごとに独立したテイクを引き直すので、引き継ぎが無いと
    // 継ぎ目が「無関係な2つのテイクの端どうし」になる(docs/FEEDBACK_01.md §5)。
    const withoutCarry: number[] = []
    const withCarry: number[] = []

    for (let i = 0; i < 20; i += 1) {
      const [previous] = generateTakes(PROGRESSION, seamOptions)
      const last = previous.voicings[previous.voicings.length - 1]

      const [plain] = generateTakes(PROGRESSION, seamOptions)
      withoutCarry.push(voicingDistance(notes(last), notes(plain.voicings[0])))

      const [carried] = generateTakes(PROGRESSION, { ...seamOptions, previousVoicing: last })
      withCarry.push(voicingDistance(notes(last), notes(carried.voicings[0])))
    }

    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    expect(mean(withCarry)).toBeLessThan(mean(withoutCarry))
  })

  it('複数コーラスの書き出しでも継ぎ目がつながる', () => {
    const [take] = generateTakes(PROGRESSION, seamOptions)
    const performance = buildPerformance(take, {
      ...performOptions,
      takeForChorus: (_index, previousVoicing) =>
        generateTakes(PROGRESSION, { ...seamOptions, previousVoicing })[0],
    })
    // 継ぎ目でボイシングが変わっていること(引き継ぎで固定されていないこと)も確認する
    const beatsPerChorus = take.chords.reduce((sum, c) => sum + c.beats, 0)
    const perChorus = [0, 1, 2].map((chorus) =>
      performance.events
        .filter((e) => e.track === 'piano' && e.startBeat >= chorus * beatsPerChorus && e.startBeat < (chorus + 1) * beatsPerChorus)
        .map((e) => e.midi)
        .join(','),
    )
    expect(new Set(perChorus).size).toBeGreaterThan(1)
  })
})
