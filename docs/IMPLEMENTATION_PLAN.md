# 第1段階 実装仕様書

[DESIGN_v0.2.md](DESIGN_v0.2.md) の第1段階を実装するための、値まで決めた仕様です。設計書が「何を作るか」、こちらが「どう作るか」。

**この仕様書の原則**: 実装者が数値を勝手に決めない。迷ったらこの文書の値を使う。値がここに無い場合は、勝手に決めずに `src/music/constants.ts` に定数として置いて、決めた旨をコミットメッセージに書く。

**完了の定義**: `npm test` が green かつ `npm run build` が通ること。

---

## 0. 最重要の原則

### 0.1 パラメータは1箇所に集める

音の良し悪しは実装者（人でもAIでも）には判断できません。最終的に利用者が聴いて数値を動かします。したがって**初期値の精度より、後から動かせることのほうが重要**です。

スコアの重み、ベロシティ、スウィング比率、音域、確率 — これらは**すべて `src/music/constants.ts` に集約**し、ロジック中に数値リテラルを直接書かないこと。

```ts
// 悪い例
if (span > 16) return false

// 良い例
if (span > PLAYABILITY.handSpanMax) return false
```

### 0.2 試聴と書き出しは同じデータを見る

`Performance` を作るのは1箇所だけ。audio も midi もそれを読むだけ。**「試聴では鳴るが MIDI がズレる」という事故を構造的に防ぐ**のがこの段階の主目的です。

---

## 1. 型定義（src/music/types.ts に追加）

```ts
export type TrackId = 'piano' | 'bass'
export type Hand = 'left' | 'right'
export type DensityPreset = 'powell' | 'shell3' | 'standard' | 'thick'

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
```

**注意**: `startBeat` は拍単位の小数で持ち、tick への変換は `render/midi.ts` でのみ行う。audio 側は拍→秒へ変換する。両者が同じ `startBeat` を見ることが重要。

---

## 2. 定数（src/music/constants.ts 新規）

```ts
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
```

---

## 3. 実装の順番（この順で。前の段が終わるまで次に進まない）

### Step 1: 型と定数と IR の配管

1. `types.ts` に §1 の型を追加（既存の型は消さない）
2. `constants.ts` を新規作成（§2 をそのまま）
3. `perform.ts` を新規作成。まずは**ブロックコードのまま** `Take → Performance` を作る（リズムはまだ付けない）
4. `render/audio.ts` と `render/midi.ts` を、`Performance` を受け取る形に書き換える
5. 既存の `App.tsx` を、新しい経路で今までと同じ音が鳴るところまで直す

**この段の受け入れ条件**: 見た目も音も今までと変わらないこと。内部構造だけが変わっている状態。ここで一度コミットする。

### Step 2: 両手ボイシングと演奏可能性

6. `playability.ts` を新規作成。§2 の定数を使って判定
7. `vocab/index.ts`（レジストリ）と `vocab/rootless.ts`（既存テンプレートの移植）
8. `vocab/powell.ts` を新規作成（§4）
9. `voicings.ts` を「下部構造 × 上部構造」の組み立てに書き換え、density プリセットに対応

**受け入れ条件**: `playability` のテストが green。全 density プリセットで候補が1つ以上出る。

### Step 3: テイク探索

10. `score.ts`（§2 の重みを使う）
11. `take.ts`（ビームサーチ。§5）

**受け入れ条件**: randomness=0 で同じ入力から同じ結果が出る。全コードにボイシングが付く。

### Step 4: ベースとリズム

12. `bass.ts`（§6）
13. `comping.ts`（§7）
14. `humanize.ts`（§8）
15. `perform.ts` を本実装に差し替え（リズム適用、ベース合流）

**受け入れ条件**: ベースのテストが green。スウィングのテストが green。

### Step 5: 書き出しと UI

16. `render/midi.ts` を format 1 マルチトラックに（§9）
17. UI に density プリセット、スウィング、ベース ON/OFF、コーラス数を追加

---

## 4. Powell 語彙の仕様（vocab/powell.ts）

調査結果は [VOICING_RESEARCH.md §8](VOICING_RESEARCH.md)。

ルートを必ず最低音に置き、そこに以下のどれか1つを足す。

| 形 | 度数 | 適用するコード |
| --- | --- | --- |
| R7 | `1`, `b7` または `7` | dominant7, minor7, major7, sus7, halfDiminished, minorMajor7 |
| R3 | `1`, `3` または `b3` | すべて |
| R10 | `1`, `3` または `b3`（+1オクターブ） | すべて。**10度になるので幅16半音**。片手の幅上限ちょうど |
| R6 | `1`, `6` | major, major7, minor7（m6として） |
| 3音版 | `1`, `b7`, `3` / `1`, `7`, `3` / `1`, `b7`, `10` | shell3 プリセットで使う |

**dim7 は** `1`, `b3` と `1`, `bb7` を使う。

