import type { ChordQuality, ParsedChord } from './types'

const NATURAL_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export const DEGREE_SEMITONES: Record<string, number> = {
  '1': 0,
  'b3': 3,
  '3': 4,
  'b5': 6,
  '5': 7,
  '#5': 8,
  '6': 9,
  'bb7': 9,
  'b7': 10,
  '7': 11,
  'b9': 13,
  '9': 14,
  '#9': 15,
  '11': 17,
  '#11': 18,
  'b13': 20,
  '13': 21,
}

const DEGREE_STEPS: Record<string, number> = {
  '1': 0,
  'b3': 2,
  '3': 2,
  'b5': 4,
  '5': 4,
  '#5': 4,
  '6': 5,
  'bb7': 6,
  'b7': 6,
  '7': 6,
  'b9': 1,
  '9': 1,
  '#9': 1,
  '11': 3,
  '#11': 3,
  'b13': 5,
  '13': 5,
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]

function accidentalOffset(accidental: string): number {
  if (accidental === '#') return 1
  if (accidental === 'b') return -1
  return 0
}

export function pitchClassFromNote(note: string): number {
  const match = note.match(/^([A-Ga-g])([#b]?)$/)
  if (!match) throw new Error(`音名を解釈できません: ${note}`)
  const letter = match[1].toUpperCase()
  return (NATURAL_PC[letter] + accidentalOffset(match[2]) + 12) % 12
}

function detectQuality(rawSuffix: string): ChordQuality {
  const unicodeNormalized = rawSuffix
    .replaceAll('♭', 'b')
    .replaceAll('♯', '#')
    .replaceAll('−', '-')
    .replaceAll('–', '-')

  if (/^(mMaj7|mM7|minMaj7)/i.test(unicodeNormalized)) return 'minorMajor7'
  if (/^(m7b5|m7\(b5\)|ø7?|half[- ]?dim)/i.test(unicodeNormalized)) return 'halfDiminished'
  if (/^(dim7|o7|°7)/i.test(unicodeNormalized)) return 'diminished7'
  if (/^(7sus4|7sus|sus7|sus4)/i.test(unicodeNormalized)) return 'sus7'
  if (/^(maj7|maj9)/i.test(unicodeNormalized) || /^(M7|M9|Δ7?|△7?)/.test(unicodeNormalized)) return 'major7'
  if (/^(m7|min7|-7|m9|min9|-9|m11|min11|-11)/i.test(unicodeNormalized)) return 'minor7'
  if (/^(7|9|13)/.test(unicodeNormalized)) return 'dominant7'
  if (unicodeNormalized === '') return 'major'
  if (/^(m|min|-)/i.test(unicodeNormalized)) return 'minor7'
  return 'dominant7'
}

export function parseChordSymbol(symbol: string): ParsedChord {
  const cleaned = symbol.trim().replaceAll('♭', 'b').replaceAll('♯', '#')
  const match = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/)
  if (!match) throw new Error(`コードを解釈できません: ${symbol}`)

  const root = `${match[1].toUpperCase()}${match[2]}`
  let suffix = match[3] || ''
  let bass: string | undefined

  const slashMatch = suffix.match(/\/([A-Ga-g][#b]?)$/)
  if (slashMatch) {
    bass = `${slashMatch[1][0].toUpperCase()}${slashMatch[1].slice(1)}`
    suffix = suffix.slice(0, slashMatch.index)
  }

  const lower = suffix.toLowerCase()
  return {
    symbol: cleaned,
    root,
    rootPc: pitchClassFromNote(root),
    quality: detectQuality(suffix),
    suffix,
    bass,
    flags: {
      alt: lower.includes('alt'),
      flat9: lower.includes('b9'),
      sharp9: lower.includes('#9'),
      sharp11: lower.includes('#11'),
      flat13: lower.includes('b13'),
      explicit9: /(^|[^#b])9/.test(lower),
      explicit13: /13/.test(lower),
    },
  }
}

export function parseProgression(input: string): ParsedChord[] {
  const symbols = input
    .split(/[\s,|]+/)
    .map((value) => value.trim())
    .filter(Boolean)

  if (symbols.length === 0) throw new Error('コード進行を1つ以上入力してください。')
  if (symbols.length > 32) throw new Error('MVPでは一度に32コードまでにしています。')

  return symbols.map(parseChordSymbol)
}

export function buildAscendingIntervals(degrees: string[]): number[] {
  let previous = -Infinity
  return degrees.map((degree) => {
    const base = DEGREE_SEMITONES[degree]
    if (base === undefined) throw new Error(`未対応の度数です: ${degree}`)
    let value = base
    while (value <= previous) value += 12
    previous = value
    return value
  })
}

export function midiToNoteName(midi: number, preferFlats = false): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${(preferFlats ? FLAT_NAMES : SHARP_NAMES)[pc]}${octave}`
}

export function spellChordDegree(chord: ParsedChord, degree: string, midi: number): string {
  const step = DEGREE_STEPS[degree]
  const semitones = DEGREE_SEMITONES[degree]
  if (step === undefined || semitones === undefined) return midiToNoteName(midi, prefersFlats(chord))

  const rootLetterIndex = LETTERS.indexOf(chord.root[0])
  if (rootLetterIndex < 0) return midiToNoteName(midi, prefersFlats(chord))

  const targetLetterIndex = (rootLetterIndex + step) % 7
  const targetLetter = LETTERS[targetLetterIndex]
  const naturalPc = LETTER_PC[targetLetterIndex]
  const desiredPc = (chord.rootPc + semitones) % 12

  let accidental = desiredPc - naturalPc
  while (accidental > 6) accidental -= 12
  while (accidental < -6) accidental += 12

  const accidentalText =
    accidental === -2 ? 'bb' :
    accidental === -1 ? 'b' :
    accidental === 0 ? '' :
    accidental === 1 ? '#' :
    accidental === 2 ? '##' :
    accidental < 0 ? 'b'.repeat(Math.abs(accidental)) : '#'.repeat(accidental)

  const octave = (midi - naturalPc - accidental) / 12 - 1
  if (!Number.isInteger(octave)) return midiToNoteName(midi, prefersFlats(chord))
  return `${targetLetter}${accidentalText}${octave}`
}

export function prefersFlats(chord: ParsedChord): boolean {
  return chord.root.includes('b') || chord.suffix.includes('b')
}
