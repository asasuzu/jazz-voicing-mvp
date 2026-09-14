import { RANGES } from '../constants'
import { buildAscendingIntervals } from '../theory'
import type { ChordQuality, ParsedChord, Voicing } from '../types'

/**
 * Bud Powell shell（左手のみ、必ずルートが最低音）。
 * 仕様: docs/IMPLEMENTATION_PLAN.md §4, 調査: docs/VOICING_RESEARCH.md §8
 */

function rootMidisInRange(rootPc: number, range: { min: number; max: number }): number[] {
  const result: number[] = []
  for (let midi = range.min; midi <= range.max; midi += 1) {
    if (midi % 12 === rootPc) result.push(midi)
  }
  return result // range.minから昇順なので、そのまま使えば「低いほうを優先」になる
}

function buildVoicing(rootMidi: number, degrees: string[], family: string, label: string): Voicing {
  const intervals = buildAscendingIntervals(degrees)
  return {
    family,
    label,
    left: intervals.map((interval) => rootMidi + interval),
    right: [],
    degrees,
  }
}

/** メジャー系は'3'、マイナー系は'b3'。diminished7は呼び出し側で個別対応する。 */
function thirdDegree(quality: ChordQuality): string {
  return quality === 'minor7' || quality === 'halfDiminished' || quality === 'minorMajor7' ? 'b3' : '3'
}

function tenthDegree(quality: ChordQuality): string {
  return thirdDegree(quality) === 'b3' ? 'b10' : '10'
}

/** major7/minorMajor7は長7度、dominant7/minor7/sus7/halfDiminishedは短7度。plain majorとdiminished7は無し。 */
function seventhDegree(quality: ChordQuality): string | null {
  if (quality === 'major7' || quality === 'minorMajor7') return '7'
  if (quality === 'dominant7' || quality === 'minor7' || quality === 'sus7' || quality === 'halfDiminished') return 'b7'
  return null
}

const SIXTH_QUALITIES: ChordQuality[] = ['major', 'major7', 'minor7'] // minor7はm6として使う

function buildDiminished(rootMidi: number, variant: 'powell' | 'shell3'): Voicing[] {
  if (variant === 'powell') {
    return [
      buildVoicing(rootMidi, ['1', 'b3'], 'powell-r3', 'Powell R3'),
      buildVoicing(rootMidi, ['1', 'bb7'], 'powell-r7', 'Powell R7 (bb7)'),
    ]
  }
  return [buildVoicing(rootMidi, ['1', 'bb7', 'b3'], 'powell-shell3', 'Powell shell3 (dim)')]
}

export function buildPowellVoicings(chord: ParsedChord, variant: 'powell' | 'shell3'): Voicing[] {
  const roots = rootMidisInRange(chord.rootPc, RANGES.powellLeftHand)
  const results: Voicing[] = []

  roots.forEach((rootMidi) => {
    if (chord.quality === 'diminished7') {
      results.push(...buildDiminished(rootMidi, variant))
      return
    }

    const seventh = seventhDegree(chord.quality)
    const third = thirdDegree(chord.quality)
    const tenth = tenthDegree(chord.quality)
    const hasSixth = SIXTH_QUALITIES.includes(chord.quality)

    if (variant === 'powell') {
      if (seventh) results.push(buildVoicing(rootMidi, ['1', seventh], 'powell-r7', 'Powell R7'))
      results.push(buildVoicing(rootMidi, ['1', third], 'powell-r3', 'Powell R3'))
      results.push(buildVoicing(rootMidi, ['1', tenth], 'powell-r10', 'Powell R10'))
      if (hasSixth) results.push(buildVoicing(rootMidi, ['1', '6'], 'powell-r6', 'Powell R6'))
      return
    }

    // shell3: root-seventh-thirdは、buildAscendingIntervalsの昇順規則により
    // 自然に「10度上の3度」になる(1-b7-3 と 1-b7-10 は同じ音になるので後者は作らない)。
    if (seventh) {
      results.push(buildVoicing(rootMidi, ['1', seventh, third], 'powell-shell3', 'Powell shell3'))
    } else if (hasSixth) {
      // 7thを持たないコード(plain majorなど)向けのフォールバック。仕様書に無いので決め打ち。
      results.push(buildVoicing(rootMidi, ['1', '6', third], 'powell-shell3', 'Powell shell3 (6th)'))
    }
  })

  return results
}
