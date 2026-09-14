import { describe, expect, it } from 'vitest'
import { createMidiFile } from '../src/music/render/midi'
import { buildPerformance } from '../src/music/perform'
import { generateTakes } from '../src/music/take'
import { TICKS_PER_QUARTER } from '../src/music/constants'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §9 */

const options = {
  density: 'thick' as const,
  randomness: 0,
  topLineWeight: 0.6,
  beatsPerBar: 4,
  withBass: true,
}

function build(withBass = true) {
  const [take] = generateTakes('Dm7 G7 | Cmaj7', { ...options, withBass })
  return buildPerformance(take, {
    tempo: 180,
    beatsPerBar: 4,
    withBass,
    strict: true,
    swing: 'auto' as const,
    density: 'thick' as const,
    choruses: 1,
  })
}

function readChunks(bytes: Uint8Array): { id: string; length: number; start: number }[] {
  const chunks: { id: string; length: number; start: number }[] = []
  let cursor = 0
  while (cursor < bytes.length) {
    const id = String.fromCharCode(...bytes.slice(cursor, cursor + 4))
    const length =
      (bytes[cursor + 4] << 24) | (bytes[cursor + 5] << 16) | (bytes[cursor + 6] << 8) | bytes[cursor + 7]
    chunks.push({ id, length, start: cursor + 8 })
    cursor += 8 + length
  }
  return chunks
}

describe('SMF ヘッダ', () => {
  it('MThd で始まる', () => {
    const bytes = createMidiFile(build(), 180)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
  })

  it('format 1', () => {
    const bytes = createMidiFile(build(), 180)
    expect((bytes[8] << 8) | bytes[9]).toBe(1)
  })

  it('ベースありならトラック3つ', () => {
    const bytes = createMidiFile(build(true), 180)
    expect((bytes[10] << 8) | bytes[11]).toBe(3)
  })

  it('ベースなしならトラック2つ', () => {
    const bytes = createMidiFile(build(false), 180)
    expect((bytes[10] << 8) | bytes[11]).toBe(2)
  })

  it('division は 480', () => {
    const bytes = createMidiFile(build(), 180)
    expect((bytes[12] << 8) | bytes[13]).toBe(TICKS_PER_QUARTER)
  })
})

describe('チャンク構造', () => {
  it('宣言された長さとトラックの実体が一致する（ここがズレると DAW が読めない）', () => {
    const bytes = createMidiFile(build(), 180)
    const chunks = readChunks(bytes)
    expect(chunks[0].id).toBe('MThd')
    chunks.slice(1).forEach((chunk) => expect(chunk.id).toBe('MTrk'))
    const total = chunks.reduce((sum, c) => sum + 8 + c.length, 0)
    expect(total).toBe(bytes.length)
  })

  it('各トラックが End of Track で終わる', () => {
    const bytes = createMidiFile(build(), 180)
    readChunks(bytes)
      .filter((c) => c.id === 'MTrk')
      .forEach((chunk) => {
        const end = chunk.start + chunk.length
        expect([bytes[end - 3], bytes[end - 2], bytes[end - 1]]).toEqual([0xff, 0x2f, 0x00])
      })
  })
})

describe('イベントの時刻', () => {
  it('Performance のイベントが時刻順に並んでいる', () => {
    const performance = build()
    const sorted = [...performance.events].sort((a, b) => a.startBeat - b.startBeat)
    expect(performance.events.map((e) => e.startBeat)).toEqual(sorted.map((e) => e.startBeat))
  })

  it('ピアノとベースが別トラックに分かれている', () => {
    const performance = build()
    expect(performance.events.some((e) => e.track === 'piano')).toBe(true)
    expect(performance.events.some((e) => e.track === 'bass')).toBe(true)
  })
})
