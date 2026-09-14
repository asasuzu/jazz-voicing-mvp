import { BASS, BASS_ALTERED_SCALE, BASS_CHORD_TONES, BASS_SCALES, RANGES } from './constants'
import type { ParsedChord } from './types'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §6 */
export interface BassNote {
  midi: number
  startBeat: number
  durationBeats: number
}

const BASS_CENTER = (RANGES.bass.min + RANGES.bass.max) / 2

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

/** オクターブは前の音(なければ音域中央)に最も近いものを選ぶ(仕様書§6) */
function closestMidi(pc: number, anchor: number): number {
  const options = midisForPc(pc)
  return options.reduce((best, candidate) =>
    Math.abs(candidate - anchor) < Math.abs(best - anchor) ? candidate : best,
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

function pickHeadNote(chord: ParsedChord, anchor: number, previousMidi: number | null, line: BassNote[]): number {
  const tones = BASS_CHORD_TONES[chord.quality]
  const pcs = [chord.rootPc, wrapPc(chord.rootPc + tones.fifth), wrapPc(chord.rootPc + tones.third)]
  const weights = [BASS.headRootWeight, BASS.headFifthWeight, BASS.headThirdWeight]
  return pickFromOrder(weightedShuffle(pcs, weights), anchor, previousMidi, line)
}

function pickMiddleNote(
  chord: ParsedChord,
  anchor: number,
  previousMidi: number | null,
  line: BassNote[],
  directionSign: number,
  directionRun: number,
): number {
  const tones = BASS_CHORD_TONES[chord.quality]
  const chordToneOffsets = [0, tones.third, tones.fifth, tones.seventh].filter(
    (value): value is number => value !== null,
  )
  const pcs = Array.from(new Set([...chordToneOffsets, ...scaleFor(chord)])).map((offset) =>
    wrapPc(chord.rootPc + offset),
  )

  // 直前の音からの距離で並べ、近い(2半音以内が理想)ものほど選ばれやすくする。
  const ranked = pcs
    .map((pc) => ({ pc, midi: closestMidi(pc, anchor) }))
    .sort((a, b) => Math.abs(a.midi - anchor) - Math.abs(b.midi - anchor))

  // 同方向が5音以上続いていたら、逆方向に動く候補を優先する。
  const reversed = ranked.filter((candidate) => {
    if (directionRun < BASS.directionReversalRun) return true
    const diff = candidate.midi - anchor
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0
    return sign !== directionSign
  })
  const pool = reversed.length > 0 ? reversed : ranked

  // 距離が近いほど重みが大きくなるようにして抽選する(仕様に数式は無いので決め打ち)。
  const order = weightedShuffle(
    pool.map((candidate) => candidate.pc),
    pool.map((_, index) => 1 / (index + 1)),
  )
  return pickFromOrder(order, anchor, previousMidi, line)
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
  return pickFromOrder(weightedShuffle(pcs, weights), anchor, previousMidi, line)
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
        midi = pickApproachNote(nextChord, anchor, previousMidi, line)
      } else if (beatInChord === 0) {
        midi = pickHeadNote(chord, anchor, previousMidi, line)
      } else {
        midi = pickMiddleNote(chord, anchor, previousMidi, line, directionSign, directionRun)
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
