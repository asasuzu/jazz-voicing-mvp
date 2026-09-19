import type { ChordQuality, CompPattern, DensityPreset } from './types'

/**
 * すべての「数値」をここに集約する。
 * 音の良し悪しは実装者には判断できないので、初期値の精度より
 * 後から動かせることを優先する（docs/IMPLEMENTATION_PLAN.md §0.1）。
 * ロジック中に数値リテラルを直接書かないこと。
 */

export const TICKS_PER_QUARTER = 480

export const PLAYABILITY = {
  handSpanMax: 16,          // 長10度。利用者が届くとのことで9度から拡張
  handSpanPreferred: 12,    // これを超えると軽い減点のみ
  notesPerHandMax: 4,
  handGapMax: 12,           // 左手最高音と右手最低音の間隔
  totalNotesMax: 8,
}

/** 低音程限界。音程(半音) → その音程を作ってよい下の音の最低 MIDI 番号 */
export const LOW_INTERVAL_LIMITS: Record<number, number> = {
  1: 60, 2: 60,   // 半音・全音は C4 より下に置かない
  3: 53,          // 短3度 → F3
  4: 52,          // 長3度 → E3
  5: 50,          // 完全4度 → D3
  6: 47,          // 増4度 → B2
  7: 46,          // 完全5度 → Bb2
  8: 45,          // 短6度 → A2
  9: 43,          // 長6度 → G2
  10: 41,         // 短7度 → F2
  11: 40,         // 長7度 → E2
}
// 12半音以上は制限なし（C2 = 36 まで許可）。隣り合う音のペアにのみ適用する。

export const RANGES = {
  bass: { min: 28, max: 55 },          // E1–G3
  pianoDefault: { min: 45, max: 88 },
  leftHandDefault: { min: 48, max: 67 },
  rightHandDefault: { min: 60, max: 84 },
  powellLeftHand: { min: 41, max: 60 }, // F2–C4。広い音程なので低く置ける
}

export const DENSITY: Record<DensityPreset, {
  totalNotes: [number, number]   // 最小, 最大
  useRightHand: boolean
  includeRoot: boolean
  leftHandRange: { min: number; max: number }
}> = {
  powell:   { totalNotes: [2, 2], useRightHand: false, includeRoot: true,  leftHandRange: RANGES.powellLeftHand },
  shell3:   { totalNotes: [3, 3], useRightHand: false, includeRoot: true,  leftHandRange: RANGES.powellLeftHand },
  standard: { totalNotes: [4, 5], useRightHand: true,  includeRoot: false, leftHandRange: RANGES.leftHandDefault },
  thick:    { totalNotes: [5, 7], useRightHand: true,  includeRoot: false, leftHandRange: RANGES.leftHandDefault },
}

export const SCORE_WEIGHTS = {
  voiceLeading: 1.0,
  topLine: 0.6,           // UI スライダーで 0〜1.5 に変更可
  register: 0.3,
  familyVariety: 0.4,
  noteCountStability: 0.2,
  commonTone: 0.3,        // 加点なので減算する
  wideSpanPenalty: 0.15,  // handSpanPreferred 超過1半音あたり
}

/** トップノートの移動量(半音) → 減点。3〜4半音の動きが最も旋律的 */
export const TOP_LINE_PENALTY: { maxMove: number; penalty: number }[] = [
  { maxMove: 0, penalty: 3.0 },   // 同音の連続は旋律に聞こえない
  { maxMove: 2, penalty: 0.5 },
  { maxMove: 4, penalty: 0.0 },   // ここが最良
  { maxMove: 7, penalty: 1.0 },
  { maxMove: 99, penalty: 2.5 },  // 跳躍しすぎ
]

/**
 * Powell語彙の選好。負の値ほど選ばれやすい。利用者から「全然バドっぽくない。
 * 7度と10度をめっちゃ使うようにしてほしい」との指摘を受けて追加した
 * (docs/FEEDBACK_01.md §2)。R3(近接の3度)は低い位置では Powell が避けた
 * 響きなので控えめにする。
 */
export const POWELL_FAMILY_BIAS: Record<string, number> = {
  'powell-r7': -1.2,
  'powell-r10': -1.0,
  'powell-r3': 0.4,
  'powell-r6': 0.6,
  'powell-shell3': -0.8,
}

