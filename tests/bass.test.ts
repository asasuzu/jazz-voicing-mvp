import { describe, expect, it } from 'vitest'
import { generateBassLine } from '../src/music/bass'
import { parseProgression } from '../src/music/theory'
import { RANGES } from '../src/music/constants'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §6 */

const chords = parseProgression('Dm7 G7 | Cmaj7 | A7alt | Dm7 G7', 4)

describe('ウォーキングベース', () => {
  it('1拍1音', () => {
    const line = generateBassLine(chords, 4)
    const totalBeats = chords.reduce((sum, c) => sum + c.beats, 0)
    expect(line.length).toBe(totalBeats)
    line.forEach((note) => expect(note.durationBeats).toBeCloseTo(1, 5))
  })

  it('拍の位置が0から1ずつ並ぶ', () => {
    const line = generateBassLine(chords, 4)
    line.forEach((note, i) => expect(note.startBeat).toBeCloseTo(i, 5))
  })

  it('音域に収まる', () => {
    for (let i = 0; i < 20; i += 1) {
      generateBassLine(chords, 4).forEach((note) => {
        expect(note.midi).toBeGreaterThanOrEqual(RANGES.bass.min)
        expect(note.midi).toBeLessThanOrEqual(RANGES.bass.max)
      })
    }
  })

  it('同じ音が3回以上続かない', () => {
    for (let i = 0; i < 20; i += 1) {
      const line = generateBassLine(chords, 4)
      for (let j = 2; j < line.length; j += 1) {
        const same = line[j].midi === line[j - 1].midi && line[j - 1].midi === line[j - 2].midi
        expect(same).toBe(false)
      }
    }
  })

  it('コードの頭はだいたいルート', () => {
    let rootHits = 0
    let starts = 0
    for (let run = 0; run < 30; run += 1) {
      const line = generateBassLine(chords, 4)
      let beat = 0
      chords.forEach((chord) => {
        const note = line.find((n) => Math.abs(n.startBeat - beat) < 0.01)
        if (note) {
          starts += 1
          if (note.midi % 12 === chord.rootPc) rootHits += 1
        }
        beat += chord.beats
      })
    }
    // 仕様では 0.8。乱数なので幅を持たせる
    expect(rootHits / starts).toBeGreaterThan(0.6)
  })

  it('次のコードへ向かう最後の拍は、次のルートへ2半音以内', () => {
    let close = 0
    let checked = 0
    for (let run = 0; run < 20; run += 1) {
      const line = generateBassLine(chords, 4)
      let beat = 0
      chords.forEach((chord, index) => {
        beat += chord.beats
        const next = chords[index + 1]
        if (!next) return
        const approach = line.find((n) => Math.abs(n.startBeat - (beat - 1)) < 0.01)
        const target = line.find((n) => Math.abs(n.startBeat - beat) < 0.01)
        if (!approach || !target) return
        checked += 1
        if (Math.abs(approach.midi - target.midi) <= 2) close += 1
      })
    }
    expect(close / checked).toBeGreaterThan(0.7)
  })
})
