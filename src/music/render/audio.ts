import { AUDIO, TIMING } from '../constants'
import type { Performance } from '../types'

let audioContext: AudioContext | null = null
let activeOscillators: OscillatorNode[] = []
let loopTimer: number | null = null
let looping = false

/**
 * 「今どのコードが鳴っているか」を画面に出すための再生位置。
 *
 * Web Audioは1コーラス分をまとめて先に予約してしまうので、音が鳴る瞬間に
 * 呼ばれるコールバックは無い。代わりに、予約したコーラスの開始時刻と
 * 1拍の長さを覚えておき、画面側がAudioContextの時計を見て位置を計算する。
 *
 * ループ再生では次のコーラスを0.4秒ほど先に予約するので、予約済みの区間が
 * 一時的に2つ並ぶ。1つだけ持つと、まだ鳴っていない次のコーラスで
 * 上書きされてしまうため、区間を並べて現在時刻が入るものを選ぶ。
 */
interface ScheduledChorus {
  startTime: number
  secondsPerBeat: number
  totalBeats: number
  chorusIndex: number
}

let scheduledChoruses: ScheduledChorus[] = []

export interface PlaybackPosition {
  /** コーラス先頭からの拍(小数) */
  beat: number
  chorusIndex: number
}

export function getPlaybackPosition(): PlaybackPosition | null {
  if (!audioContext || scheduledChoruses.length === 0) return null
  const now = audioContext.currentTime

  // 終わった区間は捨てる。残っているもののうち、現在時刻を含むものを使う。
  scheduledChoruses = scheduledChoruses.filter(
    (entry) => now < entry.startTime + entry.totalBeats * entry.secondsPerBeat,
  )
  const current = scheduledChoruses.find((entry) => now >= entry.startTime)
  if (!current) return null

  return {
    beat: (now - current.startTime) / current.secondsPerBeat,
    chorusIndex: current.chorusIndex,
  }
}

function getAudioContext(): AudioContext {
  if (audioContext) return audioContext

  // iOSは既定だと本体の消音スイッチでWeb Audioが無音になる。playbackにすると鳴る。
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'

  audioContext = new AudioContext()

  // 古いiOSはresumeだけでは開かないので、ジェスチャ中に無音バッファを1回鳴らして解除する。
  const unlock = audioContext.createBufferSource()
  unlock.buffer = audioContext.createBuffer(1, 1, 22050)
  unlock.connect(audioContext.destination)
  unlock.start(0)

  return audioContext
}

function frequencyFromMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** MIDI velocity(1–127) を試聴シンセのゲインへ変換する */
function gainFromVelocity(velocity: number, bonus = 1): number {
  return velocity * AUDIO.gainPerVelocity * bonus
}

function scheduleNote(ctx: AudioContext, midi: number, start: number, duration: number, gainValue: number): void {
  const fundamental = ctx.createOscillator()
  const upper = ctx.createOscillator()
  const gain = ctx.createGain()
  const upperGain = ctx.createGain()

  fundamental.type = 'triangle'
  upper.type = 'sine'
  fundamental.frequency.value = frequencyFromMidi(midi)
  upper.frequency.value = frequencyFromMidi(midi) * 2

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  upperGain.gain.setValueAtTime(0.0001, start)
  upperGain.gain.exponentialRampToValueAtTime(gainValue * 0.18, start + 0.018)
  upperGain.gain.exponentialRampToValueAtTime(0.0001, start + Math.min(duration, 0.55))

  fundamental.connect(gain).connect(ctx.destination)
  upper.connect(upperGain).connect(ctx.destination)

  fundamental.start(start)
  upper.start(start)
  fundamental.stop(start + duration + 0.03)
  upper.stop(start + duration + 0.03)

  activeOscillators.push(fundamental, upper)
  fundamental.onended = () => {
    activeOscillators = activeOscillators.filter((osc) => osc !== fundamental && osc !== upper)
  }
}

/** 1つのボイシングだけを単発で試聴する（カードの「Play chord」ボタン用） */
export async function playChord(midi: number[], duration = 1.15): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const start = ctx.currentTime + 0.03
  midi.forEach((note) => scheduleNote(ctx, note, start, duration, gainFromVelocity(82, AUDIO.previewGainBonus)))
}

export function stopPlayback(): void {
  looping = false
  if (loopTimer !== null) {
    clearTimeout(loopTimer)
    loopTimer = null
  }
  activeOscillators.forEach((osc) => osc.stop())
  activeOscillators = []
  scheduledChoruses = []
}