export const SEARCH = {
  candidatesPerChord: 40,   // 各コードで残す候補の上限
  beamWidth: 24,
  takeCount: 8,
  temperatureBase: 0.35,    // 既存の重み付き抽選の式を踏襲
  temperatureScale: 7.5,
}

export const VELOCITY = {
  piano:  { base: 72, offbeatAccent: 6, topNoteBonus: 4, jitter: 7, min: 30, max: 110 },
  bass:   { base: 84, downbeatAccent: 5, jitter: 5, min: 40, max: 112 },
  powell: { base: 78, offbeatAccent: 8, topNoteBonus: 0, jitter: 9, min: 35, max: 115 },
}

export const TIMING = {
  /** スウィング: 8分裏を拍のどの位置に置くか。0.5 = イーブン */
  swingRatioMax: 0.667,
  swingRatioMin: 0.5,
  swingDefaultRatio: 0.62,
  /** 速いテンポではイーブンに寄せる。この BPM を超えたら線形に 0.5 へ */
  swingFlattenStartBpm: 160,
  swingFlattenEndBpm: 260,
  /** 人間味。単位は tick */
  pianoJitterTicks: 8,
  bassJitterTicks: 5,
  /** 和音内で下から順にずらす量(tick)。完全同時を避ける */
  chordSpreadTicks: 6,
}

// ---------------------------------------------------------------------------
// ここから先は仕様書(IMPLEMENTATION_PLAN.md §2)に無い値。実装上必要になった
// ので、勝手に決めてここに置いた。決めた理由をコメントに残す。
// ---------------------------------------------------------------------------

/**
 * 試聴用シンセのゲイン。仕様書に音量の指定は無いが、Web Audio 側の
 * ノート生成が MIDI velocity(1–127) を受け取るようになったため、
 * velocity → gain の変換係数が必要になった。
 * 値は既存 MVP 0.1 の試聴音量（0.11〜0.13）と近い聴感になるよう決め打ち。
 */
export const AUDIO = {
  gainPerVelocity: 0.00105, // velocity 82 (旧デフォルト) で概ね 0.086〜0.11 相当になる
  previewGainBonus: 1.25,   // 単発試聴(Play chord)は少し大きめに鳴らす
}

/**
 * ウォーキングベースの「コードトーンかスケール音」判定に使う表(bass.ts)。
 * ルートからの半音オフセット(0=ルート)。どのモードを対応させるかは仕様書に
 * 無いので、対応する典型的なチャーチモードを決め打ちした。
 */
export const BASS_CHORD_TONES: Record<ChordQuality, { third: number; fifth: number; seventh: number | null }> = {
  major: { third: 4, fifth: 7, seventh: null },
  major7: { third: 4, fifth: 7, seventh: 11 },
  minor7: { third: 3, fifth: 7, seventh: 10 },
  dominant7: { third: 4, fifth: 7, seventh: 10 },
  halfDiminished: { third: 3, fifth: 6, seventh: 10 },
  diminished7: { third: 3, fifth: 6, seventh: 9 },
  minorMajor7: { third: 3, fifth: 7, seventh: 11 },
  sus7: { third: 5, fifth: 7, seventh: 10 }, // susは3度が無いので4度(11半音ではなく5半音)を代用
}

export const BASS_SCALES: Record<ChordQuality, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], // Ionian
  major7: [0, 2, 4, 5, 7, 9, 11], // Ionian
  minor7: [0, 2, 3, 5, 7, 9, 10], // Dorian
  dominant7: [0, 2, 4, 5, 7, 9, 10], // Mixolydian
  halfDiminished: [0, 1, 3, 5, 6, 8, 10], // Locrian
  diminished7: [0, 2, 3, 5, 6, 8, 9, 11], // Whole-half diminished
  minorMajor7: [0, 2, 3, 5, 7, 9, 11], // Melodic minor
  sus7: [0, 2, 4, 5, 7, 9, 10], // Mixolydian
}

export const BASS_ALTERED_SCALE = [0, 1, 3, 4, 6, 8, 10] // Super Locrian。altフラグの立ったdominant7用

