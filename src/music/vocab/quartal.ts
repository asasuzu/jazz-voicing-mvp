import { offsetToDegreeName, placeOffsets } from './placement'
import type { Range } from './placement'
import type { ChordQuality, ParsedChord, Voicing } from '../types'

/**
 * Quartal（4度堆積）と So What コード。
 *
 * 4度で積むと響きが曖昧になり、3度堆積とは別の色が出る。So What は
 * Bill Evans が Miles Davis の "So What" で使った形で、下から4度を3回
 * 積んで最後だけ長3度を乗せる `1-11-b7-b3-5`。
 *
 * Sources:
 * - The Jazz Piano Site, Quartal Chord Voicings / So What Chord
 *   https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/quartal-voicings/
 * - PianoGroove, "So What" Chord Voicing
 *   https://www.pianogroove.com/jazz-piano-lessons/so-what-chord-voicing/
 */

/**
 * コードスケール。bass.ts の BASS_SCALES と内容は重なるが、あちらは
 * ベースラインの都合で変わりうるので、ボイシング側は独立して持つ。
 * 片方の調整がもう片方の響きを黙って変えるのを避けるため。
 */
const CHORD_SCALES: Partial<Record<ChordQuality, number[]>> = {
  major7: [0, 2, 4, 5, 7, 9, 11], // Ionian
  major: [0, 2, 4, 5, 7, 9, 11],
  minor7: [0, 2, 3, 5, 7, 9, 10], // Dorian
  dominant7: [0, 2, 4, 5, 7, 9, 10], // Mixolydian
  sus7: [0, 2, 4, 5, 7, 9, 10],
  minorMajor7: [0, 2, 3, 5, 7, 9, 11], // Melodic minor
}

/**
 * 4度堆積に入れてはいけない音。メジャー系とドミナントの完全11度は
 * 3度とぶつかるので避ける(sus7は11度が和音構成音なので対象外)。
 */
const AVOID_OFFSETS: Partial<Record<ChordQuality, number[]>> = {
  major7: [5],
  major: [5],
  dominant7: [5],
}

/** スケール上を3ステップ上がる = 4度。これをn回繰り返して積む。 */
function stackFourths(scale: number[], startIndex: number, count: number): number[] {
  const offsets: number[] = []
  let index = startIndex
  let octave = 0
  for (let i = 0; i < count; i += 1) {
    offsets.push(scale[index % scale.length] + 12 * octave)
    const nextIndex = index + 3
    if (nextIndex >= scale.length) octave += 1
    index = nextIndex % scale.length
  }
  return offsets
}

function isAscending(offsets: number[]): boolean {
  return offsets.every((value, index) => index === 0 || value > offsets[index - 1])
}

function toVoicing(
  midi: number[],
  offsets: number[],
  splitAt: number,
  family: string,
  label: string,
): Voicing {
  return {
    family,
    label,
    left: midi.slice(0, splitAt),
    right: midi.slice(splitAt),
    degrees: offsets.map(offsetToDegreeName),
  }
}

/** So What: 1-11-b7-b3-5。ベースがルートを弾く場合はルートを抜いた4音も使う。 */
function soWhatShapes(chord: ParsedChord): number[][] {
  if (chord.quality !== 'minor7') return []
  return [
    [0, 5, 10, 15, 19], // ルート入り(原型)
    [5, 10, 15, 19], // rootless
  ]
}

export function buildQuartalVoicings(
  chord: ParsedChord,
  overall: Range,
  totalNotes: [number, number],
): Voicing[] {
  const scale = CHORD_SCALES[chord.quality]
  if (!scale) return []
  // テンションが記号で指定されたドミナントは、指定を無視した響きになるので対象外。
  if (chord.quality === 'dominant7' && (chord.flags.alt || chord.flags.flat9 || chord.flags.sharp9 || chord.flags.flat13)) {
    return []
  }

  const avoid = AVOID_OFFSETS[chord.quality] ?? []
  const results: Voicing[] = []

  const shapes: { offsets: number[]; family: string; label: string }[] = []

  for (let size = totalNotes[0]; size <= Math.min(totalNotes[1], 5); size += 1) {
    for (let startIndex = 0; startIndex < scale.length; startIndex += 1) {
      const offsets = stackFourths(scale, startIndex, size)
      if (!isAscending(offsets)) continue
      if (offsets.some((offset) => avoid.includes(offset % 12))) continue
      shapes.push({ offsets, family: 'quartal', label: 'Quartal' })
    }
  }

  soWhatShapes(chord).forEach((offsets) => {
    if (offsets.length < totalNotes[0] || offsets.length > totalNotes[1]) return
    shapes.push({ offsets, family: 'so-what', label: 'So What' })
  })

  shapes.forEach(({ offsets, family, label }) => {
    // 手の分け方も候補にする。下から2音を左手にするのが基本だが、
    // 音数が多いときは3音左手も弾ける配置がある。
    const splits = offsets.length >= 5 ? [2, 3] : [2]
    splits.forEach((splitAt) => {
      placeOffsets(offsets, chord.rootPc, overall).forEach((midi) => {
        results.push(toVoicing(midi, offsets, splitAt, family, label))
      })
    })
  })

  return results
}