/** durationBeats いっぱいまで伸ばさず、少し切って粒立ちを出す。仕様に無い値なので決め打ち。 */
const NOTE_SUSTAIN_RATIO = 0.82
const MIN_NOTE_SECONDS = 0.2

function scheduleEvents(ctx: AudioContext, performance: Performance, baseStart: number, secondsPerBeat: number): void {
  performance.events.forEach((event) => {
    const start = baseStart + event.startBeat * secondsPerBeat
    const duration = Math.max(MIN_NOTE_SECONDS, event.durationBeats * secondsPerBeat * NOTE_SUSTAIN_RATIO)
    scheduleNote(ctx, event.midi, start, duration, gainFromVelocity(event.velocity))
  })
}

/** 試聴も書き出しも同じ Performance を見る(仕様書 §0.2)。 */
export async function playPerformance(performance: Performance, tempo: number): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const secondsPerBeat = 60 / tempo
  const start = ctx.currentTime + 0.06
  scheduleEvents(ctx, performance, start, secondsPerBeat)
  scheduledChoruses = [{ startTime: start, secondsPerBeat, totalBeats: performance.totalBeats, chorusIndex: 0 }]
}

/**
 * nextStart(次のコーラスの開始時刻)が現在時刻より過去にならないようにする下限クランプ。
 * FEEDBACK_01.md §3 で疑われていた「タイマーが遅れてnextStartが過去になる」ケースへの
 * 保険。AudioContextに依存しない純粋関数にして tests/loop.test.ts から検証できるようにする。
 */
export function clampChorusStart(nextStart: number, currentTime: number, minLookahead: number): number {
  return Math.max(nextStart, currentTime + minLookahead)
}

/**
 * 次にscheduleChorusを呼び直すまでの待ち時間(ms)を、実際に残っている先読み時間から逆算する。
 *
 * 元の実装は `chorusSeconds - lookahead` を待ち時間に使っていた。nextStartは1周ごとに
 * chorusSeconds分だけ進むのに、実時間は待ち時間の分(chorusSeconds - lookahead)しか
 * 進まないため、両者の差が1周ごとにlookahead秒ずつ際限なく開いていく
 * (実測で確認: FEEDBACK_01.md §3 の調査結果を参照)。音の開始時刻自体はズレないが、
 * 実際に鳴るよりずっと先の分まで毎周オシレーターを作り続けることになり、蓄積した
 * 未再生のOscillatorNodeが「何周かしてから重くなって変になる」の原因になっていた。
 * 現在時刻を毎回読み直して逆算すれば、定常状態でのnextStartとcurrentTimeの差は
 * lookahead秒あたりで安定し、際限なく開いていかない。
 */
export function computeScheduleDelayMs(
  nextStart: number,
  currentTime: number,
  lookahead: number,
  minDelayMs: number,
): number {
  return Math.max(minDelayMs, (nextStart - currentTime - lookahead) * 1000)
}

/**
 * 各コーラスの直前に buildChorus を呼ぶので、1周ごとに違う Performance を差し込める。
 */
export async function startPerformanceLoop(
  buildChorus: (chorusIndex: number) => Performance,
  getTempo: () => number,
): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  stopPlayback()
  looping = true

  let chorusIndex = 0
  let nextStart = ctx.currentTime + TIMING.loopInitialLeadSeconds

  const scheduleChorus = () => {
    if (!looping) return

    const secondsPerBeat = 60 / getTempo()
    const thisChorus = chorusIndex
    const performance = buildChorus(chorusIndex)
    chorusIndex += 1

    // 仮説どおり、buildChorus(ビームサーチ含む)に時間がかかってnextStartを
    // 追い越してしまう可能性への保険として下限クランプを入れる。
    const scheduledStart = clampChorusStart(nextStart, ctx.currentTime, TIMING.loopMinLookaheadSeconds)
    scheduleEvents(ctx, performance, scheduledStart, secondsPerBeat)
    scheduledChoruses.push({
      startTime: scheduledStart,
      secondsPerBeat,
      totalBeats: performance.totalBeats,
      chorusIndex: thisChorus,
    })
    const chorusSeconds = performance.totalBeats * secondsPerBeat

    nextStart = scheduledStart + chorusSeconds
    const delayMs = computeScheduleDelayMs(nextStart, ctx.currentTime, TIMING.loopLookaheadSeconds, TIMING.loopMinTimerMs)
    loopTimer = window.setTimeout(scheduleChorus, delayMs)
  }

  scheduleChorus()
}
