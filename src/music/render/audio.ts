import { AUDIO } from '../constants'
import type { Performance } from '../types'

let audioContext: AudioContext | null = null
let activeOscillators: OscillatorNode[] = []
let loopTimer: number | null = null
let looping = false

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
  scheduleEvents(ctx, performance, ctx.currentTime + 0.06, secondsPerBeat)
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
  let nextStart = ctx.currentTime + 0.08

  const scheduleChorus = () => {
    if (!looping) return

    const secondsPerBeat = 60 / getTempo()
    const performance = buildChorus(chorusIndex)
    chorusIndex += 1

    scheduleEvents(ctx, performance, nextStart, secondsPerBeat)
    const chorusSeconds = performance.totalBeats * secondsPerBeat

    nextStart += chorusSeconds
    loopTimer = window.setTimeout(scheduleChorus, Math.max(60, (chorusSeconds - 0.4) * 1000))
  }

  scheduleChorus()
}
