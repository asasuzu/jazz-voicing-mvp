import { describe, expect, it } from 'vitest'
import { generateTakes } from '../src/music/take'
import type { Voicing } from '../src/music/types'

/**
 * 利用者から指摘のあったボイスリーディングの規則を固定する。
 *
 * ここに書いてあるのは「好み」ではなく、名前のある規則(共通音の保持、
 * ドミナントの5度より13度)。一度書けば、以後は口頭で言い直す必要が無い。
 * 新しい指摘が来たらここにケースを足す。
 */

const pcs = (voicing: Voicing) => new Set([...voicing.left, ...voicing.right].map((midi) => midi % 12))

const RANDOMNESS_LEVELS = [0, 0.38, 0.7, 1]

describe('ii-V の9度', () => {
  it('Dm7の9th(E)が、G7の5th(D)へ落ちない', () => {
    // 指摘: 「9th(実音E)が5th(実音D)にいくのが変。G7側を13th(実音E)もしくは
    // b13th(実音Eb)にして」
    //
    // ランダム性は色を変えるためのもので、規則を壊すためのものではないので、
    // randomnessを上げても破れないことを確認する。
    RANDOMNESS_LEVELS.forEach((randomness) => {
      for (let i = 0; i < 40; i += 1) {
        const [take] = generateTakes('Dm7 | G7', {
          density: 'thick',
          randomness,
          topLineWeight: 0.6,
          beatsPerBar: 4,
          withBass: true,
        })
        const [dm7, g7] = take.voicings
        if (!pcs(dm7).has(4)) continue // Dm7に9th(E)が無い回は対象外

        const g = pcs(g7)
        const hasNaturalFifth = g.has(2) // D
        const hasThirteenth = g.has(4) // E
        const hasFlatThirteenth = g.has(3) // Eb

        expect(
          hasNaturalFifth && !hasThirteenth && !hasFlatThirteenth,
          `randomness=${randomness}: G7が5th(D)を持つのに13thもb13thも無い`,
        ).toBe(false)
      }
    })
  })
})

describe('ドミナントの5度', () => {
  it('前のコードに保持できる音があるときだけ、5度への逃げを禁止する', () => {
    // 規則は文脈つき。単体のドミナントでは UST bIII のように
    // ナチュラル5度を含む形も使えるので、そこまでは禁止しない。
    ;['Am7 | D7', 'Em7 | A7', 'Gm7 | C7'].forEach((progression) => {
      for (let i = 0; i < 20; i += 1) {
        const [take] = generateTakes(progression, {
          density: 'thick',
          randomness: 1,
          topLineWeight: 0.6,
          beatsPerBar: 4,
          withBass: true,
        })
        const [previous, dominant] = take.voicings
        const rootPc = take.chords[1].rootPc
        const offsets = new Set(
          [...dominant.left, ...dominant.right].map((midi) => ((midi % 12) - rootPc + 12) % 12),
        )
        if (!offsets.has(7)) continue // ナチュラル5度が無ければ対象外
        if (offsets.has(9) || offsets.has(8)) continue // 13th か b13th があるなら良い

        // ここまで来たら「5度はあるが13thもb13thも無い」。
        // 前のコードにその音が鳴っていなかったはず(鳴っていたら規則違反)。
        const previousPcs = new Set(
          [...previous.left, ...previous.right].map((midi) => midi % 12),
        )
        const couldHaveHeld =
          previousPcs.has((rootPc + 9) % 12) || previousPcs.has((rootPc + 8) % 12)
        expect(
          couldHaveHeld,
          `${progression}: 保持できる音があったのに5度へ逃げている`,
        ).toBe(false)
      }
    })
  })
})

describe('ドミナントのナチュラル5度', () => {
  it('ほとんど使われない', () => {
    // 利用者いわく「ドミナントで5thはかなり使わん。てのが、ルールかなとても雑に言えば」
    // 「絶対に使わない」ではないので、率で見張る。対応前は49.3%だった。
    let total = 0
    let withFifth = 0

    for (let i = 0; i < 60; i += 1) {
      const [take] = generateTakes('G7 | C7 | A7 | Bb7 | Dm7 G7', {
        density: 'thick',
        randomness: 0.38,
        topLineWeight: 0.6,
        beatsPerBar: 4,
        withBass: true,
      })
      take.voicings.forEach((voicing, index) => {
        const chord = take.chords[index]
        if (chord.quality !== 'dominant7') return
        const offsets = new Set(
          [...voicing.left, ...voicing.right].map((midi) => ((midi % 12) - chord.rootPc + 12) % 12),
        )
        total += 1
        if (offsets.has(7)) withFifth += 1
      })
    }

    const rate = withFifth / total
    expect(rate, `ナチュラル5度の率が ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.15)
  })
})

describe('候補の多様性', () => {
  it('規則を足しても、語彙が1〜2種類に痩せない', () => {
    // 規則を強くしすぎると候補が消えて「毎回同じ」になる。そこを見張る。
    const labels = new Set<string>()
    for (let i = 0; i < 30; i += 1) {
      const [take] = generateTakes('Cmaj7 | A7alt | Dm7 | G7', {
        density: 'thick',
        randomness: 0.38,
        topLineWeight: 0.6,
        beatsPerBar: 4,
        withBass: true,
      })
      take.voicings.forEach((voicing) => labels.add(voicing.label))
    }
    expect(labels.size).toBeGreaterThanOrEqual(4)
  })
})
