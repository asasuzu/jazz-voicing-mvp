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

/**
 * 「このコードではこの音を使ってほしい／使ってほしくない」を書く表。
 * キーはルートからの半音、値は加点(負ほど選ばれやすい)。
 *
 * 利用者から出る「ここはこの音にしてほしい」という要望は、好みではなく
 * 名前のある規則であることが多い。そういうものはここに1行足せば済むように
 * してある。コードを書き換える必要は無い。
 *
 * 値の目安: 1.0 が「声部が1半音動くのと同じくらい嫌」。ランダム性は
 * 色を変えるためのもので、ボイスリーディングの規則を壊すためのものではない。
 * randomnessを上げても守ってほしい規則は、2.0以上を付けないと抽選をすり抜ける。
 *
 * 現在入っている根拠:
 * - ドミナントの5度より13度（VOICING_RESEARCH.md §3）。rootless dominantでは
 *   5度を13度へ置き換えるのが実用的。ナチュラル5度は響きが痩せるうえ、
 *   ii-Vで ii の9度をそのまま13度として保持できなくなる
 *   （利用者の指摘: Dm7の9th(E)がG7の5th(D)へ動くのは変）
 * - major7の11度は3度とぶつかるので避ける
 */
export const TONE_PRIORITY: Partial<Record<ChordQuality, Record<number, number>>> = {
  dominant7: {
    9: -2.0, // 13th。ここを最優先にする
    7: 2.5, // ナチュラル5th
    2: -0.2, // 9th
  },
  major7: {
    9: -0.2, // 13th(6th)
    2: -0.2, // 9th
    5: 1.2, // ナチュラル11th。3度とぶつかる
  },
  minor7: {
    2: -0.2, // 9th
    5: -0.1, // 11th。マイナーでは普通に使える
  },
}

export const SCORE_WEIGHTS = {
  voiceLeading: 1.0,
  topLine: 0.6,           // UI スライダーで 0〜1.5 に変更可
  register: 0.3,
  familyVariety: 0.4,
  noteCountStability: 0.2,
  // 共通音の保持。前のコードで鳴っていた音がそのまま次でも使えるなら残す。
  // 0.3では他の項に負けて、保持できるテンションが平気で動いていた
  // (Dm7の9th(E)が179回中80回もG7で消えていた)。
  commonTone: 0.9,        // 加点なので減算する
  tonePriority: 1.0,      // TONE_PRIORITY表の効き
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
  /**
   * ループ再生スケジューラ(render/audio.ts の startPerformanceLoop)用。
   * FEEDBACK_01.md §3: 次のscheduleChorus呼び出しを「chorusSeconds - lookahead」秒後に
   * 固定で仕掛けていたが、nextStartは毎周chorusSeconds分だけ進む一方、実時間は
   * (chorusSeconds - lookahead)分しか進まないため、両者の差が毎周lookahead秒ずつ
   * 際限なく開いていくバグがあった(実測: 260BPM/3小節ループで約0.4秒/周ずつ増加)。
   * 音自体はズレないが、鳴らされていないOscillatorNodeが周を追うごとに積み上がり、
   * 「何周かしてから重くなって変になる」の原因になっていた。
   * 対策: 次回呼び出しの遅延は毎回「実際に残っている先読み時間」から逆算する。
   */
  loopInitialLeadSeconds: 0.08, // 再生開始直後の最初の余白
  loopLookaheadSeconds: 0.4,    // 定常状態で維持したい先読み時間
  loopMinLookaheadSeconds: 0.05, // nextStartの下限クランプ(過去に予約されるのを防ぐ)
  loopMinTimerMs: 60,            // setTimeoutの遅延がこれより短くならないようにする
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
  minor6: { third: 3, fifth: 7, seventh: null },
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
  minor6: [0, 2, 3, 5, 7, 9, 11], // Melodic minor。トニックのm6はこれが定番
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

  // ---------------------------------------------------------------------
  // ここから docs/FEEDBACK_01.md §1(「ベースが歩けていない」)への対応。
  // 「逆にかっこいい」は皮肉で、実用に耐えないという深刻な指摘だったため
  // 作り直した。決めたことの1〜6にそれぞれ対応する定数。
  // ---------------------------------------------------------------------

  /** 1. 中間拍は直前の音から±この半音数以内に候補を絞る。フィードバックの指摘どおり
   * 「近い順に並べて1/(i+1)で抽選」では最も近い音が37%しか選ばれず飛び回っていた。 */
  middleStepMaxDistance: 4,
  /** 中間拍の重みづけ: weight = decay^distance。距離0(直前と同度数感)が最優先になるよう
   * 急峻にする。0.35を1回かけるごとに重みが1/3弱になる決め打ち(仕様書に式の指定は無い)。 */
  middleStepWeightDecay: 0.35,

  /** 2. 3拍目(もう1つの強拍)はコードトーンのみ。スケール音は2・4拍目に回す。 */
  // (フラグの持ち方は bass.ts 側のforceChordTone引数で表現するため、値はここには無い)

  /** 3. 1小節2コードのとき、最後の拍を毎回アプローチ音にはしない。この確率でだけ
   * アプローチ音にし、残りはコードトーンにする(仕様書「確率0.6程度」)。 */
  twoChordBarApproachProbability: 0.6,

  /** 4. 音域を狭めて中心へ戻す弱いバイアス。walkingの実用域として仕様書が挙げた
   * E1(28)〜E3(52)を「好ましい範囲」とし、そこから外れた分だけ軽いペナルティを足す。 */
  preferredRangeMin: 28, // E1
  preferredRangeMax: 52, // E3
  /** 好ましい範囲から外れた半音1つあたりに足すペナルティの重み。「弱いバイアス」なので
   * オクターブ違い(12半音)の距離差を逆転させない程度に小さくする。 */
  centerBiasWeightPerSemitone: 0.15,

  /** 5. 連続する2音の跳躍の上限(半音)。コードの頭でのみ例外を許す。 */
  maxLeapSemitones: 5,

  /** 6. コーラスの1小節目の1拍目は確率1.0でルート。それ以外の小節頭は現行どおり
   * headRootWeightを使う。 */
  firstBeatOfChorusRootProbability: 1.0,
}

