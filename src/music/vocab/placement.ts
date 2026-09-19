import { buildAscendingIntervals } from '../theory'

export interface Range {
  min: number
  max: number
}

function possibleRootMidis(rootPc: number): number[] {
  const result: number[] = []
  for (let midi = rootPc; midi < 120; midi += 12) result.push(midi)
  return result
}

/**
 * 度数列を、指定した音域にすべて収まる形でMIDI化する。収まる配置が無ければ空配列。
 * ルートのオクターブを総当たりするので、1つの度数列から複数の高さが出る。
 */
export function placeInRange(degrees: string[], rootPc: number, range: Range): number[][] {
  if (degrees.length === 0) return [[]]
  const intervals = buildAscendingIntervals(degrees)
  const results: number[][] = []
  possibleRootMidis(rootPc).forEach((rootMidi) => {
    const midi = intervals.map((interval) => rootMidi + interval)
    if (midi[0] >= range.min && midi[midi.length - 1] <= range.max) results.push(midi)
  })
  return results
}

/**
 * 度数列全体を1つの積み上げとして配置してから、下からsplitAt個を左手に割り当てる。
 * Quartalのように「積み上げ方が決まっていて、どこで手を分けるか」という語彙で使う。
 * 左右を別々に配置すると積み上げの間隔が壊れるので、分けるのは配置の後。
 */
export function placeAndSplit(
  degrees: string[],
  rootPc: number,
  splitAt: number,
  overall: Range,
): { left: number[]; right: number[] }[] {
  return placeInRange(degrees, rootPc, overall).map((midi) => ({
    left: midi.slice(0, splitAt),
    right: midi.slice(splitAt),
  }))
}

/** サイズkの組み合わせをすべて返す(順序は元の並びを保つ) */
export function combinations<T>(items: T[], k: number): T[][] {
  if (k <= 0) return [[]]
  if (k > items.length) return []
  const result: T[][] = []
  const walk = (start: number, current: T[]) => {
    if (current.length === k) {
      result.push([...current])
      return
    }
    for (let i = start; i < items.length; i += 1) {
      current.push(items[i])
      walk(i + 1, current)
      current.pop()
    }
  }
  walk(0, [])
  return result
}

/**
 * 度数名ではなく、ルートからの半音距離で直接配置する。
 * Quartalのようにスケールから積み上げる語彙は、度数名を経由すると
 * 綴り直しが挟まって積み上げの間隔が壊れるので、こちらを使う。
 */
export function placeOffsets(offsets: number[], rootPc: number, range: Range): number[][] {
  if (offsets.length === 0) return [[]]
  const results: number[][] = []
  possibleRootMidis(rootPc).forEach((rootMidi) => {
    const midi = offsets.map((offset) => rootMidi + offset)
    if (midi[0] >= range.min && midi[midi.length - 1] <= range.max) results.push(midi)
  })
  return results
}

/** 半音距離を度数名へ戻す(表示用)。オクターブは畳む。 */
const OFFSET_NAMES = ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7']

export function offsetToDegreeName(offset: number): string {
  return OFFSET_NAMES[((offset % 12) + 12) % 12]
}
