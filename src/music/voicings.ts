import type {
  ChordQuality,
  GeneratedVoicing,
  ParsedChord,
  PlayContext,
  RangePreset,
  VoicingCandidate,
  VoicingTemplate,
} from './types'
import {
  buildAscendingIntervals,
  parseProgression,
  spellChordDegree,
} from './theory'

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'lh', label: '左手中心 A2–E5', min: 45, max: 76 },
  { id: 'center', label: '中央 C3–C5', min: 48, max: 72 },
  { id: 'wide', label: '広め C2–C6', min: 36, max: 84 },
]

const ROOTLESS_TEMPLATES: VoicingTemplate[] = [
  { id: 'maj-a', label: 'Rootless A', degrees: ['3', '5', '7', '9'], context: 'combo', qualities: ['major7'], color: 'basic' },
  { id: 'maj-b', label: 'Rootless B', degrees: ['7', '9', '3', '5'], context: 'combo', qualities: ['major7'], color: 'basic' },
  { id: 'maj-spread-a', label: 'Spread', degrees: ['3', '7', '9', '5'], context: 'combo', qualities: ['major7'], color: 'color' },
  { id: 'maj-spread-b', label: 'Spread inv.', degrees: ['7', '3', '5', '9'], context: 'combo', qualities: ['major7'], color: 'color' },

  { id: 'major-69-a', label: '6/9 color', degrees: ['3', '5', '6', '9'], context: 'combo', qualities: ['major'], color: 'basic' },
  { id: 'major-69-b', label: '6/9 inv.', degrees: ['6', '9', '3', '5'], context: 'combo', qualities: ['major'], color: 'basic' },

  { id: 'min-a', label: 'Rootless A', degrees: ['b3', '5', 'b7', '9'], context: 'combo', qualities: ['minor7'], color: 'basic' },
  { id: 'min-b', label: 'Rootless B', degrees: ['b7', '9', 'b3', '5'], context: 'combo', qualities: ['minor7'], color: 'basic' },
  { id: 'min-spread', label: 'Minor spread', degrees: ['b3', 'b7', '9', '5'], context: 'combo', qualities: ['minor7'], color: 'color' },
  { id: 'min-11', label: 'Minor 11 color', degrees: ['b3', 'b7', '9', '11'], context: 'combo', qualities: ['minor7'], color: 'color' },

  { id: 'dom-a', label: '13th A', degrees: ['3', '13', 'b7', '9'], context: 'combo', qualities: ['dominant7'], color: 'basic' },
  { id: 'dom-b', label: '13th B', degrees: ['b7', '9', '3', '13'], context: 'combo', qualities: ['dominant7'], color: 'basic' },
  { id: 'dom-spread-a', label: 'Dominant spread', degrees: ['3', 'b7', '9', '13'], context: 'combo', qualities: ['dominant7'], color: 'color' },
  { id: 'dom-spread-b', label: 'Dominant spread inv.', degrees: ['b7', '3', '13', '9'], context: 'combo', qualities: ['dominant7'], color: 'color' },

  { id: 'half-dim-a', label: 'Half-dim color', degrees: ['b3', 'b5', 'b7', '11'], context: 'combo', qualities: ['halfDiminished'], color: 'basic' },
  { id: 'half-dim-b', label: 'Half-dim inv.', degrees: ['b7', '11', 'b3', 'b5'], context: 'combo', qualities: ['halfDiminished'], color: 'basic' },

  { id: 'mmaj-a', label: 'mMaj9 A', degrees: ['b3', '5', '7', '9'], context: 'combo', qualities: ['minorMajor7'], color: 'basic' },
  { id: 'mmaj-b', label: 'mMaj9 B', degrees: ['7', '9', 'b3', '5'], context: 'combo', qualities: ['minorMajor7'], color: 'basic' },

  { id: 'sus-a', label: '13sus', degrees: ['b7', '9', '11', '13'], context: 'combo', qualities: ['sus7'], color: 'basic' },
  { id: 'sus-b', label: '13sus inv.', degrees: ['11', '13', 'b7', '9'], context: 'combo', qualities: ['sus7'], color: 'basic' },
]

