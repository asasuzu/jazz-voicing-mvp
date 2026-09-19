import { DENSITY, SEARCH } from './constants'
import { registerOnlyScore, score } from './score'
import type { ScoreContext } from './score'
import { parseProgression } from './theory'
import type { DensityPreset, ParsedChord, Take, Voicing } from './types'
import { generateVoicingsForChord, weightedChoice } from './voicings'

/** 仕様: docs/IMPLEMENTATION_PLAN.md §5.2 */
export interface GenerateTakesOptions {
  density: DensityPreset
  randomness: number
  topLineWeight: number
  beatsPerBar: number
  withBass: boolean
  /**
   * 直前のコーラスの最後のボイシング。渡すと、最初のコードをこれに繋がるように選ぶ。
   *
   * ループ再生は1周ごとに独立したテイクを引き直すので、これが無いと継ぎ目が
   * 「無関係な2つのテイクの端どうし」になる。実測で、進行の中の平均移動量が14に
   * 対して継ぎ目は24だった(docs/FEEDBACK_01.md §5)。
   */
  previousVoicing?: Voicing
}

interface BeamPath {
  voicings: Voicing[]
  cumulativeScore: number
  recentFamilies: string[] // 直近3件のfamily(varietyPenalty用)
}

function pushRecentFamily(recent: string[], family: string): string[] {
  const next = [...recent, family]
  return next.length > 3 ? next.slice(next.length - 3) : next
}

function takeKey(take: Take): string {
  return take.voicings.map((voicing) => [...voicing.left, ...voicing.right].join('.')).join('|')
}

/**
 * ビームサーチで進行全体を1本選ぶ。手順は仕様書§5.2の1〜4:
 * 1. 各コードの候補はcandidatesPerChordで既にregister項だけで絞り込み済み
 * 2. 幅SEARCH.beamWidthで末尾まで部分スコアを積む
 * 3. 末尾に残った経路を累積スコア順に並べる
 * 4. 既存のweightedChoiceでrandomnessに応じて1本抽選する
 */
function pickOneTake(
  chords: ParsedChord[],
  candidatesPerChord: Voicing[][],
  options: GenerateTakesOptions,
  targetNoteCount: number,
): Take {
  const contextFor = (recentFamilies: string[]): ScoreContext => ({
    density: options.density,
    recentFamilies,
    targetNoteCount,
    topLineWeight: options.topLineWeight,
  })

  const previous = options.previousVoicing ?? null
  let beam: BeamPath[] = candidatesPerChord[0].map((candidate) => ({
    voicings: [candidate],
    cumulativeScore: score(previous, candidate, contextFor([])),
    recentFamilies: [candidate.family],
  }))
  beam.sort((a, b) => a.cumulativeScore - b.cumulativeScore)
  beam = beam.slice(0, SEARCH.beamWidth)

  for (let chordIndex = 1; chordIndex < chords.length; chordIndex += 1) {
    const expanded: BeamPath[] = []
    beam.forEach((path) => {
      const prev = path.voicings[path.voicings.length - 1]
      candidatesPerChord[chordIndex].forEach((candidate) => {
        const stepScore = score(prev, candidate, contextFor(path.recentFamilies))
        expanded.push({
          voicings: [...path.voicings, candidate],
          cumulativeScore: path.cumulativeScore + stepScore,
          recentFamilies: pushRecentFamily(path.recentFamilies, candidate.family),
        })
      })
    })
    expanded.sort((a, b) => a.cumulativeScore - b.cumulativeScore)
    beam = expanded.slice(0, SEARCH.beamWidth)
  }

  // 前のコーラスから繋ぐ指定が無いときは、このテイク単体が繰り返される前提で
  // 末尾→先頭の接続も評価する。単発で書き出した1コーラスをDAWでループさせても
  // 継ぎ目が飛ばないようにするため。
  const scored = beam.map((path) => {
    if (previous) return path
    const first = path.voicings[0]
    const last = path.voicings[path.voicings.length - 1]
    return {
      ...path,
      cumulativeScore: path.cumulativeScore + score(last, first, contextFor(path.recentFamilies)),
    }
  })

  scored.sort((a, b) => a.cumulativeScore - b.cumulativeScore)
  const chosen = weightedChoice(
    scored,
    scored.map((path) => path.cumulativeScore),
    options.randomness,
  )

  return {
    id: `take-${Math.random().toString(36).slice(2, 10)}`,
    voicings: chosen.voicings,
    chords,
    score: chosen.cumulativeScore,
  }
}

export function generateTakes(input: string, options: GenerateTakesOptions): Take[] {
  const chords = parseProgression(input, options.beatsPerBar)
  const density = options.density
  const config = DENSITY[density]
  const targetNoteCount = (config.totalNotes[0] + config.totalNotes[1]) / 2

  // 各コードの候補をregister項だけで並べ、上位SEARCH.candidatesPerChord件に絞る(§5.2手順1)
  const candidatesPerChord: Voicing[][] = chords.map((chord) => {
    const raw = generateVoicingsForChord(chord, { density, withBass: options.withBass })
    if (raw.length === 0) {
      throw new Error(`${chord.symbol} は現在の設定(${density})では候補を作れません。`)
    }
    return [...raw]
      .sort((a, b) => registerOnlyScore(a, density) - registerOnlyScore(b, density))
      .slice(0, SEARCH.candidatesPerChord)
  })

  const takes: Take[] = []
  const seenKeys = new Set<string>()
  const MAX_RETRIES = 3 // 仕様書§5.2: 完全一致するテイクは最大3回まで引き直す

  for (let i = 0; i < SEARCH.takeCount; i += 1) {
    let take = pickOneTake(chords, candidatesPerChord, options, targetNoteCount)
    let retries = 0
    while (seenKeys.has(takeKey(take)) && retries < MAX_RETRIES) {
      take = pickOneTake(chords, candidatesPerChord, options, targetNoteCount)
      retries += 1
    }
    seenKeys.add(takeKey(take))
    takes.push(take)
  }

  return takes
}
