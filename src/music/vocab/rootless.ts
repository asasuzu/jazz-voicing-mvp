import { buildAscendingIntervals, DEGREE_SEMITONES } from '../theory'
import type { ChordQuality, ParsedChord, Voicing } from '../types'

/**
 * Rootless系の語彙。「下部構造(左手=3度・7度中心のガイドトーン) × 上部構造(右手=色音)」
 * の掛け算で候補を作る(docs/DESIGN_v0.2.md §5.2, docs/IMPLEMENTATION_PLAN.md §3 Step2-9)。
 *
 * A/B のようなラベルより度数列そのものを正とする方針は VOICING_RESEARCH.md §2 を踏襲。
 */

interface QualityVocab {
  guideTones: string[]   // 左手の核。3度・7度(相当)を必ず含む(VOICING_RESEARCH.md §1, §5)
  tensionPool: string[]  // 右手用の色音。優先順に並べる
}

// tensionPoolの並びは「教材でよく使われる順」の決め打ち。thick密度で音数を確保するため
// 各4項目前後に揃えている(仕様書に無い判断)。
const QUALITY_VOCAB: Record<ChordQuality, QualityVocab> = {
  major: { guideTones: ['3', '6'], tensionPool: ['5', '9', '13', '3'] },
  major7: { guideTones: ['3', '7'], tensionPool: ['5', '9', '13', '#11'] },
  minor7: { guideTones: ['b3', 'b7'], tensionPool: ['5', '9', '11', '13'] },
  dominant7: { guideTones: ['3', 'b7'], tensionPool: ['9', '13', '5', '3'] },
  halfDiminished: { guideTones: ['b3', 'b7'], tensionPool: ['b5', '11', '9', 'b3'] },
  diminished7: { guideTones: ['b3', 'bb7'], tensionPool: ['b5', 'b3', 'bb7'] },
  minorMajor7: { guideTones: ['b3', '7'], tensionPool: ['5', '9', '13', 'b3'] },
  sus7: { guideTones: ['11', 'b7'], tensionPool: ['9', '13', '5', 'b7'] },
}

/** altやb9等のフラグが立っていたら、通常のtensionPoolより優先してこちらを使う */
function alteredTensionPool(chord: ParsedChord): string[] | null {
  if (chord.quality !== 'dominant7') return null
  const { alt, flat9, sharp9, sharp11, flat13 } = chord.flags
  if (!alt && !flat9 && !sharp9 && !sharp11 && !flat13) return null

  const ninths = alt ? ['b9', '#9'] : [sharp9 ? '#9' : flat9 ? 'b9' : '9']
  const upperTone = flat13 || alt ? 'b13' : sharp11 ? '#11' : '13'
  // '5'はフィラー。altered系はninths+upperToneだけだと2〜3音しか無く、
  // thick密度(5〜7音)の音数を確保できない場合があるため足した(仕様書に無い判断)。
  return [...ninths, upperTone, '5']
}

function possibleRootMidis(rootPc: number): number[] {
  const result: number[] = []
  for (let midi = rootPc; midi < 120; midi += 12) result.push(midi)
  return result
}

/** 度数列を、指定した音域にすべて収まる形でMIDI化する。収まる配置が無ければ空配列。 */
function placeInRange(degrees: string[], rootPc: number, range: { min: number; max: number }): number[][] {
  if (degrees.length === 0) return [[]]
  const intervals = buildAscendingIntervals(degrees)
  const results: number[][] = []
  possibleRootMidis(rootPc).forEach((rootMidi) => {
    const midi = intervals.map((interval) => rootMidi + interval)
    if (midi[0] >= range.min && midi[midi.length - 1] <= range.max) results.push(midi)
  })
  return results
}

function reversed<T>(items: T[]): T[] {
  return [...items].reverse()
}

/**
 * tensionPoolは「優先順」であって「音高順」ではない(例: dominant7は9thを13thより先に書く)。
 * そのままbuildAscendingIntervalsへ渡すと、順序によっては1オクターブ以上ジャンプして
 * 手の幅を超えてしまう。密集配置(音高の低い順)を基本形にし、ローテーションで
 * インバージョンのバリエーションを1つ追加する。
 */
function closePositionOrders(subset: string[]): string[][] {
  if (subset.length <= 1) return [subset]
  const sorted = [...subset].sort((a, b) => DEGREE_SEMITONES[a] - DEGREE_SEMITONES[b])
  const rotated = [...sorted.slice(1), sorted[0]]
  return [sorted, rotated]
}

export function buildRootlessVoicings(
  chord: ParsedChord,
  leftHandRange: { min: number; max: number },
  rightHandRange: { min: number; max: number },
  totalNotes: [number, number],
): Voicing[] {
  const vocab = QUALITY_VOCAB[chord.quality]
  const pool = alteredTensionPool(chord) ?? vocab.tensionPool
  const guideOrders = [vocab.guideTones, reversed(vocab.guideTones)]
  const maxRightSize = Math.min(4, pool.length) // PLAYABILITY.notesPerHandMaxと同じ意図の上限

  const results: Voicing[] = []

  guideOrders.forEach((guideDegrees, guideOrderIndex) => {
    const leftShapes = placeInRange(guideDegrees, chord.rootPc, leftHandRange)
    if (leftShapes.length === 0) return

    for (let rightSize = 0; rightSize <= maxRightSize; rightSize += 1) {
      const total = guideDegrees.length + rightSize
      if (total < totalNotes[0] || total > totalNotes[1]) continue

      const rightDegreeOrders = rightSize === 0 ? [[]] : closePositionOrders(pool.slice(0, rightSize))

      rightDegreeOrders.forEach((rightDegrees, rightOrderIndex) => {
        const rightShapes = placeInRange(rightDegrees, chord.rootPc, rightHandRange)

        leftShapes.forEach((left) => {
          rightShapes.forEach((right) => {
            results.push({
              family: `rootless-${guideOrderIndex}-${rightOrderIndex}`,
              label: rightSize === 0 ? 'Rootless shell' : 'Rootless',
              left,
              right,
              degrees: [...guideDegrees, ...rightDegrees],
            })
          })
        })
      })
    }
  })

  return results
}