**実装上の注意**:
- `1-10` は `buildAscendingIntervals` に `['1', '3']` を渡すだけでは作れない（10度にならない）。度数に `10` / `b10` を追加し、`DEGREE_SEMITONES` に `'10': 16, 'b10': 15` を、`DEGREE_STEPS` に `'10': 2, 'b10': 2` を足すこと（綴りは3度と同じ文字になる）
- ルートの MIDI 位置は `powellLeftHand` の範囲で探す。低いほうを優先（ルート最低音が F2〜C3 あたりに来るのが Powell らしい）
- ii-V-I で R7 と R3 を交互に使うと上の音が半音で繋がる。これはスコア関数が勝手にやるので、語彙側で特別扱いしない

---

## 5. スコアとビームサーチ（score.ts / take.ts）

### 5.1 スコア（小さいほど良い）

```
score(prev, curr, context) =
    W.voiceLeading      * voiceLeadingDistance(prev, curr)
  + W.topLine           * topLinePenalty(prev, curr)      // TOP_LINE_PENALTY 表を引く
  + W.register          * registerPenalty(curr)           // 音域中心からの距離
  + W.familyVariety     * varietyPenalty(context.recentFamilies, curr.family)
  + W.noteCountStability* Math.abs(curr.noteCount - context.targetNoteCount)
  + W.wideSpanPenalty   * Math.max(0, span(curr) - PLAYABILITY.handSpanPreferred)
  - W.commonTone        * commonToneCount(prev, curr)
```

- `voiceLeadingDistance` は既存の `voicingDistance` を流用してよい
- `varietyPenalty`: 直近3つに同じ family が2回以上あれば `+1`、3回とも同じなら `+2`
- **最初のコード**には prev が無いので、`register` と `wideSpan` のみで評価する

### 5.2 ビームサーチ

```
1. 各コードの候補を score の register 項だけで並べ、上位 SEARCH.candidatesPerChord 件に絞る
2. ビーム（幅 SEARCH.beamWidth）で進行の末尾まで部分スコアを積む
3. 末尾に残った経路を累積スコア順に並べる
4. 既存の weightedChoice で randomness に応じて1本抽選
5. 1〜4 を SEARCH.takeCount 回まわす。voicings の midi 列が完全一致するテイクは捨てて引き直す（最大3回まで再試行）
```

**randomness = 0 のときは必ず最小スコアの経路を返すこと**（テストがこれを検証する）。

---

## 6. ウォーキングベース（bass.ts）

1拍1音。`RANGES.bass` の内側。

| 拍 | 選び方 |
| --- | --- |
| コード頭 | ルート（確率0.8）。残りは5度(0.12)か3度(0.08)。ただし直前の音と同じ MIDI になるなら別の音を選ぶ |
| 中間の拍 | コードトーンかスケール音。直前から2半音以内の動きを優先（候補スコアで距離を減点） |
| 次のコードの直前の拍 | **アプローチ音**。次のルートの半音上・半音下・スケール上の隣接音・次ルートの完全5度上、から抽選 |

**追加ルール**:
- 同じ方向に5音以上続いたら、次は反転を優先（延々と上がり続けるのを防ぐ）
- 直前と同じ音は避ける（どうしても他に無ければ許可）
- オクターブは前の音に最も近いものを選ぶ
- 1小節に2コードある場合も同じ考え方を2拍ずつに縮めて適用する

**Powell プリセットでベース ON のとき**: ピアノもルートを弾くので重複するが、これは歴史的に正しいので許可する。

---

## 7. コンピング（comping.ts）

```ts
export interface CompHit {
  beat: number            // 小節頭からの拍。負の値は前の小節への食い込み
  durationBeats: number
  accent: number          // ベロシティ加算
}
export interface CompPattern {
  id: string
  label: string
  density: DensityPreset[]   // どのプリセットで使うか
  weight: number             // 抽選の重み
  hits: CompHit[]
}
```

初期パターン（4拍子。3拍子・6拍子は第2段階で追加し、それまでは `whole` にフォールバック）:

| id | hits (beat, duration, accent) | weight |
| --- | --- | --- |
| `charleston` | (0, 1.5, 0), (1.5, 0.5, +6) | 3 |
| `offbeats` | (1.5, 0.5, +6), (3.5, 0.5, +4) | 2 |
| `push` | (-0.5, 2.0, +6) | 2 |
| `whole` | (0, 3.5, 0) | 2 |
| `busy` | (0, 0.5, 0), (1.5, 0.5, +6), (2.5, 0.5, 0), (3.5, 0.5, +4) | 1 |
| `rest` | なし | 1 |
| `powellJabs` | (0.5, 0.3, +4), (2.5, 0.3, +6), (3.5, 0.3, +4) | 3（powell/shell3 専用） |
| `powellSparse` | (1.5, 0.3, +6) | 2（powell/shell3 専用） |

