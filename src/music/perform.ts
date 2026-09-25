import { generateBassLine } from './bass'
import { generateComping } from './comping'
import { ARPEGGIO, COMPING_DENSITY_SLIDER, VELOCITY } from './constants'
import { humanize } from './humanize'
import type { SwingSetting } from './humanize'
import type { DensityPreset, ParsedChord, Performance, PerformanceEvent, PianoStyle, Take, Voicing } from './types'

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
  /** 省略時は block(今までどおりのコンピング) */
  pianoStyle?: PianoStyle
  /** コンピングの密度スライダー(0〜100)。省略時はCOMPING_DENSITY_SLIDER.default。 */
  rhythmDensity?: number
  /**
   * 2コーラス目以降のテイクを作る関数。渡すとコーラスごとにボイシングを引き直す。
   * 「同じ進行でも毎周ちがう響き」がこのアプリの主目的なので、複数コーラスを
   * 書き出すときは必ず渡すこと。省略すると全コーラスで同じボイシングになる。
   */
  takeForChorus?: (chorusIndex: number, previousVoicing: Voicing) => Take
}

function pianoBaseVelocity(density: DensityPreset): number {
  return density === 'powell' || density === 'shell3' ? VELOCITY.powell.base : VELOCITY.piano.base
}

/** 1コーラス分のブロックコード進行の長さ(拍)。コーラス連結のオフセット計算に使う。 */
function chorusLength(take: Take): number {
  return take.chords.reduce((sum, chord) => sum + chord.beats, 0)
}

/**
 * アルペジオで、下から何番目の音をコード頭から何拍後に鳴らすか。
 * 基本はARPEGGIO.stepBeats間隔。コードが短くて並べきれないときは詰める。
 */
export function arpeggioOffsets(noteCount: number, chordBeats: number): number[] {
  if (noteCount <= 1) return [0]
  const step = Math.min(ARPEGGIO.stepBeats, (chordBeats * ARPEGGIO.fitRatio) / (noteCount - 1))
  return Array.from({ length: noteCount }, (_, index) => index * step)
}

/**
 * コードが変わるたびに1回、下から順に転がして、次のコードまで伸ばす。
 * コンピングのリズム(先取りなど)は使わない。転がし始めはコードの頭に揃える。
 */
function arpeggioEvents(take: Take, offset: number, velocity: number): PerformanceEvent[] {
  const events: PerformanceEvent[] = []
  let chordStart = 0
  take.chords.forEach((chord, chordIndex) => {
    const voicing = take.voicings[chordIndex]
    const notes = [...voicing.left, ...voicing.right].sort((a, b) => a - b)
    const offsets = arpeggioOffsets(notes.length, chord.beats)
    notes.forEach((midi, index) => {
      events.push({
        track: 'piano',
        midi,
        startBeat: offset + chordStart + offsets[index],
        durationBeats: chord.beats - offsets[index],
        velocity,
      })
    })
    chordStart += chord.beats
  })
  return events
}

export function buildPerformance(take: Take, options: PerformOptions): Performance {
  const rhythmDensity = options.rhythmDensity ?? COMPING_DENSITY_SLIDER.default
  const choruses = Math.max(1, options.choruses)
  const beatsPerChorus = chorusLength(take)
  const baseVelocity = pianoBaseVelocity(options.density)

  const events: PerformanceEvent[] = []
  let lastTake = take

  for (let chorus = 0; chorus < choruses; chorus += 1) {
    const offset = chorus * beatsPerChorus

    // コーラスごとにテイクもリズムも引き直す(仕様書§9)。1コーラス目は呼び出し側が
    // 選んだテイクをそのまま使い、2周目以降だけ引き直す。画面に出ているテイクと
    // 書き出しの1周目が食い違わないようにするため。
    const previousVoicing = lastTake.voicings[lastTake.voicings.length - 1]
    const chorusTake = chorus === 0 ? take : options.takeForChorus?.(chorus, previousVoicing) ?? take
    lastTake = chorusTake
    if (options.pianoStyle === 'arpeggio') {
      events.push(...arpeggioEvents(chorusTake, offset, baseVelocity))
    }
    const compingHits =
      options.pianoStyle === 'arpeggio'
        ? []
        : generateComping(chorusTake.chords, options.density, rhythmDensity, options.beatsPerBar)
    compingHits.forEach((hit) => {
      const voicing = chorusTake.voicings[hit.chordIndex]
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
      generateBassLine(chorusTake.chords, options.beatsPerBar).forEach((note) => {
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

/**
 * コーラス先頭から数えた拍位置が、何番目のコードに当たるかを返す。
 * 範囲外(拍が進行の長さを超えている)ならnull。
 *
 * 「今どのコードが鳴っているか」の表示に使う。1小節に複数コードがある場合は
 * chord.beatsが既に分割されているので、そのまま足していけばよい。
 */
export function chordIndexAtBeat(chords: ParsedChord[], beat: number): number | null {
  if (beat < 0) return null
  let cursor = 0
  for (let i = 0; i < chords.length; i += 1) {
    cursor += chords[i].beats
    if (beat < cursor) return i
  }
  return null
}
