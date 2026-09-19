import { describe, expect, it } from 'vitest'
import { generateComping } from '../src/music/comping'
import { parseProgression } from '../src/music/theory'

/**
 * コンピングのリズム。利用者の指摘:
 * 「全音符が2回続くのとかやめてほしい(裏から入ってたらまだまし)」
 */

const PROGRESSION = 'Cmaj7 | A7alt | Dm7 | G7'
const chords = parseProgression(PROGRESSION, 4)
const TWO_CHORD_BARS = parseProgression('Dm7 G7 | Cmaj7 | Em7 A7 | Dm7 G7', 4)

const hitsInBar = (hits: ReturnType<typeof generateComping>, bar: number) =>
  hits.filter((hit) => hit.startBeat >= bar * 4 && hit.startBeat < (bar + 1) * 4)

const isDownbeatSustain = (hits: ReturnType<typeof generateComping>, bar: number) => {
  const inBar = hitsInBar(hits, bar)
  return (
    inBar.length === 1 &&
    Math.abs(inBar[0].startBeat - bar * 4) < 0.01 &&
    inBar[0].durationBeats >= 2.8
  )
}

describe('全音符の連続', () => {
  it('拍1から伸ばすだけの小節が2回続かない', () => {
    for (let i = 0; i < 200; i += 1) {
      const hits = generateComping(chords, 'thick', 50, 4)
      for (let bar = 1; bar < 4; bar += 1) {
        expect(
          isDownbeatSustain(hits, bar) && isDownbeatSustain(hits, bar - 1),
          `${bar}小節目と${bar - 1}小節目が両方とも拍1からの全音符`,
        ).toBe(false)
      }
    }
  })
})

describe('小節の入り方', () => {
  it('すべての小節が拍1から始まるわけではない', () => {
    // 以前は「コードが変わる位置に必ず発音を置く」の実装が効きすぎて、
    // 100%の小節が拍1から始まっていた(Offbeatも Push も Rest も全部潰れていた)。
    let withDownbeat = 0
    let total = 0
    for (let i = 0; i < 100; i += 1) {
      const hits = generateComping(chords, 'thick', 50, 4)
      for (let bar = 0; bar < 4; bar += 1) {
        total += 1
        if (hitsInBar(hits, bar).some((hit) => Math.abs(hit.startBeat - bar * 4) < 0.01)) {
          withDownbeat += 1
        }
      }
    }
    const rate = withDownbeat / total
    expect(rate, `拍1から始まる小節が ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.8)
    expect(rate).toBeGreaterThan(0.2) // 逆に裏ばかりになっても不自然
  })
})

describe('同時発音', () => {
  it('同じ瞬間に別のコードが鳴らない', () => {
    // 前の小節の4拍裏と、次の小節への食い込みは同じ位置になる。
    ;[chords, TWO_CHORD_BARS].forEach((progression) => {
      for (let i = 0; i < 100; i += 1) {
        const hits = generateComping(progression, 'thick', 50, 4)
        for (let j = 1; j < hits.length; j += 1) {
          const sameMoment = Math.abs(hits[j].startBeat - hits[j - 1].startBeat) < 0.01
          expect(
            sameMoment && hits[j].chordIndex !== hits[j - 1].chordIndex,
            `拍${hits[j].startBeat}で別のコードが同時に鳴っている`,
          ).toBe(false)
        }
      }
    })
  })
})

describe('鳴り漏れ', () => {
  it('どのコードも最低1回は鳴る', () => {
    // リズムを間引いた結果、あるコードが一度も鳴らないまま終わってはいけない。
    ;[chords, TWO_CHORD_BARS].forEach((progression) => {
      for (let i = 0; i < 100; i += 1) {
        const hits = generateComping(progression, 'thick', 50, 4)
        const sounded = new Set(hits.map((hit) => hit.chordIndex))
        progression.forEach((_, index) => {
          expect(sounded.has(index), `${index}番目のコードが一度も鳴っていない`).toBe(true)
        })
      }
    })
  })
})
