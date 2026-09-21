import {
  COMP_PATTERNS,
  COMPING_DENSITY_SLIDER,
  COLLISION_SHIFT_BEATS,
  OFFBEAT_DOMINANCE_RELAXATION,
  FORCED_HIT_OFFBEAT,
  FORCED_HIT_OFFBEAT_ACCENT,
  PUSH_AFTER_WHOLE_BOOST,
} from './constants'
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

  // offbeats は既定で9割超を占める。スライダーを端へ振ったときだけ独占を緩めて、
  // 他のパターンが出るようにする(そうしないとスライダーが効かなくなる)。
  if (patternId === 'offbeats') {
    const distance = Math.abs(rhythmDensity - mid) / mid // 0(中央)〜1(端)
    return 1 + distance * (OFFBEAT_DOMINANCE_RELAXATION - 1)
  }

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
    // 白玉の直後に白玉は選ばない。利用者の指摘:「全音符が2回続くのとかやめてほしい
    // (裏から入ってたらまだまし)」。伸ばすこと自体ではなく、同じ入り方が
    // 2回続くのが問題なので、次で伸ばしたいときは食い込み(push)を使う。
    if (pattern.id === 'whole' && previousPatternId === 'whole') return false
    if (pattern.id === 'push' && isFirstBar) return false // 曲頭の小節では食い込めない
    return true
  })
  const weights = pool.map((pattern) => {
    let weight = pattern.weight * densityMultiplier(pattern.id, rhythmDensity)
    // 白玉の次に伸ばすなら裏から入る、という指摘を反映して push を出やすくする
    if (pattern.id === 'push' && previousPatternId === 'whole') weight *= PUSH_AFTER_WHOLE_BOOST
    return weight
  })
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

/** 3拍子・6拍子は第2段階まで`whole`相当にフォールバックする(仕様書§7) */
function fallbackWholeHit(barBeats: number): CompHit[] {
  return [{ beat: 0, durationBeats: Math.max(0.5, barBeats - 0.5), accent: 0 }]
}

/** コードチェンジの絶対拍位置。先取りの判定に使う。 */
interface ChordChange {
  beat: number
  index: number
}

function chordChanges(chords: ParsedChord[]): ChordChange[] {
  const changes: ChordChange[] = []
  let cursor = 0
  chords.forEach((chord, index) => {
    changes.push({ beat: cursor, index })
    cursor += chord.beats
  })
  return changes
}

/**
 * 発音をどのコードに割り当てるか。
 *
 * **半拍後にコードが変わるなら、そのコードを先取りする。**
 * 利用者の指定:「全部先取り」。4拍裏は次の小節のコード、1小節に2コードある
 * 小節の2拍裏は3拍目から始まるコード、という具合に、裏拍がコードチェンジの
 * 直前にあるときは常に次のコードを鳴らす。ベースも4拍目で次のルートへ
 * 向かっているので、そこと揃う。
 *
 * 最後の小節の4拍裏は、**次の周の1小節目**を先取りする(進行は繰り返す前提)。
 * ここを先取りしないと、ループの継ぎ目だけ他と違う入り方になる。
 *
 * ループでは次の周が別のテイクなので、先取りに使うボイシングと、次の周が
 * 実際に鳴らすボイシングは違う。ただし裏拍しか打たない今のスタイルでは、
 * 次に同じコードが鳴るのは2拍後(次の小節の2拍裏)なので、同じコードの
 * 弾き直しとして自然に聞こえる。半拍後に別のボイシングが来るわけではない。
 */
function chordIndexForBeat(changes: ChordChange[], beat: number, totalBeats: number): number {
  const anticipating = changes.find((change) => Math.abs(change.beat - (beat + 0.5)) < 0.01)
  if (anticipating) return anticipating.index

  // 進行の終わりをまたぐ先取り(4小節目の4裏 → 1小節目)
  if (Math.abs(totalBeats - (beat + 0.5)) < 0.01) return changes[0].index

  let result = changes[0].index
  changes.forEach((change) => {
    if (change.beat <= beat + 0.01) result = change.index
  })
  return result
}

