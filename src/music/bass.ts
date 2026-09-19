import { BASS, BASS_ALTERED_SCALE, BASS_CHORD_TONES, BASS_SCALES, RANGES } from './constants'
import type { ParsedChord } from './types'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §6、docs/FEEDBACK_01.md §1 */
export interface BassNote {
  midi: number
  startBeat: number
  durationBeats: number
}

/**
 * 中心に据える基準音。以前は RANGES.bass(E1–G3、2オクターブ強)全体の中心を
 * 使っていたが、それだと中心へ戻る力がまったく働かず音域が漂っていた
 * (docs/FEEDBACK_01.md §1(d))。walkingの実用域として仕様書が挙げた
 * E1–E3(BASS.preferredRangeMin/Max)の中心を使う。
 */
const BASS_CENTER = (BASS.preferredRangeMin + BASS.preferredRangeMax) / 2

function wrapPc(value: number): number {
  return ((value % 12) + 12) % 12
}

function scaleFor(chord: ParsedChord): number[] {
  if (chord.quality === 'dominant7' && chord.flags.alt) return BASS_ALTERED_SCALE
  return BASS_SCALES[chord.quality]
}

/** 指定したピッチクラスのうち、RANGES.bass内にあるMIDI番号をすべて返す */
function midisForPc(pc: number): number[] {
  const result: number[] = []
  for (let midi = RANGES.bass.min; midi <= RANGES.bass.max; midi += 1) {
    if (wrapPc(midi) === pc) result.push(midi)
  }
  return result
}

/**
 * 音域の好ましい範囲(BASS.preferredRangeMin〜Max)から外れている分だけのペナルティ。
 * 「弱いバイアス」なので、オクターブ違い(12半音)の距離差を逆転させるほど強くはしない
 * (docs/FEEDBACK_01.md §1決定事項4)。
 */
function centerBiasPenalty(midi: number): number {
  if (midi < BASS.preferredRangeMin) return BASS.preferredRangeMin - midi
  if (midi > BASS.preferredRangeMax) return midi - BASS.preferredRangeMax
  return 0
}

function distanceScore(candidate: number, anchor: number): number {
  return Math.abs(candidate - anchor) + centerBiasPenalty(candidate) * BASS.centerBiasWeightPerSemitone
}

/**
 * オクターブは前の音(なければ音域中央)に最も近いものを選ぶ(仕様書§6)。
 * 中心から離れた候補には弱いペナルティを足し、音域を狭めて中心へ戻す
 * (docs/FEEDBACK_01.md §1決定事項4)。
 */
function closestMidi(pc: number, anchor: number): number {
  const options = midisForPc(pc)
  return options.reduce((best, candidate) =>
    distanceScore(candidate, anchor) < distanceScore(best, anchor) ? candidate : best,
  )
}

/** 重み付きの抽選順を作る(重複無しの並べ替え)。先頭が外れても次点へフォールバックできる。 */
function weightedShuffle<T>(items: T[], weights: number[]): T[] {
  const pool = items.map((item, index) => ({ item, weight: weights[index] }))
  const order: T[] = []
  while (pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0)
    let cursor = Math.random() * total
    let pickedIndex = pool.length - 1
    for (let i = 0; i < pool.length; i += 1) {
      cursor -= pool[i].weight
      if (cursor <= 0) {
        pickedIndex = i
        break
      }
    }
    order.push(pool[pickedIndex].item)
    pool.splice(pickedIndex, 1)
  }
  return order
}

/**
 * 候補のピッチクラス順(order)を、直前の音からの跳躍が BASS.maxLeapSemitones 以内の
 * ものだけに絞り込む(docs/FEEDBACK_01.md §1決定事項5)。全部が範囲外なら元の順序へ
 * フォールバックする(「原則」なので絶対条件にはしない)。コードの頭(ルート等)は
 * 例外として呼び出し側でこの関数を使わない。
 */
function withinLeap(order: number[], anchor: number, maxLeap: number): number[] {
  const filtered = order.filter((pc) => Math.abs(closestMidi(pc, anchor) - anchor) <= maxLeap)
  return filtered.length > 0 ? filtered : order
}