**規則**:
- 小節ごとに重み付き抽選
- `rest` の直後に `rest` は選ばない
- **コードが変わる位置には必ず発音を1つ置く**（パターンにその位置の hit が無ければ追加する）。和音が鳴らない小節を作らない
- `push`（食い込み）は前の小節の終わりに食い込むので、曲頭の小節では使わない
- 密度スライダー（0〜100）は weight に掛ける係数。sparse 側では `whole` と `rest` の weight を2倍、`busy` を0.3倍。busy 側はその逆

---

## 8. 人間味（humanize.ts）

### 8.1 スウィング

```
swingRatio(tempo, userSwing) =
  userSwing が 0 なら 0.5（イーブン）
  auto の場合:
    tempo <= 160 → 0.62
    tempo >= 260 → 0.5
    その間は線形補間
```

適用: `startBeat` の小数部が 0.5 のイベントを `swingRatio` の位置へ移す。つまり `beat + 0.5` → `beat + swingRatio`。0.25/0.75 の位置（16分）は第1段階では扱わない。

### 8.2 ベロシティ

```
velocity = base
         + (裏拍なら offbeatAccent)
         + (和音の最高音なら topNoteBonus)
         + accent（パターン由来）
         + random(-jitter, +jitter)
→ min/max でクランプ
```

「裏拍」の定義: `startBeat` の小数部が 0.4〜0.9 の範囲にあるもの。

### 8.3 タイミングの揺れ

- 各イベントに ±`jitterTicks` のずれを加える
- 同じ和音の中では、下の音から順に `chordSpreadTicks` まで遅らせる（完全同時を避ける）
- **「きっちりモード」ON のときは 8.2 の jitter と 8.3 を丸ごと飛ばす**（スウィングは残す）
- ずれで `startBeat` が負にならないようクランプする

---

## 9. MIDI 書き出し（render/midi.ts）

format 0 → **format 1** に変更。

| トラック | 内容 |
| --- | --- |
| 0 | テンポ、拍子、トラック名 `Jazz Voicing Lab`、コード記号のマーカー（`0xFF 0x06`） |
| 1 | トラック名 `Piano`、program change 0、ピアノのイベント |
| 2 | トラック名 `Bass`、program change 32（Acoustic Bass）、ベースのイベント |

**実装上の注意**:
- ヘッダの format を `1`、トラック数を `3` にする
- **各トラックのイベントは startBeat でソートしてから delta time を計算する**。これが今回いちばんバグりやすい。ノートオフも含めて時刻順に並べてから差分を取ること
- tick = `Math.round(startBeat * TICKS_PER_QUARTER)`
- ベースを OFF にしたときはトラック2を出さない（トラック数を2にする）
- コーラス数 N のときは、**コーラスごとにテイクとリズムを引き直して**連結する
- ファイル名: `{進行の先頭コード}-{tempo}bpm-{YYYY-MM-DD}.mid`

---

## 10. テスト（npm test で green にすること）

`vitest` を devDependency に追加済み（`npm test` で実行）。テストは **`tests/` に置く**。`src/` ではない。

`tsconfig.json` の `include` が `src` で、GitHub Pages のデプロイが毎 push で `npm run build`（= `tsc --noEmit`）を走らせます。まだ存在しないモジュールを import するテストを `src/` に置くと**公開中のアプリのデプロイが壊れる**ため、`tests/` に分離しています。この配置は変えないこと。

**テストのファイルは既に書いてあり、実装前なのですべて red です。これを green にするのが第1段階のゴール。**

**重要**: テストの import 名・引数・戻り値が **API の契約**です。テストを書き換えて通すのは禁止。仕様のほうが間違っていると判断した場合は、書き換えずに報告してください。

| ファイル | 検証内容 |
| --- | --- |
| `playability.test.ts` | 幅16半音は通る／17半音は落ちる。手が交差したら落ちる。低音での長3度（E3未満）は落ちる。b9 の衝突判定 |
| `take.test.ts` | randomness=0 で決定的。全コードにボイシングが付く。density ごとに音数が範囲内 |
| `bass.test.ts` | 1拍1音。音域内。コード頭がルートである割合が妥当。最後の拍が次のルートへ2半音以内 |
| `humanize.test.ts` | スウィング比率のテンポ補正。裏拍が正しい位置へ移動する。きっちりモードで jitter が0 |
| `midi.test.ts` | format 1 のヘッダバイト列。トラック数。delta time が単調非減少。tick 変換 |

テストで音の良し悪しは判定しない（できない）。**壊れていないことだけ**を見る。

---

## 11. やらないこと（第1段階の範囲外）

- Quartal / So What / UST / Drop2 / Cluster（第2段階）
- 8テイクの並列表示（第2段階。内部では8本作るが、表示は1本でよい）
- トップラインの可視化（第2段階）
- iReal Pro 取り込み、ドラム、3拍子・6拍子のコンピングパターン（第3段階）