export function generateComping(
  chords: ParsedChord[],
  density: DensityPreset,
  rhythmDensity: number,
  beatsPerBar: number,
): CompingHit[] {
  const bars = groupByBar(chords)
  const changes = chordChanges(chords)
  const totalBeats = chords.reduce((sum, chord) => sum + chord.beats, 0)

  // 1. パターンを選んで、絶対拍位置の発音リストを作る
  const raw: { startBeat: number; durationBeats: number; accent: number }[] = []
  let previousPatternId: string | null = null

  bars.forEach((bar, barPosition) => {
    let barHits: CompHit[]
    if (beatsPerBar === 4) {
      const pattern = choosePattern(density, rhythmDensity, previousPatternId, barPosition === 0)
      previousPatternId = pattern.id
      barHits = pattern.hits
    } else {
      barHits = fallbackWholeHit(bar.barBeats)
    }

    // 直前の4拍裏で鳴らしているなら、この小節の拍1は打たない。
    // 利用者の指摘:「4裏から1頭でうつのは0.000001割ぐらいでいいです」。
    // パターンごと外すと変化が消えるので、拍1の発音だけ落とす。
    const anticipated = raw.some(
      (hit) => Math.abs(hit.startBeat - (bar.barStartBeat - 0.5)) < 0.01,
    )
    const trimmed = anticipated ? barHits.filter((hit) => Math.abs(hit.beat) > 0.01) : barHits

    trimmed.forEach((hit) => {
      raw.push({
        startBeat: bar.barStartBeat + hit.beat,
        durationBeats: hit.durationBeats,
        accent: hit.accent,
      })
    })
  })

  // 2. コードへ割り当てる(先取りを含む)
  let result: CompingHit[] = raw.map((hit) => ({
    chordIndex: chordIndexForBeat(changes, hit.startBeat, totalBeats),
    startBeat: hit.startBeat,
    durationBeats: hit.durationBeats,
    accent: hit.accent,
  }))

  // 3. 一度も鳴らないコードが出たら足す
  result = ensureEveryChordSounds(result, changes, totalBeats)

  // 4. 同じ瞬間の重なりを解消
  return resolveCollisions(result.sort((a, b) => a.startBeat - b.startBeat))
}

/**
 * 一度も鳴らないコードが出ないようにする。
 *
 * 先取りを入れると、例えば「Dm7 G7」の小節で2拍裏がG7の先取りになり、
 * Dm7が鳴らないまま終わることがある。位置は問わないので、その区間の中で
 * 空いているところへ1発足す。裏を優先する(拍1に足すと、直前の先取りと
 * 合わせて「4裏から1頭」になってしまう)。
 */
function ensureEveryChordSounds(
  hits: CompingHit[],
  changes: ChordChange[],
  totalBeats: number,
): CompingHit[] {
  const result = [...hits]

  changes.forEach((change, position) => {
    if (result.some((hit) => hit.chordIndex === change.index)) return

    const nextBeat = changes[position + 1]?.beat ?? totalBeats
    const offbeat = change.beat + FORCED_HIT_OFFBEAT
    const occupied = (beat: number) =>
      result.some((hit) => Math.abs(hit.startBeat - beat) < 0.01)

    const candidates = [offbeat, change.beat + 0.5, change.beat]
    const beat = candidates.find((value) => value < nextBeat - 0.2 && !occupied(value)) ?? change.beat

    const laterBeats = result.filter((hit) => hit.startBeat > beat).map((hit) => hit.startBeat)
    const until = laterBeats.length > 0 ? Math.min(...laterBeats) : nextBeat

    result.push({
      chordIndex: change.index,
      startBeat: beat,
      durationBeats: Math.max(0.25, Math.min(until - beat, nextBeat - beat)),
      accent: Math.abs(beat - change.beat) > 0.01 ? FORCED_HIT_OFFBEAT_ACCENT : 0,
    })
  })

  return result.sort((a, b) => a.startBeat - b.startBeat)
}

/**
 * 同じ瞬間に別のコードが2つ鳴るのを防ぐ。
 *
 * 前の小節の裏拍(例: 4拍裏)と、次の小節の食い込み(-0.5拍)は同じ位置になる。
 * そのまま出すと、古いコードと新しいコードが同時に鳴って濁る。
 * 食い込みは「次のコードを先取りする」ものなので、新しいほうを残す。
 */
function resolveCollisions(hits: CompingHit[]): CompingHit[] {
  const result = [...hits]

  for (let i = result.length - 2; i >= 0; i -= 1) {
    const earlier = result[i]
    const later = result[i + 1]
    const sameMoment = Math.abs(later.startBeat - earlier.startBeat) < 0.01
    if (!sameMoment || later.chordIndex === earlier.chordIndex) continue

    // 古いコードが他でも鳴っているなら、そちらを消して食い込みを活かす。
    const earlierSoundsElsewhere = result.some(
      (hit, index) => index !== i && hit.chordIndex === earlier.chordIndex,
    )
    if (earlierSoundsElsewhere) {
      result.splice(i, 1)
      continue
    }

    // 古いコードの唯一の発音なら、消すとそのコードが1度も鳴らなくなる。
    // 半拍前へずらして、両方とも鳴るようにする。
    const shifted = earlier.startBeat - COLLISION_SHIFT_BEATS
    result[i] = {
      ...earlier,
      startBeat: Math.max(0, shifted),
      durationBeats: Math.max(0.25, earlier.durationBeats + COLLISION_SHIFT_BEATS),
    }
  }

  return result.sort((a, b) => a.startBeat - b.startBeat)
}
