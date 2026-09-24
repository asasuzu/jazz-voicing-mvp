/**
 * 入力欄に入れられる例の進行。iReal Pro のように「選んですぐ鳴らせる」ためのもの。
 *
 * どれもジャズでよく出る型で、ループしたときに頭へ戻れる形にしてある
 * (3小節のような半端な長さだと、ループで小節を数えられなくなる。docs/FEEDBACK_01.md §1)。
 * コード進行そのものには著作権が無いので、曲の骨組みは「〜風」として載せている。
 */
export interface ProgressionPreset {
  id: string
  name: string
  /** ジャズに詳しくない人向けの一言説明 */
  description: string
  progression: string
}

export const PROGRESSION_PRESETS: ProgressionPreset[] = [
  {
    id: 'turnaround',
    name: '1-6-2-5 ターンアラウンド',
    description: '曲の終わりから頭へ戻るときの定番のつなぎ',
    progression: 'Cmaj7 | A7alt | Dm7 | G7',
  },
  {
    id: 'major-251',
    name: 'ツー・ファイブ・ワン',
    description: 'ジャズで一番よく出る型。まずはここから',
    progression: 'Dm7 | G7 | Cmaj7 | Cmaj7',
  },
  {
    id: 'minor-251',
    name: 'マイナーのツー・ファイブ・ワン',
    description: '暗い響きの型。m7b5・alt・m6の響きが出る',
    progression: 'Dm7b5 | G7alt | Cm6 | Cm6',
  },
  {
    id: 'tritone-sub',
    name: '裏コード',
    description: 'G7を半音上のDb7に置き換えた、ジャズらしい響き',
    progression: 'Dm7 | Db7 | Cmaj7 | Cmaj7',
  },
  {
    id: 'f-blues',
    name: 'ジャズブルース(F)',
    description: 'セッションで一番よく演奏される12小節',
    progression: 'F7 | Bb7 | F7 | Cm7 F7 | Bb7 | Bdim7 | F7 | D7alt | Gm7 | C7 | F7 D7 | Gm7 C7',
  },
  {
    id: 'autumn',
    name: '枯葉風',
    description: '有名なスタンダード曲の骨組み。明るい型と暗い型が両方入る',
    progression: 'Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7alt | Gm6 | Gm6',
  },
]

/** 起動時に入力欄へ入っている進行 */
export const DEFAULT_PRESET = PROGRESSION_PRESETS[0]
