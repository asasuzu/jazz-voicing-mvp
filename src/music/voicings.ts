import type { ChordQuality, DensityPreset, ParsedChord, Voicing } from './types'
import { DENSITY, RANGES, SEARCH } from './constants'
import { isPlayable } from './playability'
import { buildPowellVoicings } from './vocab/powell'
import { buildQuartalVoicings } from './vocab/quartal'
import { buildUpperStructureVoicings } from './vocab/upperStructure'
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

/**
 * コードを決定づける音（ルートからの半音）。どれか1組を満たしていれば合格。
 *
 * 4度堆積は響きが曖昧なので、そのままだと「3度も7度も無いが音域には収まる」
 * 候補が通ってしまう。実際に Dm7 / G7 / Cmaj7 が同じ音の積みになり、G7 が
 * G7 に聞こえない状態が出た。VOICING_RESEARCH.md §1 の「3度と7度を核にする」
 * という原則は、方針として書いてあっただけでコードに入っていなかった。
 *
 * Powell は2音のシェルなので3度と7度を同時には持てない。ルートが下にあることで
 * コードが成立する語彙なので、この判定の対象外にする。
 */
const DEFINING_TONES: Record<ChordQuality, number[][]> = {
  major: [[4, 9], [4, 11]],
  major7: [[4, 11], [4, 9]],
  minor7: [[3, 10]],
  dominant7: [[4, 10]],
  halfDiminished: [[3, 10], [3, 6]],
  diminished7: [[3, 9]],
  minorMajor7: [[3, 11]],
  sus7: [[5, 10]],
}

function hasDefiningTones(chord: ParsedChord, voicing: Voicing): boolean {
  const present = new Set(
    [...voicing.left, ...voicing.right].map((midi) => ((midi % 12) - chord.rootPc + 12) % 12),
  )
  return DEFINING_TONES[chord.quality].some((group) => group.every((offset) => present.has(offset)))
}

export function generateVoicingsForChord(chord: ParsedChord, request: VoicingRequest): Voicing[] {
  const config = DENSITY[request.density]

  if (request.density === 'powell' || request.density === 'shell3') {
    return dedupeVoicings(buildPowellVoicings(chord, request.density)).filter(isPlayable)
  }

  // 両手の語彙は足し合わせる。1つの語彙だけだと候補が数個しか出ず、
  // ビームサーチに選ぶ余地が無くなる(docs/FEEDBACK_01.md §5)。
  const overall = { min: config.leftHandRange.min, max: RANGES.rightHandDefault.max }
  const raw = [
    ...buildRootlessVoicings(chord, config.leftHandRange, RANGES.rightHandDefault, config.totalNotes),
    ...buildUpperStructureVoicings(chord, config.leftHandRange, RANGES.rightHandDefault),
    ...buildQuartalVoicings(chord, overall, config.totalNotes),
  ].filter((voicing) => {
    const total = voicing.left.length + voicing.right.length
    if (total < config.totalNotes[0] || total > config.totalNotes[1]) return false
    return hasDefiningTones(chord, voicing)
  })

  return dedupeVoicings(raw).filter(isPlayable)
}
