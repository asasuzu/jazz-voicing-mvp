import { TICKS_PER_QUARTER, TIMING, VELOCITY } from './constants'
import type { DensityPreset, PerformanceEvent } from './types'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §8 */
export type SwingSetting = 'auto' | number // 'auto'以外は0(イーブン)〜100のスウィング量(%)

/**
 * auto: 遅いテンポではTIMING.swingDefaultRatio、速いテンポではイーブンへ線形に寄る。
 * 数値指定: 0でTIMING.swingRatioMin(イーブン)、100でTIMING.swingRatioMaxになるよう線形補間する。
 */
export function swingRatio(tempo: number, swing: SwingSetting): number {
  if (swing !== 'auto') {
    const amount = Math.max(0, Math.min(100, swing)) / 100
    return TIMING.swingRatioMin + amount * (TIMING.swingRatioMax - TIMING.swingRatioMin)
  }
  if (tempo <= TIMING.swingFlattenStartBpm) return TIMING.swingDefaultRatio
  if (tempo >= TIMING.swingFlattenEndBpm) return TIMING.swingRatioMin
  const t = (tempo - TIMING.swingFlattenStartBpm) / (TIMING.swingFlattenEndBpm - TIMING.swingFlattenStartBpm)
  return TIMING.swingDefaultRatio - t * (TIMING.swingDefaultRatio - TIMING.swingRatioMin)
}

// 小数第3位までの誤差は「ちょうど8分裏(0.5)」とみなす。浮動小数の丸め対策。
const OFFBEAT_EPSILON = 1e-3

/** startBeatの小数部が0.5(8分裏)のイベントだけをratioの位置へ移す */
export function applySwing(startBeat: number, ratio: number): number {
  const beatIndex = Math.floor(startBeat + 1e-6)
  const fraction = startBeat - beatIndex
  if (Math.abs(fraction - 0.5) < OFFBEAT_EPSILON) return beatIndex + ratio
  return startBeat
}

/** 裏拍の定義: startBeatの小数部が0.4〜0.9の範囲(仕様書§8.2) */
function isOffbeat(startBeat: number): boolean {
  const fraction = startBeat - Math.floor(startBeat)
  return fraction >= 0.4 && fraction <= 0.9
}

function ticksToBeats(ticks: number): number {
  return ticks / TICKS_PER_QUARTER
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export interface HumanizeOptions {
  strict: boolean
  tempo: number
  swing: SwingSetting
  /** powell/shell3のときはVELOCITY.powellプロファイルを使う。省略時はpiano/bassの既定値。 */
  density?: DensityPreset
  /** ベースの「1拍目」判定に使う。省略時は4拍子として扱う。 */
  beatsPerBar?: number
}

/**
 * pianoとbassでVELOCITY定数の形が違う(bassには裏拍アクセントもトップノートも無く、
 * 代わりに1拍目アクセントがある)ので、track別にアクセント量を計算する関数として統一する。
 */
function accentFor(event: PerformanceEvent, isTopNote: boolean, density: DensityPreset | undefined, beatsPerBar: number): number {
  if (event.track === 'bass') {
    const bar = beatsPerBar > 0 ? Math.floor(event.startBeat) % beatsPerBar : 0
    return bar === 0 ? VELOCITY.bass.downbeatAccent : 0
  }
  const profile = density === 'powell' || density === 'shell3' ? VELOCITY.powell : VELOCITY.piano
  return (isOffbeat(event.startBeat) ? profile.offbeatAccent : 0) + (isTopNote ? profile.topNoteBonus : 0)
}

function jitterRangeFor(track: PerformanceEvent['track'], density?: DensityPreset): number {
  if (track === 'bass') return VELOCITY.bass.jitter
  return density === 'powell' || density === 'shell3' ? VELOCITY.powell.jitter : VELOCITY.piano.jitter
}

function clampRangeFor(track: PerformanceEvent['track'], density?: DensityPreset): { min: number; max: number } {
  const profile = track === 'bass' ? VELOCITY.bass : density === 'powell' || density === 'shell3' ? VELOCITY.powell : VELOCITY.piano
  return { min: profile.min, max: profile.max }
}

/**
 * PerformanceEventの生成時にすべての人間味を適用する(仕様書§9)。
 * 渡されたevent.velocityは「base + コンピングパターンのaccent」まで計算済みという前提で、
 * ここでは裏拍アクセント・トップノートボーナス・ジッターを上乗せするだけにする
 * (perform.tsがコンピングのaccentを織り込んでからhumanizeを呼ぶ)。
 */
export function humanize(events: PerformanceEvent[], options: HumanizeOptions): PerformanceEvent[] {
  const ratio = swingRatio(options.tempo, options.swing)

  // スウィングはきっちりモードでも残る(仕様書§8.3)
  const swung = events.map((event) => ({ ...event, startBeat: applySwing(event.startBeat, ratio) }))

  if (options.strict) {
    return swung
      .map((event) => ({ ...event, startBeat: Math.max(0, event.startBeat) }))
      .sort((a, b) => a.startBeat - b.startBeat)
  }

  // 同じtrack・同じ拍位置にある音をまとめて「和音」として扱う(トップノート判定とスプレッド用)
  const groups = new Map<string, PerformanceEvent[]>()
  swung.forEach((event) => {
    const key = `${event.track}@${event.startBeat.toFixed(6)}`
    const list = groups.get(key)
    if (list) list.push(event)
    else groups.set(key, [event])
  })

  const beatsPerBar = options.beatsPerBar ?? 4
  const result: PerformanceEvent[] = []
  groups.forEach((group) => {
    const sortedByPitch = [...group].sort((a, b) => a.midi - b.midi)
    const topMidi = sortedByPitch[sortedByPitch.length - 1].midi

    sortedByPitch.forEach((event, indexInChord) => {
      const jitterTicks = event.track === 'piano' ? TIMING.pianoJitterTicks : TIMING.bassJitterTicks
      // 和音内は下から順にchordSpreadTicksまでずらし、そこへさらに±jitterTicksを足す
      const spreadTicks =
        sortedByPitch.length > 1 ? (indexInChord / (sortedByPitch.length - 1)) * TIMING.chordSpreadTicks : 0
      const timingOffsetBeats = ticksToBeats(spreadTicks + randomBetween(-jitterTicks, jitterTicks))

      const isTopNote = event.midi === topMidi
      const jitterRange = jitterRangeFor(event.track, options.density)
      const { min, max } = clampRangeFor(event.track, options.density)

      let velocity = event.velocity
      velocity += accentFor(event, isTopNote, options.density, beatsPerBar)
      velocity += randomBetween(-jitterRange, jitterRange)
      velocity = Math.round(Math.max(min, Math.min(max, velocity)))

      result.push({
        ...event,
        startBeat: Math.max(0, event.startBeat + timingOffsetBeats),
        velocity,
      })
    })
  })

  return result.sort((a, b) => a.startBeat - b.startBeat)
}
