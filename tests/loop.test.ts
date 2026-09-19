import { describe, expect, it } from 'vitest'
import { clampChorusStart, computeScheduleDelayMs } from '../src/music/render/audio'
import { TIMING } from '../src/music/constants'

/**
 * 仕様: docs/FEEDBACK_01.md §3(何コーラス目からか変になるバグ)。
 *
 * 調査の結果、当初の仮説(「nextStartが現在時刻より過去になる」)そのものではなく、
 * 同じ関数の中にあった別のバグが原因だった。
 *
 * 実測(260BPM・3小節ループ、修正前のコードにログを仕込んで計測):
 *   chorus=0 drift=0.080s
 *   chorus=1 drift=0.481s
 *   chorus=2 drift=0.861s
 *   chorus=3 drift=1.246s
 *   chorus=4 drift=1.634s
 *   chorus=5 drift=2.022s
 * (drift = nextStart - ctx.currentTime。周を追うごとに約0.4秒ずつ際限なく増え続けていた)
 *
 * 原因: 次回呼び出しまでの待ち時間を `chorusSeconds - lookahead` という「テンポと
 * 拍数だけから決まる固定値」で計算していた。nextStartは1周ごとにchorusSeconds分
 * 進むのに、実時間は待ち時間の分(chorusSeconds - lookahead)しか進まないので、
 * 両者の差が1周ごとにlookahead秒ずつ開いていく。過去になるのではなく、逆に
 * 「実際に鳴っている時刻よりどんどん先まで予約され続ける」形で蓄積していた。
 * 音の開始時刻自体はズレないが、まだ鳴っていないOscillatorNode
 * (src/music/render/audio.ts の activeOscillators)が周を追うごとに積み上がり、
 * 「何周かしてから重くなって変になる」の原因になっていたと考えられる。
 *
 * 修正後に同じ条件で再計測すると、driftは0.4秒付近で安定した
 * (chorus=1〜14の実測値はすべて0.395〜0.417sの範囲に収まった)。
 *
 * この事情から、下限クランプ(clampChorusStart)は「仮説通りの過去化」に対する保険として
 * 残しつつ、本質的な修正は computeScheduleDelayMs 側(次回待ち時間を毎回
 * currentTimeから逆算する)にある。
 */

describe('clampChorusStart', () => {
  it('nextStartが現在時刻+下限先読みより過去なら、その値へ引き上げる', () => {
    expect(clampChorusStart(10, 12, 0.05)).toBeCloseTo(12.05, 5)
  })

  it('nextStartがすでに十分先なら、そのまま返す', () => {
    expect(clampChorusStart(20, 12, 0.05)).toBe(20)
  })
})

describe('computeScheduleDelayMs', () => {
  it('先読み時間ぶんを差し引いた待ち時間をmsで返す', () => {
    // nextStart=10, currentTime=2, lookahead=0.4 → (10-2-0.4)*1000 = 7600ms
    expect(computeScheduleDelayMs(10, 2, 0.4, 60)).toBeCloseTo(7600, 5)
  })

  it('計算結果が下限を下回るときは下限にクランプする', () => {
    expect(computeScheduleDelayMs(2.1, 2, 0.4, 60)).toBe(60)
  })
})

/**
 * ループ全体の回帰テスト。AudioContextを使わず、スケジューラの時刻計算だけを
 * 切り出したシミュレーションで検証する(FEEDBACK_01.md §3の指示どおり)。
 *
 * 「実際の再生」を、setTimeoutが指示どおりの遅延で正確に発火する理想的なタイマーとして
 * 模擬する: 各周でcurrentTimeをそのまま計算後のdelayぶん進める。
 */
function simulateLoop(cycles: number, chorusSeconds: number) {
  let currentTime = 0
  let nextStart = currentTime + TIMING.loopInitialLeadSeconds
  const drifts: number[] = []

  for (let i = 0; i < cycles; i += 1) {
    drifts.push(nextStart - currentTime)

    const scheduledStart = clampChorusStart(nextStart, currentTime, TIMING.loopMinLookaheadSeconds)
    nextStart = scheduledStart + chorusSeconds
    const delayMs = computeScheduleDelayMs(nextStart, currentTime, TIMING.loopLookaheadSeconds, TIMING.loopMinTimerMs)

    // 次のscheduleChorus発火まで、理想的なタイマーとして時間を進める
    currentTime += delayMs / 1000
  }

  return drifts
}

describe('ループ再生スケジューラの回帰テスト(FEEDBACK_01.md §3)', () => {
  it('周を重ねても nextStart と currentTime の差(drift)が際限なく増え続けない', () => {
    const drifts = simulateLoop(50, 2.769) // 260BPM・3小節(12拍)相当

    // 修正前は約0.4秒/周で増え続けていた(実測ログを参照)。
    // 修正後は定常状態でlookahead(0.4秒)付近に収まるはず。
    const early = drifts[5]
    const late = drifts[49]
    expect(Math.abs(late - early)).toBeLessThan(0.05)
    expect(late).toBeGreaterThan(0)
    expect(late).toBeLessThan(TIMING.loopLookaheadSeconds + 0.2)
  })

  it('テンポが違って1周の長さが変わっても、driftは同様に安定する', () => {
    const drifts = simulateLoop(40, 1.2) // 速いテンポ・短い進行を想定
    const early = drifts[5]
    const late = drifts[39]
    expect(Math.abs(late - early)).toBeLessThan(0.05)
  })

  it('buildChorusの遅延でcurrentTimeがnextStartへ迫っても、過去の時刻で予約しない', () => {
    // 仮説(a)そのもの: 重い処理でscheduleChorus実行が遅れ、nextStartを追い越すケース。
    const nextStart = 10
    const currentTimeAfterHeavyWork = 10.3 // nextStartを追い越してしまった状況を模擬
    const scheduledStart = clampChorusStart(nextStart, currentTimeAfterHeavyWork, TIMING.loopMinLookaheadSeconds)
    expect(scheduledStart).toBeGreaterThanOrEqual(currentTimeAfterHeavyWork + TIMING.loopMinLookaheadSeconds)
  })
})
