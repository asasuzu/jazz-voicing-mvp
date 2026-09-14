import type { DensityPreset, ParsedChord, Voicing } from './types'
import { DENSITY, RANGES, SEARCH } from './constants'
import { isPlayable } from './playability'
import { buildPowellVoicings } from './vocab/powell'
import { buildRootlessVoicings } from './vocab/rootless'

/**
 * 前後のボイシングの移動量(声部ごとの移動距離の合計)。値が小さいほど滑らか。
 * score.ts の voiceLeadingDistance はこれをそのまま使う(仕様書§5.1)。
 */
export function voicingDistance(previous: number[], next: number[]): number {
  const a = [...previous].sort((x, y) => x - y)
  const b = [...next].sort((x, y) => x - y)
  const voices = Math.min(a.length, b.length)
  let total = 0
  for (let i = 0; i < voices; i += 1) total += Math.abs(a[i] - b[i])
  total += Math.abs(a.length - b.length) * 6
  return total
}

/** randomness=0では必ず最小スコアを返す(take.test.tsが決定性として検証する)。 */
export function weightedChoice<T>(items: T[], scores: number[], randomness: number): T {
  if (items.length === 1) return items[0]
  if (randomness <= 0.01) return items[scores.indexOf(Math.min(...scores))]

  const normalizedRandomness = Math.max(0, Math.min(1, randomness))
  const temperature = SEARCH.temperatureBase + normalizedRandomness * SEARCH.temperatureScale
  const minScore = Math.min(...scores)
  const weights = scores.map((score) => Math.exp(-(score - minScore) / temperature))
  const total = weights.reduce((sum, value) => sum + value, 0)
  let cursor = Math.random() * total

  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * 「下部構造 × 上部構造」の組み立て(仕様書§3 Step2-9)。densityに応じて
 * vocab/rootless.ts と vocab/powell.ts のどちらを使うかを振り分け、
 * 演奏可能性チェック(playability.ts)を通した候補だけを返す。
 */
export interface VoicingRequest {
  density: DensityPreset
  withBass: boolean
}

function dedupeVoicings(voicings: Voicing[]): Voicing[] {
  const seen = new Set<string>()
  return voicings.filter((voicing) => {
    const key = `${voicing.left.join('.')}|${voicing.right.join('.')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function generateVoicingsForChord(chord: ParsedChord, request: VoicingRequest): Voicing[] {
  const config = DENSITY[request.density]

  const raw =
    request.density === 'powell' || request.density === 'shell3'
      ? buildPowellVoicings(chord, request.density)
      : buildRootlessVoicings(chord, config.leftHandRange, RANGES.rightHandDefault, config.totalNotes)

  return dedupeVoicings(raw).filter(isPlayable)
}
