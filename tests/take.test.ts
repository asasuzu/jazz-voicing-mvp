import { describe, expect, it } from 'vitest'
import { generateTakes } from '../src/music/take'
import { DENSITY } from '../src/music/constants'
import type { DensityPreset } from '../src/music/types'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §5 */

const PROGRESSION = 'Dm7 G7 | Cmaj7 | A7alt | Dm7 G7'

const options = (overrides: Record<string, unknown> = {}) => ({
  density: 'thick' as DensityPreset,
  randomness: 0,
  topLineWeight: 0.6,
  beatsPerBar: 4,
  withBass: true,
  ...overrides,
})

describe('テイク生成', () => {
  it('全部のコードにボイシングが付く', () => {
    const [take] = generateTakes(PROGRESSION, options())
    expect(take.voicings.length).toBe(take.chords.length)
    expect(take.chords.length).toBe(6)
  })

  it('randomness=0 なら決定的', () => {
    const a = generateTakes(PROGRESSION, options())[0]
    const b = generateTakes(PROGRESSION, options())[0]
    expect(a.voicings.map((v) => [...v.left, ...v.right])).toEqual(
      b.voicings.map((v) => [...v.left, ...v.right]),
    )
  })

  it('randomness=1 なら複数テイクが出る', () => {
    const takes = generateTakes(PROGRESSION, options({ randomness: 1 }))
    expect(takes.length).toBeGreaterThan(1)
  })
})

describe('density プリセット', () => {
  const cases: DensityPreset[] = ['powell', 'shell3', 'standard', 'thick']

  cases.forEach((density) => {
    it(`${density}: 音数が仕様の範囲に収まる`, () => {
      const [take] = generateTakes(PROGRESSION, options({ density }))
      const [min, max] = DENSITY[density].totalNotes
      take.voicings.forEach((v) => {
        const count = v.left.length + v.right.length
        expect(count).toBeGreaterThanOrEqual(min)
        expect(count).toBeLessThanOrEqual(max)
      })
    })
  })

  it('powell は右手を使わない', () => {
    const [take] = generateTakes(PROGRESSION, options({ density: 'powell' }))
    take.voicings.forEach((v) => expect(v.right).toEqual([]))
  })

  it('powell はルートが最低音', () => {
    const [take] = generateTakes(PROGRESSION, options({ density: 'powell' }))
    take.voicings.forEach((v, i) => {
      expect(v.left[0] % 12).toBe(take.chords[i].rootPc)
    })
  })

  it('thick はベースありなら基本 rootless', () => {
    const [take] = generateTakes(PROGRESSION, options({ density: 'thick' }))
    const withRootAtBottom = take.voicings.filter(
      (v, i) => v.left[0] % 12 === take.chords[i].rootPc,
    )
    expect(withRootAtBottom.length).toBeLessThan(take.voicings.length)
  })
})
