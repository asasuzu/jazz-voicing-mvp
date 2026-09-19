import { offsetToDegreeName, placeInRange } from './placement'
import type { Range } from './placement'
import type { ChordQuality, ParsedChord, Voicing } from '../types'

/**
 * Upper Structure Triad（アッパー・ストラクチャー・トライアド）。
 * 左手に3度と7度（ドミナントでは三全音）、右手にトライアドを置く。
 *
 * ドミナントの表は The Jazz Piano Site の Upper Structures の記載どおり:
 * https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/upper-structures/
 * major7 / minor7 の分は同ページに記載が無いため、コードスケール上で
 * 破綻しないものをこちらで選んだ（VOICING_RESEARCH.md §9 に根拠を書いた）。
 */

interface UpperStructure {
  id: string
  /** トライアドの根音の、コードルートからの半音距離 */
  offset: number
  quality: 'major' | 'minor'
  /** 画面表示用。どのテンションが鳴るか */
  tensions: string
}

/** トライアドの構成音（根音からの半音） */
const TRIAD_INTERVALS: Record<'major' | 'minor', number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
}

// US Im (1 #9 5) は出典の表にあるが外している。ベースがルートを弾く前提だと
// ルートの重複とナチュラル5度を足すだけで、増える色は#9のみ。
// 利用者いわく「ドミナントで5thはかなり使わん」(docs/MUSICAL_RULES.md)。
const DOMINANT_STRUCTURES: UpperStructure[] = [
  { id: 'US-II', offset: 2, quality: 'major', tensions: '9 #11 13' },
  { id: 'US-bIII', offset: 3, quality: 'major', tensions: '#9 5 b7' },
  { id: 'US-bV', offset: 6, quality: 'major', tensions: 'b9 #11 b7' },
  { id: 'US-bVI', offset: 8, quality: 'major', tensions: 'b13 1 #9' },
  { id: 'US-VI', offset: 9, quality: 'major', tensions: '13 b9 3' },
  { id: 'US-bIIm', offset: 1, quality: 'minor', tensions: 'b9 3 b13' },
  { id: 'US-bIIIm', offset: 3, quality: 'minor', tensions: '#9 #11 b7' },
  { id: 'US-#IVm', offset: 6, quality: 'minor', tensions: '#11 13 b9' },
]

// major7 / minor7 は出典の表に無いので、コードスケール(Ionian / Dorian)の中に
// 収まるものだけを選んだ。外の音を足すと「別のコード」になってしまうため。
// テンションを足さない(コードそのものになる)組み合わせは、音を重ねるだけで
// 色が増えないので入れない。US-iiim(3-5-7) と US-bIII(b3-5-b7) がそれに当たる。
const MAJOR7_STRUCTURES: UpperStructure[] = [
  { id: 'US-II', offset: 2, quality: 'major', tensions: '9 #11 13' },
  { id: 'US-V', offset: 7, quality: 'major', tensions: '5 7 9' },
]

const MINOR7_STRUCTURES: UpperStructure[] = [
  { id: 'US-IV', offset: 5, quality: 'major', tensions: '11 13 1' },
  { id: 'US-vm', offset: 7, quality: 'minor', tensions: '5 b7 9' },
]

/** 左手のガイドトーン（3度と7度）。ドミナントではこの2音が三全音になる。 */
const GUIDE_TONES: Partial<Record<ChordQuality, string[]>> = {
  dominant7: ['3', 'b7'],
  major7: ['3', '7'],
  minor7: ['b3', 'b7'],
}

function structuresFor(chord: ParsedChord): UpperStructure[] {
  if (chord.quality === 'dominant7') {
    const { alt, flat9, sharp9, sharp11, flat13 } = chord.flags
    // 記号でテンションが指定されている場合は、それを含むものだけに絞る。
    // 指定を無視したUSTを出すと、書かれたコードと違う響きになる。
    // altはオルタードスケール(b9 #9 #11 b13)なので、ナチュラルの5度・9度・13度を
    // 含むUSTは除く。「b9と#11を含む」だけで絞ると、US #IVm のように
    // ナチュラル13度を持つものが通ってしまい、altの響きにならない。
    if (alt) {
      return DOMINANT_STRUCTURES.filter((s) => {
        const tones = s.tensions.split(' ')
        if (tones.some((tone) => tone === '5' || tone === '9' || tone === '13')) return false
        return tones.some((tone) => tone === 'b9' || tone === '#9')
      })
    }
    if (flat9) return DOMINANT_STRUCTURES.filter((s) => s.tensions.includes('b9'))
    if (sharp9) return DOMINANT_STRUCTURES.filter((s) => s.tensions.includes('#9'))
    if (sharp11) return DOMINANT_STRUCTURES.filter((s) => s.tensions.includes('#11'))
    if (flat13) return DOMINANT_STRUCTURES.filter((s) => s.tensions.includes('b13'))
    return DOMINANT_STRUCTURES
  }
  if (chord.quality === 'major7') return MAJOR7_STRUCTURES
  if (chord.quality === 'minor7') return MINOR7_STRUCTURES
  return []
}

export function buildUpperStructureVoicings(
  chord: ParsedChord,
  leftHandRange: Range,
  rightHandRange: Range,
): Voicing[] {
  const guide = GUIDE_TONES[chord.quality]
  if (!guide) return []

  const leftShapes = placeInRange(guide, chord.rootPc, leftHandRange)
  if (leftShapes.length === 0) return []

  const results: Voicing[] = []

  structuresFor(chord).forEach((structure) => {
    const triadRootPc = (chord.rootPc + structure.offset) % 12
    const triadPcs = TRIAD_INTERVALS[structure.quality].map((interval) => (triadRootPc + interval) % 12)

    // 転回形は「どの構成音を最低音にするか」で作る。根音を最低音に固定したまま
    // 音程だけ回すと、まったく別のトライアドになってしまう。
    for (let inversion = 0; inversion < triadPcs.length; inversion += 1) {
      const order = triadPcs.map((_, index) => triadPcs[(index + inversion) % triadPcs.length])

      for (let bottom = rightHandRange.min; bottom <= rightHandRange.max; bottom += 1) {
        if (bottom % 12 !== order[0]) continue

        const midi = [bottom]
        order.slice(1).forEach((pc) => {
          const previous = midi[midi.length - 1]
          let note = previous + (((pc - (previous % 12)) + 12) % 12)
          if (note === previous) note += 12
          midi.push(note)
        })
        if (midi[midi.length - 1] > rightHandRange.max) continue

        leftShapes.forEach((left) => {
          // 度数表示は実際の音から作る。構造の定義から書き写すと、転回した
          // ときに表示と鳴っている音がずれる。
          const degrees = [...left, ...midi].map((note) =>
            offsetToDegreeName(((note % 12) - chord.rootPc + 12) % 12),
          )
          results.push({
            family: `ust-${structure.id}`,
            label: `UST ${structure.id.replace('US-', '')}`,
            left,
            right: midi,
            degrees,
          })
        })
      }
    }
  })

  return results
}