const SOLO_TEMPLATES: VoicingTemplate[] = [
  { id: 'solo-maj7-a', label: 'Root + guide + 9', degrees: ['1', '7', '3', '9'], context: 'solo', qualities: ['major7'], color: 'basic' },
  { id: 'solo-maj7-b', label: 'Rooted spread', degrees: ['1', '5', '7', '3'], context: 'solo', qualities: ['major7'], color: 'basic' },
  { id: 'solo-major-a', label: 'Rooted 6/9', degrees: ['1', '6', '3', '9'], context: 'solo', qualities: ['major'], color: 'basic' },
  { id: 'solo-major-b', label: 'Rooted major', degrees: ['1', '5', '6', '3'], context: 'solo', qualities: ['major'], color: 'basic' },
  { id: 'solo-min-a', label: 'Root + guide + 9', degrees: ['1', 'b7', 'b3', '9'], context: 'solo', qualities: ['minor7'], color: 'basic' },
  { id: 'solo-min-b', label: 'Rooted minor spread', degrees: ['1', '5', 'b7', 'b3'], context: 'solo', qualities: ['minor7'], color: 'basic' },
  { id: 'solo-dom-a', label: 'Root + guide + 13', degrees: ['1', 'b7', '3', '13'], context: 'solo', qualities: ['dominant7'], color: 'basic' },
  { id: 'solo-dom-b', label: 'Rooted dominant', degrees: ['1', '5', 'b7', '3'], context: 'solo', qualities: ['dominant7'], color: 'basic' },
  { id: 'solo-halfdim', label: 'Complete m7b5', degrees: ['1', 'b3', 'b5', 'b7'], context: 'solo', qualities: ['halfDiminished'], color: 'basic' },
  { id: 'solo-dim', label: 'Complete dim7', degrees: ['1', 'b3', 'b5', 'bb7'], context: 'solo', qualities: ['diminished7'], color: 'basic' },
  { id: 'solo-mmaj', label: 'Rooted mMaj9', degrees: ['1', '7', 'b3', '9'], context: 'solo', qualities: ['minorMajor7'], color: 'basic' },
  { id: 'solo-sus', label: 'Rooted 13sus', degrees: ['1', 'b7', '11', '13'], context: 'solo', qualities: ['sus7'], color: 'basic' },
]

function alteredDominantTemplates(chord: ParsedChord, context: PlayContext): VoicingTemplate[] {
  if (chord.quality !== 'dominant7') return []

  const { alt, flat9, sharp9, sharp11, flat13 } = chord.flags
  if (!alt && !flat9 && !sharp9 && !sharp11 && !flat13) return []

  const ninths = alt ? ['b9', '#9'] : [sharp9 ? '#9' : flat9 ? 'b9' : '9']
  const upperTone = flat13 || alt ? 'b13' : sharp11 ? '#11' : '13'

  const templates: VoicingTemplate[] = []
  ninths.forEach((ninth, index) => {
    if (context === 'combo') {
      templates.push({
        id: `alt-a-${index}`,
        label: alt ? 'Altered A' : 'Specified tension A',
        degrees: ['3', upperTone, 'b7', ninth],
        context: 'combo',
        qualities: ['dominant7'],
        color: 'color',
      })
      templates.push({
        id: `alt-b-${index}`,
        label: alt ? 'Altered B' : 'Specified tension B',
        degrees: ['b7', ninth, '3', upperTone],
        context: 'combo',
        qualities: ['dominant7'],
        color: 'color',
      })
    } else {
      templates.push({
        id: `solo-alt-${index}`,
        label: alt ? 'Rooted altered' : 'Rooted specified tension',
        degrees: ['1', 'b7', '3', ninth],
        context: 'solo',
        qualities: ['dominant7'],
        color: 'color',
      })
    }
  })
  return templates
}

function templatesForChord(chord: ParsedChord, context: PlayContext, colorful: boolean): VoicingTemplate[] {
  const altered = alteredDominantTemplates(chord, context)
  if (altered.length > 0) return altered

  const source = context === 'combo' ? ROOTLESS_TEMPLATES : SOLO_TEMPLATES
  let templates = source.filter((template) => template.qualities.includes(chord.quality))

  if (!colorful) templates = templates.filter((template) => template.color !== 'color')

  if (templates.length === 0 && chord.quality === 'diminished7') {
    return [
      {
        id: 'dim-complete-fallback',
        label: 'Complete dim7',
        degrees: ['1', 'b3', 'b5', 'bb7'],
        context: 'both',
        qualities: ['diminished7'],
        color: 'basic',
      },
    ]
  }

  return templates
}

