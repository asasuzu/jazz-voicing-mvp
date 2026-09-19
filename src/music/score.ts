import { DENSITY, PLAYABILITY, POWELL_FAMILY_BIAS, RANGES, SCORE_WEIGHTS, TOP_LINE_PENALTY } from './constants'
import { span } from './playability'
import type { DensityPreset, Voicing } from './types'
import { voicingDistance } from './voicings'

/**
 * スコア関数(小さいほど良い)。仕様: docs/IMPLEMENTATION_PLAN.md §5.1
 * 音の良し悪しは実装者には判断できないので、重みはすべてSCORE_WEIGHTS(constants.ts)を
 * 参照するだけにし、ロジック側に数値を書かない。
 */
export interface ScoreContext {
  density: DensityPreset
  recentFamilies: string[]   // 直前まで(最大3件)に選ばれたfamily
  targetNoteCount: number
  /** UIスライダーで0〜1.5に変更できる(仕様書§5.1)。SCORE_WEIGHTS.topLineの既定値をtake.ts側から渡す。 */
  topLineWeight: number
}

function allNotes(voicing: Voicing): number[] {
  return [...voicing.left, ...voicing.right]
}

function topNote(voicing: Voicing): number {
  return Math.max(...allNotes(voicing))
}

/** TOP_LINE_PENALTY表を引く。maxMoveは昇順に並んでいる前提。 */
function topLinePenalty(prev: Voicing, curr: Voicing): number {
  const movement = Math.abs(topNote(curr) - topNote(prev))
  const row = TOP_LINE_PENALTY.find((entry) => movement <= entry.maxMove)
  return row ? row.penalty : TOP_LINE_PENALTY[TOP_LINE_PENALTY.length - 1].penalty
}

/**
 * 音域中心からの距離。左手はdensityごとのleftHandRange、右手はRANGES.rightHandDefaultを
 * 基準にする(vocab/rootless.tsが右手をこの音域に置いているため)。1音あたりの平均距離。
 */
function registerPenalty(voicing: Voicing, density: DensityPreset): number {
  const leftRange = DENSITY[density].leftHandRange
  const leftCenter = (leftRange.min + leftRange.max) / 2
  const rightCenter = (RANGES.rightHandDefault.min + RANGES.rightHandDefault.max) / 2

  const deviations = [
    ...voicing.left.map((note) => Math.abs(note - leftCenter)),
    ...voicing.right.map((note) => Math.abs(note - rightCenter)),
  ]
  if (deviations.length === 0) return 0
  return deviations.reduce((sum, value) => sum + value, 0) / deviations.length
}

/** 直近3つに同じfamilyが2回以上あれば+1、3回とも同じなら+2 */
function varietyPenalty(recentFamilies: string[], family: string): number {
  const occurrences = recentFamilies.filter((item) => item === family).length
  if (occurrences >= 3) return 2
  if (occurrences >= 2) return 1
  return 0
}

/** 前後で保たれる音の数(多いほど滑らか)。加点なのでscore側で減算する。 */
function commonToneCount(prev: Voicing, curr: Voicing): number {
  const prevNotes = [...allNotes(prev)].sort((a, b) => a - b)
  const currNotes = [...allNotes(curr)].sort((a, b) => a - b)
  let i = 0
  let j = 0
  let count = 0
  while (i < prevNotes.length && j < currNotes.length) {
    if (prevNotes[i] === currNotes[j]) {
      count += 1
      i += 1
      j += 1
    } else if (prevNotes[i] < currNotes[j]) {
      i += 1
    } else {
      j += 1
    }
  }
  return count
}

function noteCount(voicing: Voicing): number {
  return voicing.left.length + voicing.right.length
}

function wideSpanPenalty(voicing: Voicing): number {
  return Math.max(0, span(voicing) - PLAYABILITY.handSpanPreferred)
}

/**
 * prevが無い(進行の最初の音)場合は、voice leadingやトップラインを評価しようが
 * 無いので register と wideSpan だけで評価する(仕様書 §5.1)。
 */
export function score(prev: Voicing | null, curr: Voicing, context: ScoreContext): number {
  const registerTerm = SCORE_WEIGHTS.register * registerPenalty(curr, context.density)
  const wideSpanTerm = SCORE_WEIGHTS.wideSpanPenalty * wideSpanPenalty(curr)

  if (!prev) return registerTerm + wideSpanTerm

  const voiceLeadingTerm = SCORE_WEIGHTS.voiceLeading * voicingDistance(allNotes(prev), allNotes(curr))
  const topLineTerm = context.topLineWeight * topLinePenalty(prev, curr)
  // Powellは同じ型を繰り返すのが様式そのものなので、多様性の減点を外す。
  // 汎用のスコアをそのまま当てていたのが「バドっぽくない」の原因だった
  // (docs/FEEDBACK_01.md §2)。代わりに R7 / R10 を優先する重みを効かせる。
  const isPowellStyle = context.density === 'powell' || context.density === 'shell3'
  const varietyTerm = isPowellStyle
    ? 0
    : SCORE_WEIGHTS.familyVariety * varietyPenalty(context.recentFamilies, curr.family)
  const familyBiasTerm = isPowellStyle ? (POWELL_FAMILY_BIAS[curr.family] ?? 0) : 0
  const stabilityTerm = SCORE_WEIGHTS.noteCountStability * Math.abs(noteCount(curr) - context.targetNoteCount)
  const commonToneTerm = SCORE_WEIGHTS.commonTone * commonToneCount(prev, curr)

  return (
    voiceLeadingTerm +
    topLineTerm +
    registerTerm +
    varietyTerm +
    familyBiasTerm +
    stabilityTerm +
    wideSpanTerm -
    commonToneTerm
  )
}

/** 候補の一次絞り込み用。register項だけで並べる(仕様書 §5.2 手順1)。 */
export function registerOnlyScore(voicing: Voicing, density: DensityPreset): number {
  return registerPenalty(voicing, density)
}
