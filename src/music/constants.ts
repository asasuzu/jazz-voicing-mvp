import type { DensityPreset } from './types'

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