/**
 * コンピングの初期パターン(仕様書§7)。charleston〜restの6つは全density共通、
 * powellJabs/powellSparseはpowell/shell3専用(仕様書の表に"専用"と明記)。
 * 3拍子・6拍子は第2段階まで`whole`相当のフォールバックを使う(comping.ts側で処理)。
 */
const GENERAL_DENSITIES: DensityPreset[] = ['powell', 'shell3', 'standard', 'thick']
const POWELL_DENSITIES: DensityPreset[] = ['powell', 'shell3']

/**
 * 密度スライダーを端へ振ったときに offbeats の独占をどれだけ崩すか。
 * 既定(50)では 2裏・4裏が9割超。端では他のパターンが出るようにして、
 * スライダーが意味を持つようにしている。
 */
export const OFFBEAT_DOMINANCE_RELAXATION = 0.02

/** 食い込みと前の小節の裏拍がぶつかったとき、前の発音をずらす量(拍) */
export const COLLISION_SHIFT_BEATS = 0.5

/**
 * 発音がまったく無いパターン(Rest)で、コードが変わるために1発だけ足すときの位置。
 * 拍0に足すと白玉と区別が付かず「全音符が2回続く」状態を作ってしまうので、裏へ置く。
 */
export const FORCED_HIT_OFFBEAT = 1.5
export const FORCED_HIT_OFFBEAT_ACCENT = 6

/** 白玉の直後に「伸ばす」を選ぶなら、裏から入る(push)ほうを出やすくする倍率 */
export const PUSH_AFTER_WHOLE_BOOST = 2.5

export const COMP_PATTERNS: CompPattern[] = [
  {
    id: 'charleston',
    label: 'Charleston',
    density: GENERAL_DENSITIES,
    weight: 0.4,
    hits: [
      { beat: 0, durationBeats: 1.5, accent: 0 },
      { beat: 1.5, durationBeats: 0.5, accent: 6 },
    ],
  },
  {
    id: 'offbeats',
    label: 'Offbeats',
    density: GENERAL_DENSITIES,
    // 利用者の指摘:「このスタイルなら2裏、4裏だけでもいい(9.9割)」。
    // リズムの変化ではなくボイシングで聴かせるスタイルなので、ここを主役にする。
    // 密度スライダーを端へ振ったときだけ他のパターンが出る(densityMultiplier参照)。
    weight: 99,
    hits: [
      { beat: 1.5, durationBeats: 0.5, accent: 6 },
      { beat: 3.5, durationBeats: 0.5, accent: 4 },
    ],
  },
  {
    id: 'push',
    label: 'Push',
    density: GENERAL_DENSITIES,
    weight: 0.3,
    hits: [{ beat: -0.5, durationBeats: 2.0, accent: 6 }],
  },
  {
    id: 'whole',
    label: 'Whole',
    density: GENERAL_DENSITIES,
    weight: 0.1,
    hits: [{ beat: 0, durationBeats: 3.5, accent: 0 }],
  },
  {
    id: 'busy',
    label: 'Busy',
    density: GENERAL_DENSITIES,
    weight: 0.1,
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
    weight: 0.1,
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
