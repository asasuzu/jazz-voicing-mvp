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

function scheduleNote(ctx: AudioContext, midi: number, start: number, duration: number, gainValue = 0.13): void {
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

export async function playChord(midi: number[], duration = 1.15): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const start = ctx.currentTime + 0.03
  midi.forEach((note) => scheduleNote(ctx, note, start, duration))
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

/**
 * 各コーラスの直前に buildChorus を呼ぶので、1周ごとに違うボイシングを差し込める。
 */
export interface TimedChord {
  midi: number[]
  beats: number
}

export async function startLoop(
  buildChorus: (chorusIndex: number) => TimedChord[],
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
    const chords = buildChorus(chorusIndex)
    chorusIndex += 1

    let cursor = nextStart
    let chorusSeconds = 0
    chords.forEach((chord) => {
      const chordSeconds = chord.beats * secondsPerBeat
      const duration = Math.max(0.2, chordSeconds * 0.82)
      chord.midi.forEach((note) => scheduleNote(ctx, note, cursor, duration, 0.11))
      cursor += chordSeconds
      chorusSeconds += chordSeconds
    })

    nextStart += chorusSeconds
    loopTimer = window.setTimeout(scheduleChorus, Math.max(60, (chorusSeconds - 0.4) * 1000))
  }

  scheduleChorus()
}

export async function playSequence(chords: TimedChord[], tempo: number): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const secondsPerBeat = 60 / tempo
  let cursor = ctx.currentTime + 0.06
  chords.forEach((chord) => {
    const chordSeconds = chord.beats * secondsPerBeat
    const duration = Math.max(0.2, chordSeconds * 0.82)
    chord.midi.forEach((note) => scheduleNote(ctx, note, cursor, duration, 0.11))
    cursor += chordSeconds
  })
}
