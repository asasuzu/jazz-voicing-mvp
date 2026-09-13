import type { GeneratedVoicing } from './types'

const TICKS_PER_QUARTER = 480

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

export function createMidiFile(voicings: GeneratedVoicing[], tempo: number): Uint8Array {
  const track: number[] = []
  const microsecondsPerQuarter = Math.round(60_000_000 / tempo)

  track.push(0x00, 0xff, 0x51, 0x03)
  track.push(
    (microsecondsPerQuarter >>> 16) & 0xff,
    (microsecondsPerQuarter >>> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  )
  track.push(0x00, 0xc0, 0x00)

  voicings.forEach((voicing) => {
    const marker = textBytes(voicing.chord.symbol)
    track.push(0x00, 0xff, 0x06, ...variableLength(marker.length), ...marker)

    const durationTicks = Math.round(TICKS_PER_QUARTER * voicing.chord.beats)
    voicing.midi.forEach((note) => track.push(0x00, 0x90, note, 82))
    voicing.midi.forEach((note, index) => {
      track.push(...variableLength(index === 0 ? durationTicks : 0), 0x80, note, 0)
    })
  })

  track.push(0x00, 0xff, 0x2f, 0x00)

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

export function downloadMidi(voicings: GeneratedVoicing[], tempo: number): void {
  const bytes = createMidiFile(voicings, tempo)
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
