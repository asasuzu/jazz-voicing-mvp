import { describe, expect, it } from 'vitest'
import { PROGRESSION_PRESETS } from '../src/music/presets'
import { generateTakes } from '../src/music/take'
import { generateVoicingsForChord } from '../src/music/voicings'
import { parseChordSymbol, parseProgression } from '../src/music/theory'
import type { DensityPreset } from '../src/music/types'

describe('6thコードの判定', () => {
  // 以前は「どれにも当たらなければdominant7」に落ちて、C6がC7として鳴っていた
  it('C6 はドミナントではなくメジャー', () => {
    expect(parseChordSymbol('C6').quality).toBe('major')
    expect(parseChordSymbol('C69').quality).toBe('major')
  })

  it('Cm6 はm7ではなくm6', () => {
    expect(parseChordSymbol('Cm6').quality).toBe('minor6')
    expect(parseChordSymbol('C-6').quality).toBe('minor6')
  })

  it('Cm6 のボイシングは b3 と 6 を持ち、7度を持たない', () => {
    const chord = parseChordSymbol('Cm6')
    const densities: DensityPreset[] = ['powell', 'shell3', 'standard', 'thick']
    densities.forEach((density) => {
      const voicings = generateVoicingsForChord(chord, { density, withBass: true })
      expect(voicings.length, `${density} で候補が無い`).toBeGreaterThan(0)
      voicings.forEach((voicing) => {
        const pcs = new Set([...voicing.left, ...voicing.right].map((midi) => midi % 12))
        expect(pcs.has(10), `${density} / ${voicing.label} に b7(Bb) がある`).toBe(false)
        expect(pcs.has(11), `${density} / ${voicing.label} に 長7度(B) がある`).toBe(false)
        if (density === 'standard' || density === 'thick') {
          expect(pcs.has(3) && pcs.has(9), `${density} / ${voicing.label} に b3 と 6 が揃っていない`).toBe(true)
        }
      })
    })
  })
})

describe('プリセット', () => {
  PROGRESSION_PRESETS.forEach((preset) => {
    it(`${preset.name}: どの厚さでもテイクが作れる`, () => {
      const densities: DensityPreset[] = ['powell', 'shell3', 'standard', 'thick']
      densities.forEach((density) => {
        const [take] = generateTakes(preset.progression, {
          density,
          randomness: 0.38,
          topLineWeight: 0.6,
          beatsPerBar: 4,
          withBass: true,
        })
        expect(take.voicings.length).toBe(parseProgression(preset.progression).length)
      })
    })

    it(`${preset.name}: ループで数えやすい小節数(4の倍数か12小節)`, () => {
      const bars = new Set(parseProgression(preset.progression).map((chord) => chord.barIndex)).size
      expect(bars % 4 === 0 || bars === 12).toBe(true)
    })
  })
})