/**
 * 候補ピッチクラスの並び(優先順)から実際のMIDIを決める。
 * 「直前と同じ音は避ける」「同じ音を3回連続させない」を満たす候補を優先し、
 * どうしても無ければ先頭候補をそのまま返す(仕様書§6の逃げ道)。
 */
function pickFromOrder(order: number[], anchor: number, previousMidi: number | null, line: BassNote[]): number {
  const last = line[line.length - 1]
  const secondLast = line[line.length - 2]
  const wouldTripleRepeat = (midi: number) =>
    !!last && !!secondLast && last.midi === secondLast.midi && last.midi === midi

  for (const pc of order) {
    const midi = closestMidi(pc, anchor)
    if (order.length > 1 && midi === previousMidi) continue
    if (wouldTripleRepeat(midi)) continue
    return midi
  }
  return closestMidi(order[0], anchor)
}

function pickHeadNote(
  chord: ParsedChord,
  anchor: number,
  previousMidi: number | null,
  line: BassNote[],
  forceRoot: boolean,
): number {
  if (forceRoot) {
    // 6. コーラスの1小節目の1拍目は確率1.0でルート(docs/FEEDBACK_01.md §1決定事項6)。
    return pickFromOrder([chord.rootPc], anchor, previousMidi, line)
  }
  const tones = BASS_CHORD_TONES[chord.quality]
  const pcs = [chord.rootPc, wrapPc(chord.rootPc + tones.fifth), wrapPc(chord.rootPc + tones.third)]
  const weights = [BASS.headRootWeight, BASS.headFifthWeight, BASS.headThirdWeight]
  // コードの頭は仕様書§1決定事項5の跳躍上限の例外(新しいコードのルートへ跳ぶのは正当なので)。
  return pickFromOrder(weightedShuffle(pcs, weights), anchor, previousMidi, line)
}

function pickMiddleNote(
  chord: ParsedChord,
  anchor: number,
  previousMidi: number | null,
  line: BassNote[],
  directionSign: number,
  directionRun: number,
  forceChordTone: boolean,
): number {
  const tones = BASS_CHORD_TONES[chord.quality]
  const chordToneOffsets = [0, tones.third, tones.fifth, tones.seventh].filter(
    (value): value is number => value !== null,
  )
  // 2. 強拍(3拍目)はコードトーンのみ。弱拍(2・4拍目)はスケール音も候補に加える
  // (docs/FEEDBACK_01.md §1決定事項2)。1小節2コードでアプローチ音を入れない拍
  // (決定事項3)もforceChordTone=trueで同じ経路を通る。
  const offsets = forceChordTone
    ? chordToneOffsets
    : Array.from(new Set([...chordToneOffsets, ...scaleFor(chord)]))
  const pcs = offsets.map((offset) => wrapPc(chord.rootPc + offset))

  const withMidi = pcs.map((pc) => ({ pc, midi: closestMidi(pc, anchor) }))

  // 1. 直前の音から±BASS.middleStepMaxDistance半音以内に候補を絞る
  // (docs/FEEDBACK_01.md §1決定事項1)。絞った結果ゼロ件ならフォールバックする。
  const near = withMidi.filter((candidate) => Math.abs(candidate.midi - anchor) <= BASS.middleStepMaxDistance)
  const candidates = near.length > 0 ? near : withMidi

  // 同方向が5音以上続いていたら、逆方向に動く候補を優先する(仕様書§6の追加ルール)。
  const reversed = candidates.filter((candidate) => {
    if (directionRun < BASS.directionReversalRun) return true
    const diff = candidate.midi - anchor
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0
    return sign !== directionSign
  })
  const pool = reversed.length > 0 ? reversed : candidates

  // 距離が近いほど指数的に重みが大きくなるようにして抽選する
  // (docs/FEEDBACK_01.md §1決定事項1: 「1/(i+1)ではなく指数的に」)。
  const order = weightedShuffle(
    pool.map((candidate) => candidate.pc),
    pool.map((candidate) => BASS.middleStepWeightDecay ** Math.abs(candidate.midi - anchor)),
  )

  // 5. 連続する2音の跳躍は原則5半音以内(docs/FEEDBACK_01.md §1決定事項5)。
  const capped = withinLeap(order, anchor, BASS.maxLeapSemitones)
  return pickFromOrder(capped, anchor, previousMidi, line)
}

