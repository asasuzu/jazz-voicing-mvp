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

/** hitの拍位置から、小節内のどのコードに属するかを決める。押し込み(負)は次の小節の最初のコードとして扱う。 */
function chordIndexForOffset(barChords: BarChord[], offset: number): number {
  if (offset < 0) return barChords[0].index
  let result = barChords[0].index
  barChords.forEach((entry) => {
    if (entry.offset <= offset) result = entry.index
  })
  return result
}

/**
 * 新しく出てきたコードが一度も鳴らないまま終わるのを防ぐ。
 *
 * 以前は「各コードの開始位置に発音が無ければ足す」という実装だったが、
 * 1小節1コードだと必ず拍0に発音が足されるので、**全小節が拍1から始まる**
 * 状態になっていた(実測100%)。Offbeats も Push も Rest も、拍1から始まる
 * 音に化けていて、Restは一度も休んでいなかった。
 *
 * 正しくは「そのコードが区間内のどこかで鳴れば良い」。位置は問わない。
 * - 食い込み(負の拍)でそのコードが鳴るなら、小節頭に足す必要は無い
 * - 前の小節から同じコードが続いているなら、鳴らし直さなくても良い
 *   (弾き手が1小節休むのは普通のこと)
 */
function ensureEachChordSounds(
  hits: CompHit[],
  barChords: BarChord[],
  barBeats: number,
  previousChordIndex: number | null,
  /** 直前の4拍裏で鳴らしている場合、拍1へは足さない(裏へ回す) */
  anticipated = false,
): CompHit[] {
  const result = [...hits]

  barChords.forEach(({ offset, index }, position) => {
    // 前の小節から続いているコードは、鳴らし直さなくてよい
    if (position === 0 && index === previousChordIndex) return

    const nextOffset = barChords[position + 1]?.offset ?? barBeats
    const alreadySounds = result.some((hit) => {
      const target = chordIndexForOffset(barChords, hit.beat)
      return target === index && hit.beat < nextOffset
    })
    if (alreadySounds) return

    const laterBeats = result.filter((hit) => hit.beat > offset).map((hit) => hit.beat)
    const nextBeat = laterBeats.length > 0 ? Math.min(...laterBeats) : barBeats

    // 鳴らす位置。Rest のように発音がまったく無いパターンで拍0に足すと、
    // 白玉と区別が付かなくなり「全音符が2回続く」の原因になる。
    // 裏から入れば伸ばしても嫌がられない、という指摘に沿って裏へ置く。
    const offbeat = offset + FORCED_HIT_OFFBEAT
    const wantsOffbeat = result.length === 0 || (anticipated && offset === 0)
    const canUseOffbeat = wantsOffbeat && offbeat < nextBeat - 0.25
    const beat = canUseOffbeat ? offbeat : offset

    result.push({
      beat,
      durationBeats: Math.max(0.25, nextBeat - beat),
      accent: canUseOffbeat ? FORCED_HIT_OFFBEAT_ACCENT : 0,
    })
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
  let previousChordIndex: number | null = null

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

    // 直前の4拍裏で鳴らしているなら、この小節の拍1は打たない。
    // 利用者の指摘:「4裏から1頭でうつのは0.000001割ぐらいでいいです」。
    // 食い込んでおいて叩き直すのは、実際の弾き方としても無い。
    // パターンごと外すと変化が消えるので、拍1の発音だけ落とす。
    const anticipated = result.some(
      (hit) => Math.abs(hit.startBeat - (bar.barStartBeat - 0.5)) < 0.01,
    )
    const trimmed = anticipated ? rawHits.filter((hit) => Math.abs(hit.beat) > 0.01) : rawHits

    const hits = ensureEachChordSounds(trimmed, bar.chords, bar.barBeats, previousChordIndex, anticipated)
    previousChordIndex = bar.chords[bar.chords.length - 1].index
    hits.forEach((hit) => {
      result.push({
        chordIndex: chordIndexForOffset(bar.chords, hit.beat),
        startBeat: bar.barStartBeat + hit.beat,
        durationBeats: hit.durationBeats,
        accent: hit.accent,
      })
    })
  })

  return resolveCollisions(result.sort((a, b) => a.startBeat - b.startBeat))
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