export const BASS = {
  // ここまでは仕様書§6の本文中の確率をそのまま定数化したもの
  headRootWeight: 0.8,
  headFifthWeight: 0.12,
  headThirdWeight: 0.08,
  directionReversalRun: 5, // 「同じ方向に5音以上続いたら反転を優先」
  // 以下はアプローチ音(次のコードへの半音上/半音下/スケール隣接音/5度上)の抽選重み。
  // 仕様書は「から抽選」とだけ書いてあり比率の指定が無いため、
  // tests/bass.test.ts の「次のルートへ2半音以内」が安定して7割を超えるように
  // 実測しながら決め打ちした(5度上は7半音離れるため重みを下げてある)。
  // 半音アプローチだけに偏ると歩き方が単調になる。スケール上の隣接音と
  // 5度上からの跳躍(5度圏で降りてくる動き)も実際のベースではよく使う。
  approachChromaticBelowWeight: 0.3,
  approachChromaticAboveWeight: 0.2,
  approachScaleNeighborWeight: 0.3,
  approachFifthAboveWeight: 0.2,
}

/**
 * コンピングの初期パターン(仕様書§7)。charleston〜restの6つは全density共通、
 * powellJabs/powellSparseはpowell/shell3専用(仕様書の表に"専用"と明記)。
 * 3拍子・6拍子は第2段階まで`whole`相当のフォールバックを使う(comping.ts側で処理)。
 */
const GENERAL_DENSITIES: DensityPreset[] = ['powell', 'shell3', 'standard', 'thick']
const POWELL_DENSITIES: DensityPreset[] = ['powell', 'shell3']

export const COMP_PATTERNS: CompPattern[] = [
  {
    id: 'charleston',
    label: 'Charleston',
    density: GENERAL_DENSITIES,
    weight: 3,
    hits: [
      { beat: 0, durationBeats: 1.5, accent: 0 },
      { beat: 1.5, durationBeats: 0.5, accent: 6 },
    ],
  },
  {
    id: 'offbeats',
    label: 'Offbeats',
    density: GENERAL_DENSITIES,
    weight: 2,
    hits: [
      { beat: 1.5, durationBeats: 0.5, accent: 6 },
      { beat: 3.5, durationBeats: 0.5, accent: 4 },
    ],
  },
  {
    id: 'push',
    label: 'Push',
    density: GENERAL_DENSITIES,
    weight: 2,
    hits: [{ beat: -0.5, durationBeats: 2.0, accent: 6 }],
  },
  {
    id: 'whole',
    label: 'Whole',
    density: GENERAL_DENSITIES,
    weight: 2,
    hits: [{ beat: 0, durationBeats: 3.5, accent: 0 }],
  },
  {
    id: 'busy',
    label: 'Busy',
    density: GENERAL_DENSITIES,
    weight: 1,
    hits: [
      { beat: 0, durationBeats: 0.5, accent: 0 },
      { beat: 1.5, durationBeats: 0.5, accent: 6 },
      { beat: 2.5, durationBeats: 0.5, accent: 0 },
      { beat: 3.5, durationBeats: 0.5, accent: 4 },
    ],
  },
  {
    id: 'rest',
    label: 'Rest',
    density: GENERAL_DENSITIES,
    weight: 1,
    hits: [],
  },
  {
    id: 'powellJabs',
    label: 'Powell jabs',
    density: POWELL_DENSITIES,
    weight: 3,
    hits: [
      { beat: 0.5, durationBeats: 0.3, accent: 4 },
      { beat: 2.5, durationBeats: 0.3, accent: 6 },
      { beat: 3.5, durationBeats: 0.3, accent: 4 },
    ],
  },
  {
    id: 'powellSparse',
    label: 'Powell sparse',
    density: POWELL_DENSITIES,
    weight: 2,
    hits: [{ beat: 1.5, durationBeats: 0.3, accent: 6 }],
  },
]

/**
 * 密度スライダー(0〜100, 既定50)がweightに掛ける係数。仕様書は
 * 「sparse側ではwhole/restのweightを2倍、busyを0.3倍。busy側はその逆」とだけ
 * 書いてあるので、0/50/100を3点として線形補間する形に決め打ちした。
 */
export const COMPING_DENSITY_SLIDER = {
  default: 50,
  sparseMultiplier: { wholeRest: 2, busy: 0.3 },
  busyMultiplier: { wholeRest: 0.3, busy: 2 },
}
