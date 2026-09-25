import { describe, expect, it } from 'vitest'
import { buildPerformance, chordIndexAtBeat } from '../src/music/perform'
import { generateTakes } from '../src/music/take'
import { voicingDistance } from '../src/music/voicings'
import { parseProgression } from '../src/music/theory'

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

describe('再生位置からコードを割り出す', () => {
  it('1小節1コードなら拍数どおりに切り替わる', () => {
    const chords = parseProgression('Cmaj7 | A7alt | Dm7 | G7', 4)
    expect(chordIndexAtBeat(chords, 0)).toBe(0)
    expect(chordIndexAtBeat(chords, 3.99)).toBe(0)
    expect(chordIndexAtBeat(chords, 4)).toBe(1)
    expect(chordIndexAtBeat(chords, 15.9)).toBe(3)
  })

  it('1小節2コードなら2拍で切り替わる', () => {
    const chords = parseProgression('Dm7 G7 | Cmaj7', 4)
    expect(chordIndexAtBeat(chords, 0)).toBe(0)
    expect(chordIndexAtBeat(chords, 1.9)).toBe(0)
    expect(chordIndexAtBeat(chords, 2)).toBe(1)
    expect(chordIndexAtBeat(chords, 4)).toBe(2)
  })

  it('進行の外に出たらnull', () => {
    const chords = parseProgression('Cmaj7 | G7', 4)
    expect(chordIndexAtBeat(chords, 8)).toBeNull()
    expect(chordIndexAtBeat(chords, -1)).toBeNull()
  })
})

describe('アルペジオ(タラララ〜)', () => {
  const [take] = generateTakes(PROGRESSION, takeOptions)
  const chords = take.chords
  const performance = buildPerformance(take, { ...performOptions, choruses: 1, pianoStyle: 'arpeggio' })
  const piano = performance.events.filter((e) => e.track === 'piano')

  const chordStarts = chords.map((_, index) => chords.slice(0, index).reduce((sum, c) => sum + c.beats, 0))

  it('コードごとに、下から順に1音ずつ鳴らす', () => {
    chords.forEach((chord, index) => {
      const start = chordStarts[index]
      const notes = piano
        .filter((e) => e.startBeat >= start - 1e-6 && e.startBeat < start + chord.beats - 1e-6)
        .sort((a, b) => a.startBeat - b.startBeat)
      const voicing = take.voicings[index]
      expect(notes.map((e) => e.midi)).toEqual([...voicing.left, ...voicing.right].sort((a, b) => a - b))
      // 同時に鳴らす音が無い = 転がしている
      expect(new Set(notes.map((e) => e.startBeat.toFixed(4))).size).toBe(notes.length)
      expect(notes[0].startBeat).toBeCloseTo(start, 4)
    })
  })

  it('鳴らした音は次のコードまで伸ばす', () => {
    chords.forEach((chord, index) => {
      const end = chordStarts[index] + chord.beats
      piano
        .filter((e) => e.startBeat >= chordStarts[index] - 1e-6 && e.startBeat < end - 1e-6)
        .forEach((e) => expect(e.startBeat + e.durationBeats).toBeCloseTo(end, 4))
    })
  })

  it('2拍しかないコードでも、転がし終わってから次のコードが来る', () => {
    chords.forEach((chord, index) => {
      const notes = piano.filter(
        (e) => e.startBeat >= chordStarts[index] - 1e-6 && e.startBeat < chordStarts[index] + chord.beats - 1e-6,
      )
      const last = Math.max(...notes.map((e) => e.startBeat)) - chordStarts[index]
      expect(last).toBeLessThanOrEqual(chord.beats * 0.75 + 1e-6)
    })
  })

  it('ベースは今までどおり鳴る', () => {
    expect(performance.events.some((e) => e.track === 'bass')).toBe(true)
  })
})
