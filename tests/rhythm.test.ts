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
  it('ほとんどの小節が裏から始まる', () => {
    // 利用者の指摘:「このスタイルなら2裏、4裏だけでもいい(9.9割)」。
    // 以前は「コードが変わる位置に必ず発音を置く」の実装が効きすぎて、
    // 100%の小節が拍1から始まっていた。今は逆に、拍1から始まるほうが例外。
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
    expect(rate, `拍1から始まる小節が ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.05)
  })

  it('2裏と4裏だけの小節が9割を超える', () => {
    let offbeatOnly = 0
    let total = 0
    for (let i = 0; i < 100; i += 1) {
      const hits = generateComping(chords, 'thick', 50, 4)
      for (let bar = 0; bar < 4; bar += 1) {
        total += 1
        const positions = hitsInBar(hits, bar)
          .map((hit) => Number((hit.startBeat - bar * 4).toFixed(2)))
          .sort((a, b) => a - b)
        if (positions.length === 2 && positions[0] === 1.5 && positions[1] === 3.5) offbeatOnly += 1
      }
    }
    const rate = offbeatOnly / total
    expect(rate, `2裏4裏だけの小節が ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.9)
  })
})

describe('食い込んだあとの拍1', () => {
  it('4裏で鳴らした直後に拍1を打たない', () => {
    // 利用者の指摘:「4裏から1頭でうつのは0.000001割ぐらいでいいです」
    ;[0, 50, 100].forEach((rhythmDensity) => {
      for (let i = 0; i < 100; i += 1) {
        const hits = generateComping(chords, 'thick', rhythmDensity, 4)
        for (let bar = 1; bar < 4; bar += 1) {
          const anticipated = hits.some((hit) => Math.abs(hit.startBeat - (bar * 4 - 0.5)) < 0.01)
          const downbeat = hitsInBar(hits, bar).some((hit) => Math.abs(hit.startBeat - bar * 4) < 0.01)
          expect(anticipated && downbeat, `${bar}小節目: 4裏の直後に拍1を打っている`).toBe(false)
        }
      }
    })
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

describe('先取り', () => {
  it('4裏は次の小節のコードを鳴らす', () => {
    // 利用者の指定:「全部先取り」
    let anticipated = 0
    let changes = 0

    for (let i = 0; i < 100; i += 1) {
      const hits = generateComping(chords, 'thick', 50, 4)
      for (let bar = 1; bar < 4; bar += 1) {
        changes += 1
        const atOffbeat = hits.find((hit) => Math.abs(hit.startBeat - (bar * 4 - 0.5)) < 0.01)
        if (atOffbeat && atOffbeat.chordIndex === bar) anticipated += 1
      }
    }

    const rate = anticipated / changes
    expect(rate, `先取りされたコードチェンジが ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.9)
  })

  it('1小節に2コードあるとき、2裏は3拍目のコードを先取りする', () => {
    const twoChordBar = parseProgression('Dm7 G7 | Cmaj7', 4)
    for (let i = 0; i < 50; i += 1) {
      const hits = generateComping(twoChordBar, 'thick', 50, 4)
      const atOffbeat = hits.find((hit) => Math.abs(hit.startBeat - 1.5) < 0.01)
      if (!atOffbeat) continue
      // 1.5拍の半拍後(2拍)からG7が始まるので、そこはG7になる
      expect(atOffbeat.chordIndex, '2拍裏がG7を先取りしていない').toBe(1)
    }
  })

  it('最後の小節の4裏は、次の周の1小節目を先取りする', () => {
    // 利用者の指摘:「4小節目から1小節目のときに先取りできてない」。
    // 進行は繰り返す前提なので、ここも他の小節と同じように先取りする。
    let anticipated = 0
    let total = 0
    for (let i = 0; i < 100; i += 1) {
      const hits = generateComping(chords, 'thick', 50, 4)
      const atSeam = hits.find((hit) => Math.abs(hit.startBeat - 15.5) < 0.01)
      if (!atSeam) continue
      total += 1
      if (atSeam.chordIndex === 0) anticipated += 1
    }
    expect(total).toBeGreaterThan(50)
    const rate = anticipated / total
    expect(rate, `継ぎ目の先取りが ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.9)
  })
})
