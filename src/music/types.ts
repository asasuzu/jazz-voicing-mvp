export type ChordQuality =
  | 'major'
  | 'major7'
  | 'minor7'
  | 'dominant7'
  | 'halfDiminished'
  | 'diminished7'
  | 'minorMajor7'
  | 'sus7'

export type PlayContext = 'combo' | 'solo'

export interface ParsedChord {
  symbol: string
  root: string
  rootPc: number
  quality: ChordQuality
  suffix: string
  bass?: string
  flags: {
    alt: boolean
    flat9: boolean
    sharp9: boolean
    sharp11: boolean
    flat13: boolean
    explicit9: boolean
    explicit13: boolean
  }
  /** このコードが鳴る拍数。1小節に複数コードがあれば小節の拍数を均等に分けた値になる。 */
  beats: number
  /** 0始まりの小節番号。カード表示を小節ごとにまとめるために使う。 */
  barIndex: number
}

export interface VoicingTemplate {
  id: string
  label: string
  degrees: string[]
  context: PlayContext | 'both'
  qualities: ChordQuality[]
  color?: 'basic' | 'color'
}

export interface VoicingCandidate {
  id: string
  chord: ParsedChord
  label: string
  degrees: string[]
  midi: number[]
  noteNames: string[]
  centerPenalty: number
}

export interface GeneratedVoicing extends VoicingCandidate {
  movementFromPrevious?: number
}

export interface RangePreset {
  id: string
  label: string
  min: number
  max: number
}
