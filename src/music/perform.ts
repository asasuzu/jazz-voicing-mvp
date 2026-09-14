import type { Performance, PerformanceEvent, Take } from './types'

/**
 * Take → Performance の変換。
 *
 * 第1段階のこの時点ではまだリズム(コンピング/ベース/スウィング)を付けない。
 * 各コードをそのままの長さのブロックコードとして PerformanceEvent 化するだけ。
 * 試聴(render/audio.ts)も書き出し(render/midi.ts)もこの Performance だけを見るので、
 * 「試聴では鳴るが MIDI がズレる」という事故を構造的に防げる(仕様書 §0.2)。
 *
 * Step4 でコンピングパターン・ウォーキングベース・人間味を合流させて本実装に差し替える。
 */
export interface PerformOptions {
  tempo: number
  beatsPerBar: number
}

const BLOCK_CHORD_VELOCITY = 82 // 旧 midi.ts のノートオン速度をそのまま踏襲

export function buildPerformance(take: Take, _options: PerformOptions): Performance {
  const events: PerformanceEvent[] = []
  let cursor = 0

  take.voicings.forEach((voicing, index) => {
    const chord = take.chords[index]
    const midiNotes = [...voicing.left, ...voicing.right]
    midiNotes.forEach((midi) => {
      events.push({
        track: 'piano',
        midi,
        startBeat: cursor,
        durationBeats: chord.beats,
        velocity: BLOCK_CHORD_VELOCITY,
      })
    })
    cursor += chord.beats
  })

  return { events, totalBeats: cursor, take }
}