/** 次のコードのスケールの中で、ルートのすぐ上またはすぐ下の音(半音オフセット) */
function scaleNeighborOffset(scale: number[]): number {
  const sorted = [...scale].sort((a, b) => a - b)
  const rootIndex = sorted.indexOf(0)
  const above = sorted[(rootIndex + 1) % sorted.length]
  const below = sorted[(rootIndex - 1 + sorted.length) % sorted.length] - 12
  return Math.random() < 0.5 ? above : below
}

function pickApproachNote(nextChord: ParsedChord, anchor: number, previousMidi: number | null, line: BassNote[]): number {
  const rootPc = nextChord.rootPc
  const pcs = [
    wrapPc(rootPc - 1),
    wrapPc(rootPc + 1),
    wrapPc(rootPc + scaleNeighborOffset(scaleFor(nextChord))),
    wrapPc(rootPc + 7),
  ]
  const weights = [
    BASS.approachChromaticBelowWeight,
    BASS.approachChromaticAboveWeight,
    BASS.approachScaleNeighborWeight,
    BASS.approachFifthAboveWeight,
  ]
  const order = weightedShuffle(pcs, weights)
  // 5. 連続する2音の跳躍は原則5半音以内(docs/FEEDBACK_01.md §1決定事項5)。
  const capped = withinLeap(order, anchor, BASS.maxLeapSemitones)
  return pickFromOrder(capped, anchor, previousMidi, line)
}

export function generateBassLine(chords: ParsedChord[], _beatsPerBar: number): BassNote[] {
  const line: BassNote[] = []
  let previousMidi: number | null = null
  let directionSign = 0
  let directionRun = 0
  let beatCursor = 0

  chords.forEach((chord, chordIndex) => {
    // 1小節に複数コードがある場合もbeats(拍数)がすでに縮められているので、
    // 「拍ごとの役割」の考え方をそのまま適用できる(仕様書§6の追加ルール)。
    const beatsInChord = Math.max(1, Math.round(chord.beats))
    const nextChord = chords[chordIndex + 1]

    for (let beatInChord = 0; beatInChord < beatsInChord; beatInChord += 1) {
      const isLastBeatOfChord = beatInChord === beatsInChord - 1
      const anchor = previousMidi ?? BASS_CENTER

      let midi: number
      if (isLastBeatOfChord && nextChord) {
        // 3. 1小節2コードのときは、アプローチ音を毎回入れない。確率で入れて、
        // 残りはコードトーン(docs/FEEDBACK_01.md §1決定事項3)。1コードが1小節
        // 丸ごと(beatsInChord!==2)のときは、これまでどおり必ずアプローチにする。
        const useApproach = beatsInChord !== 2 || Math.random() < BASS.twoChordBarApproachProbability
        midi = useApproach
          ? pickApproachNote(nextChord, anchor, previousMidi, line)
          : pickMiddleNote(chord, anchor, previousMidi, line, directionSign, directionRun, true)
      } else if (beatInChord === 0) {
        // 6. コーラスの1小節目の1拍目(進行全体でchordIndex===0の頭)は
        // 確率1.0でルート。それ以外の小節頭は現行どおりheadRootWeight
        // (docs/FEEDBACK_01.md §1決定事項6)。
        const forceRoot = chordIndex === 0 && Math.random() < BASS.firstBeatOfChorusRootProbability
        midi = pickHeadNote(chord, anchor, previousMidi, line, forceRoot)
      } else {
        // 2. 3拍目(強拍。0始まりでbeatInChord===2)はコードトーン優先、
        // 2・4拍目(弱拍)はスケール音も可(docs/FEEDBACK_01.md §1決定事項2)。
        const isStrongBeat = beatInChord % 2 === 0
        midi = pickMiddleNote(chord, anchor, previousMidi, line, directionSign, directionRun, isStrongBeat)
      }

      line.push({ midi, startBeat: beatCursor, durationBeats: 1 })

      if (previousMidi !== null) {
        const diff = midi - previousMidi
        const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0
        if (sign !== 0 && sign === directionSign) directionRun += 1
        else if (sign !== 0) {
          directionSign = sign
          directionRun = 1
        }
      }
      previousMidi = midi
      beatCursor += 1
    }
  })

  return line
}
