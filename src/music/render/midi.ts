import { TICKS_PER_QUARTER } from '../constants'
import type { Performance } from '../types'

/**
 * 第1段階の暫定実装。format 0 の単一トラックのまま、入力だけ
 * GeneratedVoicing[] から Performance へ差し替える。
 * format 1 マルチトラック化(トラック分離・コードマーカー)は Step5 で行う。
 */

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function uint16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function variableLength(value: number): number[] {
  let buffer = value & 0x7f
  const bytes: number[] = []
  while ((value >>= 7)) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
  }
  while (true) {
    bytes.push(buffer & 0xff)
    if (buffer & 0x80) buffer >>= 8
    else break
  }
  return bytes
}

function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

interface MidiByteEvent {
  tick: number
  bytes: number[]
}

/** startBeat でソートしてから delta time を計算する(仕様書 §9 でいちばんバグりやすいと明記された箇所) */
function toDeltaTimeTrack(events: MidiByteEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick)
  const track: number[] = []
  let previousTick = 0
  sorted.forEach(({ tick, bytes }) => {
    track.push(...variableLength(tick - previousTick), ...bytes)
    previousTick = tick
  })
  return track
}

export function createMidiFile(performance: Performance, tempo: number): Uint8Array {
  const microsecondsPerQuarter = Math.round(60_000_000 / tempo)

  const byteEvents: MidiByteEvent[] = [
    {
      tick: 0,
      bytes: [
        0xff, 0x51, 0x03,
        (microsecondsPerQuarter >>> 16) & 0xff,
        (microsecondsPerQuarter >>> 8) & 0xff,
        microsecondsPerQuarter & 0xff,
      ],
    },
    { tick: 0, bytes: [0xc0, 0x00] },
  ]

  performance.events.forEach((event) => {
    const startTick = Math.round(event.startBeat * TICKS_PER_QUARTER)
    const endTick = Math.round((event.startBeat + event.durationBeats) * TICKS_PER_QUARTER)
    byteEvents.push({ tick: startTick, bytes: [0x90, event.midi, event.velocity] })
    byteEvents.push({ tick: endTick, bytes: [0x80, event.midi, 0] })
  })

  const track = [...toDeltaTimeTrack(byteEvents), ...variableLength(0), 0xff, 0x2f, 0x00]

  const header = [
    ...textBytes('MThd'),
    ...uint32(6),
    ...uint16(0),
    ...uint16(1),
    ...uint16(TICKS_PER_QUARTER),
  ]
  const trackChunk = [...textBytes('MTrk'), ...uint32(track.length), ...track]
  return new Uint8Array([...header, ...trackChunk])
}

export function downloadMidi(performance: Performance, tempo: number): void {
  const bytes = createMidiFile(performance, tempo)
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `jazz-voicing-${new Date().toISOString().slice(0, 10)}.mid`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
