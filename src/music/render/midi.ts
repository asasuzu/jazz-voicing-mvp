import { TICKS_PER_QUARTER } from '../constants'
import type { Performance, TrackId } from '../types'

/**
 * SMF format 1 のマルチトラック書き出し(仕様書§9)。
 * トラック0: テンポ・拍子・曲名・コード記号マーカー
 * トラック1: Piano (program 0)
 * トラック2: Bass (program 32, Acoustic Bass)。ベースOFFのときはこのトラックを出さない。
 */

const PIANO_CHANNEL = 0
const BASS_CHANNEL = 1
const BASS_PROGRAM = 32 // Acoustic Bass (General MIDI)

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

function metaText(type: number, text: string): number[] {
  const bytes = textBytes(text)
  return [0xff, type, ...variableLength(bytes.length), ...bytes]
}

interface MidiByteEvent {
  tick: number
  bytes: number[]
}

/**
 * startBeatでソートしてからdelta timeを計算する。ノートオフも含めて時刻順に
 * 並べてから差分を取ること(仕様書§9で「いちばんバグりやすい」と明記された箇所)。
 */
function toDeltaTimeTrack(events: MidiByteEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick)
  const track: number[] = []
  let previousTick = 0
  sorted.forEach(({ tick, bytes }) => {
    track.push(...variableLength(Math.max(0, tick - previousTick)), ...bytes)
    previousTick = tick
  })
  return track
}

function toTrackChunk(byteEvents: MidiByteEvent[]): number[] {
  const body = [...toDeltaTimeTrack(byteEvents), 0x00, 0xff, 0x2f, 0x00]
  return [...textBytes('MTrk'), ...uint32(body.length), ...body]
}

function buildMetaTrack(performance: Performance, tempo: number, beatsPerBar: number): number[] {
  const microsecondsPerQuarter = Math.round(60_000_000 / tempo)
  const events: MidiByteEvent[] = [
    {
      tick: 0,
      bytes: [
        0xff, 0x51, 0x03,
        (microsecondsPerQuarter >>> 16) & 0xff,
        (microsecondsPerQuarter >>> 8) & 0xff,
        microsecondsPerQuarter & 0xff,
      ],
    },
    { tick: 0, bytes: [0xff, 0x58, 0x04, beatsPerBar, 0x02, 0x18, 0x08] }, // 4分音符=1拍という前提(denominator=2^2)
    { tick: 0, bytes: metaText(0x03, 'Jazz Voicing Lab') },
  ]

  // コード記号をマーカーとして記録する。コーラス数ぶん繰り返す(Performance.totalBeatsから逆算)。
  const chorusBeats = performance.take.chords.reduce((sum, chord) => sum + chord.beats, 0)
  const choruses = chorusBeats > 0 ? Math.max(1, Math.round(performance.totalBeats / chorusBeats)) : 1

  for (let chorus = 0; chorus < choruses; chorus += 1) {
    let cursor = chorus * chorusBeats
    performance.take.chords.forEach((chord) => {
      events.push({ tick: Math.round(cursor * TICKS_PER_QUARTER), bytes: metaText(0x06, chord.symbol) })
      cursor += chord.beats
    })
  }

  return toTrackChunk(events)
}

function buildInstrumentTrack(
  performance: Performance,
  track: TrackId,
  name: string,
  channel: number,
  program: number,
): number[] {
  const events: MidiByteEvent[] = [
    { tick: 0, bytes: metaText(0x03, name) },
    { tick: 0, bytes: [0xc0 | channel, program] },
  ]

  performance.events
    .filter((event) => event.track === track)
    .forEach((event) => {
      const startTick = Math.round(event.startBeat * TICKS_PER_QUARTER)
      const endTick = Math.round((event.startBeat + event.durationBeats) * TICKS_PER_QUARTER)
      events.push({ tick: startTick, bytes: [0x90 | channel, event.midi, event.velocity] })
      events.push({ tick: endTick, bytes: [0x80 | channel, event.midi, 0] })
    })

  return toTrackChunk(events)
}

export function createMidiFile(performance: Performance, tempo: number, beatsPerBar = 4): Uint8Array {
  const hasBass = performance.events.some((event) => event.track === 'bass')
  const trackCount = hasBass ? 3 : 2

  const metaTrack = buildMetaTrack(performance, tempo, beatsPerBar)
  const pianoTrack = buildInstrumentTrack(performance, 'piano', 'Piano', PIANO_CHANNEL, 0)
  const tracks = hasBass
    ? [metaTrack, pianoTrack, buildInstrumentTrack(performance, 'bass', 'Bass', BASS_CHANNEL, BASS_PROGRAM)]
    : [metaTrack, pianoTrack]

  const header = [
    ...textBytes('MThd'),
    ...uint32(6),
    ...uint16(1), // format 1
    ...uint16(trackCount),
    ...uint16(TICKS_PER_QUARTER),
  ]

  return new Uint8Array([...header, ...tracks.flat()])
}

/** 進行の先頭コード-テンポbpm-日付.mid (仕様書§9) */
function fileNameFor(performance: Performance, tempo: number): string {
  const firstSymbol = performance.take.chords[0]?.symbol ?? 'progression'
  const date = new Date().toISOString().slice(0, 10)
  return `${firstSymbol}-${tempo}bpm-${date}.mid`
}

export function downloadMidi(performance: Performance, tempo: number, beatsPerBar = 4): void {
  const bytes = createMidiFile(performance, tempo, beatsPerBar)
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileNameFor(performance, tempo)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