function possibleRootMidis(rootPc: number): number[] {
  const result: number[] = []
  for (let midi = rootPc; midi < 120; midi += 12) result.push(midi)
  return result
}

function dedupeCandidates(candidates: VoicingCandidate[]): VoicingCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.midi.join('-')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function generateCandidates(
  chord: ParsedChord,
  context: PlayContext,
  range: RangePreset,
  colorful: boolean,
): VoicingCandidate[] {
  const templates = templatesForChord(chord, context, colorful)
  const center = (range.min + range.max) / 2
  const result: VoicingCandidate[] = []

  for (const template of templates) {
    const intervals = buildAscendingIntervals(template.degrees)
    for (const rootMidi of possibleRootMidis(chord.rootPc)) {
      const midi = intervals.map((interval) => rootMidi + interval)
      if (midi[0] < range.min || midi[midi.length - 1] > range.max) continue

      const average = midi.reduce((sum, note) => sum + note, 0) / midi.length
      result.push({
        id: `${chord.symbol}-${template.id}-${midi.join('.')}`,
        chord,
        label: template.label,
        degrees: template.degrees,
        midi,
        noteNames: midi.map((note, index) => spellChordDegree(chord, template.degrees[index], note)),
        centerPenalty: Math.abs(average - center),
      })
    }
  }

  return dedupeCandidates(result).sort((a, b) => a.centerPenalty - b.centerPenalty)
}

export function voicingDistance(previous: number[], next: number[]): number {
  const a = [...previous].sort((x, y) => x - y)
  const b = [...next].sort((x, y) => x - y)
  const voices = Math.min(a.length, b.length)
  let total = 0
  for (let i = 0; i < voices; i += 1) total += Math.abs(a[i] - b[i])
  total += Math.abs(a.length - b.length) * 6
  return total
}

function weightedChoice<T>(items: T[], scores: number[], randomness: number): T {
  if (items.length === 1) return items[0]
  if (randomness <= 0.01) return items[scores.indexOf(Math.min(...scores))]

  const normalizedRandomness = Math.max(0, Math.min(1, randomness))
  const temperature = 0.35 + normalizedRandomness * 7.5
  const minScore = Math.min(...scores)
  const weights = scores.map((score) => Math.exp(-(score - minScore) / temperature))
  const total = weights.reduce((sum, value) => sum + value, 0)
  let cursor = Math.random() * total

  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return items[i]
  }
  return items[items.length - 1]
}

export interface GenerateOptions {
  context: PlayContext
  range: RangePreset
  colorful: boolean
  randomness: number
  beatsPerBar: number
}

export function generateProgressionVoicings(input: string, options: GenerateOptions): GeneratedVoicing[] {
  const chords = parseProgression(input, options.beatsPerBar)
  const result: GeneratedVoicing[] = []

  for (const chord of chords) {
    const candidates = generateCandidates(chord, options.context, options.range, options.colorful)
    if (candidates.length === 0) {
      throw new Error(`${chord.symbol} は現在の音域では候補を作れません。音域を「広め」にしてみてください。`)
    }

    if (result.length === 0) {
      const shortlist = candidates.slice(0, Math.min(6, candidates.length))
      const scores = shortlist.map((candidate) => candidate.centerPenalty)
      result.push(weightedChoice(shortlist, scores, options.randomness))
      continue
    }

    const previous = result[result.length - 1]
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        movement: voicingDistance(previous.midi, candidate.midi),
        score: voicingDistance(previous.midi, candidate.midi) + candidate.centerPenalty * 0.3,
      }))
      .sort((a, b) => a.score - b.score)

    const poolSize = Math.max(2, Math.min(ranked.length, 3 + Math.round(options.randomness * 7)))
    const pool = ranked.slice(0, poolSize)
    const selected = weightedChoice(
      pool.map((item) => item.candidate),
      pool.map((item) => item.score),
      options.randomness,
    )
    const movement = voicingDistance(previous.midi, selected.midi)
    result.push({ ...selected, movementFromPrevious: movement })
  }

  return result
}
