import { LOW_INTERVAL_LIMITS, PLAYABILITY } from './constants'
import type { Voicing } from './types'

/**
 * 「弾けるか / 確実に濁るか」だけを判定する。響きの好みはここでは判定しない
 * (仕様書 §2, §5.3)。好みはscore.tsのスコアで扱う。
 */
export interface PlayabilityIssue {
  code: string
  message: string
}

function handSpan(hand: number[]): number {
  if (hand.length === 0) return 0
  return Math.max(...hand) - Math.min(...hand)
}

/** 片手の幅(左右のうち大きいほう)。score.tsのwideSpanPenaltyでも使う。 */
export function span(voicing: Voicing): number {
  return Math.max(handSpan(voicing.left), handSpan(voicing.right))
}

function checkHandSpan(hand: number[], label: string, issues: PlayabilityIssue[]): void {
  if (hand.length === 0) return
  const width = handSpan(hand)
  if (width > PLAYABILITY.handSpanMax) {
    issues.push({
      code: 'handSpanMax',
      message: `${label}の幅が${width}半音あり、上限の${PLAYABILITY.handSpanMax}半音を超えています。`,
    })
  }
  if (hand.length > PLAYABILITY.notesPerHandMax) {
    issues.push({
      code: 'notesPerHandMax',
      message: `${label}の音数が${hand.length}あり、上限の${PLAYABILITY.notesPerHandMax}音を超えています。`,
    })
  }
}

function checkHandsRelation(voicing: Voicing, issues: PlayabilityIssue[]): void {
  if (voicing.left.length === 0 || voicing.right.length === 0) return

  const leftTop = Math.max(...voicing.left)
  const rightBottom = Math.min(...voicing.right)

  if (leftTop > rightBottom) {
    issues.push({ code: 'handsCrossed', message: '左手の最高音が右手の最低音より上にあり、手が交差します。' })
    return // 交差している場合、隙間の判定は意味を持たない
  }

  if (rightBottom - leftTop > PLAYABILITY.handGapMax) {
    issues.push({
      code: 'handGapMax',
      message: `左右の隙間が${rightBottom - leftTop}半音あり、上限の${PLAYABILITY.handGapMax}半音を超えています。`,
    })
  }
}

/**
 * 低音側の濁りと短9度の衝突。どちらも「隣り合う音のペア」にのみ適用する
 * (仕様書 §2 のコメント)。両手をまたいでも、音を全部合わせて並べた上での
 * 隣接ペアとして扱う。
 */
function checkAdjacentIntervals(voicing: Voicing, issues: PlayabilityIssue[]): void {
  const notes = [...voicing.left, ...voicing.right].sort((a, b) => a - b)

  for (let i = 1; i < notes.length; i += 1) {
    const lower = notes[i - 1]
    const upper = notes[i]
    const interval = upper - lower

    const limit = LOW_INTERVAL_LIMITS[interval]
    if (limit !== undefined && lower < limit) {
      issues.push({
        code: 'lowInterval',
        message: `${lower}と${upper}の間隔(${interval}半音)は、この高さでは濁ります。`,
      })
    }

    // 短9度(オクターブ+半音=13半音)の衝突。極端な濁りなので土台の段階で除外する。
    if (interval > 12 && interval % 12 === 1) {
      issues.push({
        code: 'minorNinthCollision',
        message: `${lower}と${upper}の間隔(${interval}半音)は短9度の衝突になります。`,
      })
    }
  }
}

function checkTotalNotes(voicing: Voicing, issues: PlayabilityIssue[]): void {
  const total = voicing.left.length + voicing.right.length
  if (total > PLAYABILITY.totalNotesMax) {
    issues.push({
      code: 'totalNotesMax',
      message: `合計音数が${total}あり、上限の${PLAYABILITY.totalNotesMax}音を超えています。`,
    })
  }
}

export function checkPlayability(voicing: Voicing): PlayabilityIssue[] {
  const issues: PlayabilityIssue[] = []
  checkHandSpan(voicing.left, '左手', issues)
  checkHandSpan(voicing.right, '右手', issues)
  checkHandsRelation(voicing, issues)
  checkAdjacentIntervals(voicing, issues)
  checkTotalNotes(voicing, issues)
  return issues
}

export function isPlayable(voicing: Voicing): boolean {
  return checkPlayability(voicing).length === 0
}
