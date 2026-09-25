export type ChordQuality =
  | 'major'
  | 'major7'
  | 'minor7'
  | 'minor6'
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

export type TrackId = 'piano' | 'bass'
export type Hand = 'left' | 'right'
export type DensityPreset = 'powell' | 'shell3' | 'standard' | 'thick'
/** ピアノの弾き方。block=和音をリズムで刻む、arpeggio=コードごとに下から1音ずつ転がして伸ばす */
export type PianoStyle = 'block' | 'arpeggio'

/** 1つの和音の配置。左右の手を分けて持つ */
export interface Voicing {
  family: string          // vocab モジュールの id
  label: string           // 画面表示用（日本語可）
  left: number[]          // 左手の MIDI 番号。低い順
  right: number[]         // 右手の MIDI 番号。低い順。Powell では空配列
  degrees: string[]       // left.concat(right) と同じ並び・同じ長さ
}

/** 進行全体で確定した1テイク */
export interface Take {
  id: string
  voicings: Voicing[]     // chords と同じ長さ・同じ並び
  chords: ParsedChord[]
  score: number           // 小さいほど良い。デバッグ表示用
}

/** 最終的な演奏イベント。ここがスウィングもベロシティも適用済みの唯一の真実 */
export interface PerformanceEvent {
  track: TrackId
  midi: number
  startBeat: number       // 曲頭からの位置（拍）。スウィング適用後
  durationBeats: number
  velocity: number        // 1–127
}

export interface Performance {
  events: PerformanceEvent[]
  totalBeats: number
  take: Take
}

/** コンピングのリズムパターン(comping.ts)。仕様書 §7 */
export interface CompHit {
  beat: number            // 小節頭からの拍。負の値は前の小節への食い込み
  durationBeats: number
  accent: number          // ベロシティ加算
}

export interface CompPattern {
  id: string
  label: string
  density: DensityPreset[]   // どのプリセットで使うか
  weight: number              // 抽選の重み
  hits: CompHit[]
}
