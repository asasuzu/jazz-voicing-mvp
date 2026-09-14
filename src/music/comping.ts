import { COMP_PATTERNS, COMPING_DENSITY_SLIDER } from './constants'
import type { CompHit, CompPattern, DensityPreset, ParsedChord } from './types'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §7 */
export interface CompingHit {
  chordIndex: number   // どのコード(=どのVoicing)を鳴らすか
  startBeat: number     // 曲頭からの絶対拍位置。pushでは小節頭より前になることがある
  durationBeats: number
  accent: number
}

function weightedPick(patterns: CompPattern[], weights: number[]): CompPattern {
  const total = weights.reduce((sum, value) => sum + value, 0)
  let cursor = Math.random() * total
  for (let i = 0; i < patterns.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return patterns[i]
  }
  return patterns[patterns.length - 1]
}

/**
 * 密度スライダー(0〜100)によるweight補正。50が既定(補正なし)。
 * 0側でwhole/restを2倍・busyを0.3倍、100側はその逆(仕様書§7)。
 */
function densityMultiplier(patternId: string, rhythmDensity: number): number {
  const { default: mid, sparseMultiplier, busyMultiplier } = COMPING_DENSITY_SLIDER
  const isWholeOrRest = patternId === 'whole' || patternId === 'rest'
  const isBusy = patternId === 'busy'
  if (!isWholeOrRest && !isBusy) return 1

  if (rhythmDensity <= mid) {
    const t = (mid - rhythmDensity) / mid // 0(=mid)〜1(=0)
    const target = isWholeOrRest ? sparseMultiplier.wholeRest : sparseMultiplier.busy
    return 1 + t * (target - 1)
  }
  const t = (rhythmDensity - mid) / (100 - mid) // 0(=mid)〜1(=100)
  const target = isWholeOrRest ? busyMultiplier.wholeRest : busyMultiplier.busy
  return 1 + t * (target - 1)
}

function choosePattern(
  density: DensityPreset,
  rhythmDensity: number,
  previousPatternId: string | null,
  isFirstBar: boolean,
): CompPattern {
  const pool = COMP_PATTERNS.filter((pattern) => {
    if (!pattern.density.includes(density)) return false
    if (pattern.id === 'rest' && previousPatternId === 'rest') return false // restの直後にrestは選ばない
    if (pattern.id === 'push' && isFirstBar) return false // 曲頭の小節では食い込めない
    return true
  })
  const weights = pool.map((pattern) => pattern.weight * densityMultiplier(pattern.id, rhythmDensity))
  return weightedPick(pool, weights)
}

interface BarChord {
  chord: ParsedChord
  index: number   // chords配列上のインデックス(=voicingsのインデックスと対応)
  offset: number  // 小節頭からのオフセット(拍)
}

function groupByBar(chords: ParsedChord[]): { barStartBeat: number; barBeats: number; chords: BarChord[] }[] {
  const bars: { barStartBeat: number; barBeats: number; chords: BarChord[] }[] = []
  let cursor = 0

  chords.forEach((chord, index) => {
    let bar = bars[bars.length - 1]
    if (!bar || bar.chords[0].chord.barIndex !== chord.barIndex) {
      bar = { barStartBeat: cursor, barBeats: 0, chords: [] }
      bars.push(bar)
    }
    bar.chords.push({ chord, index, offset: bar.barBeats })
    bar.barBeats += chord.beats
    cursor += chord.beats
  })

  return bars
}

/** hitの拍位置から、小節内のどのコードに属するかを決める。押し込み(負)は次の小節の最初のコードとして扱う。 */
function chordIndexForOffset(barChords: BarChord[], offset: number): number {
  if (offset < 0) return barChords[0].index
  let result = barChords[0].index
  barChords.forEach((entry) => {
    if (entry.offset <= offset) result = entry.index
  })
  return result
}

/** コードが変わる位置には必ず発音を1つ置く(和音が鳴らない小節を作らない、仕様書§7) */
function ensureChordChangeHits(hits: CompHit[], barChords: BarChord[], barBeats: number): CompHit[] {
  const result = [...hits]
  barChords.forEach(({ offset }) => {
    if (result.some((hit) => hit.beat === offset)) return
    const laterBeats = result.filter((hit) => hit.beat > offset).map((hit) => hit.beat)
    const nextBeat = laterBeats.length > 0 ? Math.min(...laterBeats) : barBeats
    result.push({ beat: offset, durationBeats: Math.max(0.25, nextBeat - offset), accent: 0 })
  })
  return result.sort((a, b) => a.beat - b.beat)
}

/** 3拍子・6拍子は第2段階まで`whole`相当にフォールバックする(仕様書§7) */
function fallbackWholeHit(barBeats: number): CompHit[] {
  return [{ beat: 0, durationBeats: Math.max(0.5, barBeats - 0.5), accent: 0 }]
}

export function generateComping(
  chords: ParsedChord[],
  density: DensityPreset,
  rhythmDensity: number,
  beatsPerBar: number,
): CompingHit[] {
  const bars = groupByBar(chords)
  const result: CompingHit[] = []
  let previousPatternId: string | null = null

  bars.forEach((bar, barPosition) => {
    const isFirstBar = barPosition === 0
    let rawHits: CompHit[]
    if (beatsPerBar === 4) {
      const pattern = choosePattern(density, rhythmDensity, previousPatternId, isFirstBar)
      previousPatternId = pattern.id
      rawHits = pattern.hits
    } else {
      rawHits = fallbackWholeHit(bar.barBeats)
    }

    const hits = ensureChordChangeHits(rawHits, bar.chords, bar.barBeats)
    hits.forEach((hit) => {
      result.push({
        chordIndex: chordIndexForOffset(bar.chords, hit.beat),
        startBeat: bar.barStartBeat + hit.beat,
        durationBeats: hit.durationBeats,
        accent: hit.accent,
      })
    })
  })

  return result.sort((a, b) => a.startBeat - b.startBeat)
}
