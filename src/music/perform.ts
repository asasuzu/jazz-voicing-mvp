import { generateBassLine } from './bass'
import { generateComping } from './comping'
import { COMPING_DENSITY_SLIDER, VELOCITY } from './constants'
import { humanize } from './humanize'
import type { SwingSetting } from './humanize'
import type { DensityPreset, Performance, PerformanceEvent, Take } from './types'

/**
 * Take → Performance の本実装(Step4)。コンピング(comping.ts)とウォーキングベース
 * (bass.ts)でリズムを付け、人間味(humanize.ts)でスウィングとベロシティの揺れを
 * 適用する。試聴(render/audio.ts)も書き出し(render/midi.ts)もこのPerformanceだけを
 * 見るので、「試聴では鳴るがMIDIがズレる」という事故を構造的に防げる(仕様書§0.2)。
 */
export interface PerformOptions {
  tempo: number
  beatsPerBar: number
  withBass: boolean
  strict: boolean
  swing: SwingSetting
  density: DensityPreset
  choruses: number
  /** コンピングの密度スライダー(0〜100)。省略時はCOMPING_DENSITY_SLIDER.default。 */
  rhythmDensity?: number
}

function pianoBaseVelocity(density: DensityPreset): number {
  return density === 'powell' || density === 'shell3' ? VELOCITY.powell.base : VELOCITY.piano.base
}

/** 1コーラス分のブロックコード進行の長さ(拍)。コーラス連結のオフセット計算に使う。 */
function chorusLength(take: Take): number {
  return take.chords.reduce((sum, chord) => sum + chord.beats, 0)
}

export function buildPerformance(take: Take, options: PerformOptions): Performance {
  const rhythmDensity = options.rhythmDensity ?? COMPING_DENSITY_SLIDER.default
  const choruses = Math.max(1, options.choruses)
  const beatsPerChorus = chorusLength(take)
  const baseVelocity = pianoBaseVelocity(options.density)

  const events: PerformanceEvent[] = []

  for (let chorus = 0; chorus < choruses; chorus += 1) {
    const offset = chorus * beatsPerChorus

    // コーラスごとにリズムを引き直す(仕様書§9)。ボイシング自体(take.voicings)は
    // 呼び出し側が選んだテイクを毎コーラス使い回す
    // (テイクの引き直しはApp.tsx側のループ再生が別途担っている)。
    const compingHits = generateComping(take.chords, options.density, rhythmDensity, options.beatsPerBar)
    compingHits.forEach((hit) => {
      const voicing = take.voicings[hit.chordIndex]
      ;[...voicing.left, ...voicing.right].forEach((midi) => {
        events.push({
          track: 'piano',
          midi,
          startBeat: offset + hit.startBeat,
          durationBeats: hit.durationBeats,
          velocity: baseVelocity + hit.accent,
        })
      })
    })

    if (options.withBass) {
      generateBassLine(take.chords, options.beatsPerBar).forEach((note) => {
        events.push({
          track: 'bass',
          midi: note.midi,
          startBeat: offset + note.startBeat,
          durationBeats: note.durationBeats,
          velocity: VELOCITY.bass.base,
        })
      })
    }
  }

  const humanized = humanize(events, {
    strict: options.strict,
    tempo: options.tempo,
    swing: options.swing,
    density: options.density,
    beatsPerBar: options.beatsPerBar,
  })

  return { events: humanized, totalBeats: beatsPerChorus * choruses, take }
}
