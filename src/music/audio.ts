let audioContext: AudioContext | null = null
let activeOscillators: OscillatorNode[] = []
let loopTimer: number | null = null
let looping = false

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext()
  return audioContext
}

function frequencyFromMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function scheduleNote(ctx: AudioContext, midi: number, start: number, duration: number, gainValue = 0.055): void {
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
export async function startLoop(
  buildChorus: (chorusIndex: number) => number[][],
  getTiming: () => { tempo: number; beatsPerChord: number },
): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  stopPlayback()
  looping = true

  let chorusIndex = 0
  let nextStart = ctx.currentTime + 0.08

  const scheduleChorus = () => {
    if (!looping) return

    const { tempo, beatsPerChord } = getTiming()
    const secondsPerChord = (60 / tempo) * beatsPerChord
    const duration = Math.max(0.25, secondsPerChord * 0.82)

    const chords = buildChorus(chorusIndex)
    chorusIndex += 1

    chords.forEach((chord, index) => {
      const noteStart = nextStart + index * secondsPerChord
      chord.forEach((note) => scheduleNote(ctx, note, noteStart, duration, 0.045))
    })

    const chorusSeconds = chords.length * secondsPerChord
    nextStart += chorusSeconds
    loopTimer = window.setTimeout(scheduleChorus, Math.max(60, (chorusSeconds - 0.4) * 1000))
  }

  scheduleChorus()
}

export async function playSequence(midiChords: number[][], tempo: number, beatsPerChord: number): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const secondsPerChord = (60 / tempo) * beatsPerChord
  const start = ctx.currentTime + 0.06
  midiChords.forEach((chord, index) => {
    const noteStart = start + index * secondsPerChord
    const duration = Math.max(0.25, secondsPerChord * 0.82)
    chord.forEach((note) => scheduleNote(ctx, note, noteStart, duration, 0.045))
  })
}
