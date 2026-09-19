import { describe, expect, it } from 'vitest'
import { generateVoicingsForChord } from '../src/music/voicings'
import { generateTakes } from '../src/music/take'
import { DEGREE_SEMITONES, parseProgression, parseChordSymbol } from '../src/music/theory'
import { offsetToDegreeName } from '../src/music/vocab/placement'
import type { DensityPreset, Voicing } from '../src/music/types'

/**
 * 語彙の拡張(docs/FEEDBACK_01.md §5)の回帰テスト。
 * 「G7の候補が1個しかない」状態に戻らないことと、増やした候補が
 * コードとして成立していることを見張る。
 */

const notes = (v: Voicing) => [...v.left, ...v.right]
const pcsRelativeToRoot = (v: Voicing, rootPc: number) =>
  new Set(notes(v).map((midi) => ((midi % 12) - rootPc + 12) % 12))

const PROGRESSION = 'Dm7 G7 | Cmaj7 | A7alt | G7sus4 | Cm7b5'
const chords = parseProgression(PROGRESSION, 4)

describe('候補数', () => {
  const densities: DensityPreset[] = ['standard', 'thick']

  densities.forEach((density) => {
    it(`${density}: どのコードでも候補が10個以上ある`, () => {
      chords.forEach((chord) => {
        const count = generateVoicingsForChord(chord, { density, withBass: true }).length
        expect(count, `${chord.symbol} の候補が ${count} 個しかない`).toBeGreaterThanOrEqual(10)
      })
    })
  })

  it('Powellは2音なので候補数は少なくてよいが、1個では困る', () => {
    chords.forEach((chord) => {
      expect(generateVoicingsForChord(chord, { density: 'powell', withBass: true }).length)
        .toBeGreaterThanOrEqual(2)
    })
  })
})

describe('コードとして成立しているか', () => {
  it('両手の候補は3度と7度(相当)を必ず含む', () => {
    // これが無いと、4度堆積が「音域には収まるがコードに聞こえない」候補を通してしまう。
    const required: Record<string, number[][]> = {
      minor7: [[3, 10]],
      dominant7: [[4, 10]],
      major7: [[4, 11], [4, 9]],
      sus7: [[5, 10]],
      halfDiminished: [[3, 10], [3, 6]],
    }
    chords.forEach((chord) => {
      const groups = required[chord.quality]
      if (!groups) return
      generateVoicingsForChord(chord, { density: 'thick', withBass: true }).forEach((voicing) => {
        const pcs = pcsRelativeToRoot(voicing, chord.rootPc)
        const ok = groups.some((group) => group.every((offset) => pcs.has(offset)))
        expect(ok, `${chord.symbol} / ${voicing.label} が3度と7度を持たない`).toBe(true)
      })
    })
  })

  it('度数の表示が実際の音と一致する', () => {
    // 転回形を作るときに表示だけ定義から書き写すと、鳴っている音とずれる。
    chords.forEach((chord) => {
      generateVoicingsForChord(chord, { density: 'thick', withBass: true }).forEach((voicing) => {
        expect(voicing.degrees.length).toBe(notes(voicing).length)
        notes(voicing).forEach((midi, index) => {
          const actualOffset = ((midi % 12) - chord.rootPc + 12) % 12
          const label = voicing.degrees[index]
          // 同じ音を別名で綴ることがある(ドミナントの#9とb3、b13と#5など)。
          // 綴りは語彙側のほうが適切なので、名前ではなく半音距離で一致を見る。
          const labelled = DEGREE_SEMITONES[label]
          expect(labelled, `${chord.symbol}: 未知の度数 ${label}`).toBeDefined()
          expect(
            labelled % 12,
            `${chord.symbol} / ${voicing.label}: ${index}番目の表示が ${label} だが、実際は ${offsetToDegreeName(actualOffset)}`,
          ).toBe(actualOffset)
        })
      })
    })
  })
})

describe('Upper Structure Triad', () => {
  it('C7 の UST bIII は Eb メジャートライアドになる', () => {
    // 出典: The Jazz Piano Site, Upper Structures
    const chord = parseChordSymbol('C7')
    const found = generateVoicingsForChord({ ...chord, beats: 4, barIndex: 0 }, {
      density: 'thick',
      withBass: true,
    }).filter((v) => v.family === 'ust-US-bIII')
    expect(found.length).toBeGreaterThan(0)
    found.forEach((voicing) => {
      const rightPcs = new Set(voicing.right.map((midi) => midi % 12))
      expect(rightPcs).toEqual(new Set([3, 7, 10])) // Eb, G, Bb
    })
  })
})

describe('オルタード・ドミナント', () => {
  it('altにナチュラルの5度と13度が入らない', () => {
    // altはオルタードスケール(b9 #9 #11 b13)。ナチュラル5度や13度が混ざると
    // altの響きにならない。音数を埋めるためのフィラーで混入しやすいので見張る。
    ;['A7alt', 'G7alt', 'Db7alt'].forEach((symbol) => {
      const [chord] = parseProgression(symbol, 4)
      const voicings = generateVoicingsForChord(chord, { density: 'thick', withBass: true })
      expect(voicings.length).toBeGreaterThanOrEqual(10)
      voicings.forEach((voicing) => {
        const pcs = pcsRelativeToRoot(voicing, chord.rootPc)
        expect(pcs.has(7), `${symbol} / ${voicing.label} にナチュラル5度`).toBe(false)
        expect(pcs.has(9), `${symbol} / ${voicing.label} にナチュラル13度`).toBe(false)
      })
    })
  })
})

describe('Powell', () => {
  it('マイナー7thに6度が入らない', () => {
    // Dm7 に R6 を当てると D+B になり、Dm6 の響きになってしまう
    for (let i = 0; i < 20; i += 1) {
      const [take] = generateTakes('Dm7 | Am7 | Em7', {
        density: 'powell', randomness: 0.8, topLineWeight: 0.6, beatsPerBar: 4, withBass: true,
      })
      take.voicings.forEach((voicing, index) => {
        const pcs = pcsRelativeToRoot(voicing, take.chords[index].rootPc)
        expect(pcs.has(9), `${take.chords[index].symbol} に6度が入っている`).toBe(false)
      })
    }
  })

  it('7度と10度が、3度と6度より多く使われる', () => {
    // 利用者の要望「7度と10度をめっちゃ使うようにしてほしい」
    const counts: Record<string, number> = {}
    for (let i = 0; i < 40; i += 1) {
      const [take] = generateTakes('Dm7 G7 | Cmaj7 | A7alt', {
        density: 'powell', randomness: 0.5, topLineWeight: 0.6, beatsPerBar: 4, withBass: true,
      })
      take.voicings.forEach((v) => {
        counts[v.family] = (counts[v.family] ?? 0) + 1
      })
    }
    const wide = (counts['powell-r7'] ?? 0) + (counts['powell-r10'] ?? 0)
    const narrow = (counts['powell-r3'] ?? 0) + (counts['powell-r6'] ?? 0)
    expect(wide).toBeGreaterThan(narrow)
  })
})
