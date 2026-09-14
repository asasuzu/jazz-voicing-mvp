import { useEffect, useMemo, useRef, useState } from 'react'
import { playChord, playPerformance, startPerformanceLoop, stopPlayback } from './music/render/audio'
import { downloadMidi } from './music/render/midi'
import { buildPerformance } from './music/perform'
import type { GeneratedVoicing, PlayContext, Take } from './music/types'
import { generateProgressionVoicings, RANGE_PRESETS } from './music/voicings'

const DEFAULT_PROGRESSION = 'Dm7 G7 | Cmaj7 | A7alt'

/**
 * voicings.ts はまだ片手前提(GeneratedVoicing)のまま。Step2/3 で vocab + take.ts に
 * 置き換わるまでの橋渡しとして、ここだけで Take へ変換する。
 * 両手の区別が無いので、全音を左手側に積む(Powell 的な単手の扱い)。
 */
function toTake(voicings: GeneratedVoicing[]): Take {
  return {
    id: 'legacy-single-hand',
    voicings: voicings.map((voicing) => ({
      family: voicing.id,
      label: voicing.label,
      left: voicing.midi,
      right: [],
      degrees: voicing.degrees,
    })),
    chords: voicings.map((voicing) => voicing.chord),
    score: 0,
  }
}

function App() {
  const [progression, setProgression] = useState(DEFAULT_PROGRESSION)
  const [context, setContext] = useState<PlayContext>('combo')
  const [rangeId, setRangeId] = useState('lh')
  const [colorful, setColorful] = useState(true)
  const [randomness, setRandomness] = useState(0.38)
  const [tempo, setTempo] = useState(180)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [voicings, setVoicings] = useState<GeneratedVoicing[]>([])
  const [error, setError] = useState('')
  const [looping, setLooping] = useState(false)
  const [chorus, setChorus] = useState(0)

  const selectedRange = useMemo(
    () => RANGE_PRESETS.find((range) => range.id === rangeId) ?? RANGE_PRESETS[0],
    [rangeId],
  )

  const generateOptions = useMemo(
    () => ({ context, range: selectedRange, colorful, randomness, beatsPerBar }),
    [context, selectedRange, colorful, randomness, beatsPerBar],
  )

  // ループ再生中にテンポ/設定を動かしても次のコーラスから反映させる
  const liveRef = useRef({ tempo, generateOptions })
  useEffect(() => {
    liveRef.current = { tempo, generateOptions }
  }, [tempo, generateOptions])

  const changeTempo = (value: number) => setTempo(Math.min(300, Math.max(40, Math.round(value))))

  const generate = () => {
    stopLoop()
    try {
      setError('')
      const next = generateProgressionVoicings(progression, generateOptions)
      setVoicings(next)
    } catch (caught) {
      setVoicings([])
      setError(caught instanceof Error ? caught.message : '生成に失敗しました。')
    }
  }

  const stopLoop = () => {
    stopPlayback()
    setLooping(false)
  }

  const beginLoop = () => {
    setLooping(true)
    startPerformanceLoop(
      (chorusIndex) => {
        const nextVoicings = generateProgressionVoicings(progression, liveRef.current.generateOptions)
        setVoicings(nextVoicings)
        setChorus(chorusIndex + 1)
        return buildPerformance(toTake(nextVoicings), {
          tempo: liveRef.current.tempo,
          beatsPerBar: liveRef.current.generateOptions.beatsPerBar,
        })
      },
      () => liveRef.current.tempo,
    )
  }

  const barsOf = (items: GeneratedVoicing[]) => {
    const bars: { voicing: GeneratedVoicing; index: number }[][] = []
    items.forEach((voicing, index) => {
      const bar = bars[bars.length - 1]
      if (bar && bar[0].voicing.chord.barIndex === voicing.chord.barIndex) {
        bar.push({ voicing, index })
      } else {
        bars.push([{ voicing, index }])
      }
    })
    return bars
  }

  const movementLabel = (movement?: number) => {
    if (movement === undefined) return 'start'
    if (movement <= 6) return `move ${movement} · very smooth`
    if (movement <= 12) return `move ${movement} · smooth`
    return `move ${movement}`
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">JAZZ VOICING LAB · MVP 0.1</div>
        <h1>Chord symbols in.<br />Playable voicings out.</h1>
        <p>
          実用的なテンプレートから候補を作り、ボイスリーディングを考慮しつつランダムに選びます。
          ブラウザで試聴して、そのままMIDIへ。
        </p>
      </header>

      <section className="panel controls">
        <label className="field field-wide">
          <span>Chord progression</span>
          <input
            value={progression}
            onChange={(event) => setProgression(event.target.value)}
            placeholder="Dm7 | G7 | Cmaj7 | A7alt"
          />
          <small>
            「|」が小節の区切りです。1小節に複数コードを書くと、その小節の拍数を均等に分けます。
            例: <code>Dm7 G7 | Cmaj7 | A7alt</code> なら1小節目はDm7とG7で2拍ずつ。
          </small>
        </label>

        <div className="field tempo-field">
          <span>Tempo</span>
          <div className="tempo-stepper">
            <button type="button" aria-label="テンポを10下げる" onClick={() => changeTempo(tempo - 10)}>−10</button>
            <div className="tempo-readout">
              <strong>{tempo}</strong>
              <em>BPM</em>
            </div>
            <button type="button" aria-label="テンポを10上げる" onClick={() => changeTempo(tempo + 10)}>+10</button>
          </div>
          <input
            className="tempo-range"
            type="range"
            min={40}
            max={300}
            step={1}
            value={tempo}
            onChange={(event) => changeTempo(Number(event.target.value))}
          />
          <div className="tempo-presets">
            {[120, 160, 180, 220, 260].map((preset) => (
              <button
                type="button"
                key={preset}
                className={preset === tempo ? 'active' : ''}
                onClick={() => changeTempo(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <small>ループ再生中に変えると、次の周から反映されます。</small>
        </div>

        <div className="control-grid">
          <label className="field">
            <span>Situation</span>
            <select value={context} onChange={(event) => setContext(event.target.value as PlayContext)}>
              <option value="combo">Bassあり · rootless中心</option>
              <option value="solo">Solo piano · root入り</option>
            </select>
          </label>

          <label className="field">
            <span>Register</span>
            <select value={rangeId} onChange={(event) => setRangeId(event.target.value)}>
              {RANGE_PRESETS.map((range) => (
                <option key={range.id} value={range.id}>{range.label}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>拍子(1小節の拍数)</span>
            <select value={beatsPerBar} onChange={(event) => setBeatsPerBar(Number(event.target.value))}>
              <option value={3}>3拍子</option>
              <option value={4}>4拍子</option>
              <option value={6}>6拍子</option>
            </select>
          </label>
        </div>

        <div className="switch-row">
          <label className="check">
            <input type="checkbox" checked={colorful} onChange={(event) => setColorful(event.target.checked)} />
            <span>Spread / 11th などの色付き候補も混ぜる</span>
          </label>

          <label className="range-control">
            <span>Randomness <strong>{Math.round(randomness * 100)}%</strong></span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(randomness * 100)}
              onChange={(event) => setRandomness(Number(event.target.value) / 100)}
            />
            <small>0%は滑らかさ優先、100%ほど候補の幅を広げます。</small>
          </label>
        </div>

        <div className="action-row">
          <button className="primary" onClick={generate}>Generate voicings</button>
          {voicings.length > 0 && (
            <button className="secondary" onClick={generate}>Another take</button>
          )}
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      {voicings.length > 0 && (
        <section className="results">
          <div className="results-head">
            <div>
              <div className="eyebrow">GENERATED TAKE</div>
              <h2>Voicing path</h2>
            </div>
            <div className="action-row compact">
              {looping ? (
                <button className="secondary" onClick={stopLoop}>
                  Stop loop · chorus {chorus}
                </button>
              ) : (
                <button className="secondary" onClick={beginLoop}>
                  Loop play
                </button>
              )}
              <button
                className="secondary"
                onClick={() => {
                  stopLoop()
                  playPerformance(buildPerformance(toTake(voicings), { tempo, beatsPerBar }), tempo)
                }}
              >
                Play all
              </button>
              <button
                className="primary"
                onClick={() => downloadMidi(buildPerformance(toTake(voicings), { tempo, beatsPerBar }), tempo)}
              >
                Export MIDI
              </button>
            </div>
          </div>

          {barsOf(voicings).map((bar, barPosition) => (
            <div className="bar-row" key={bar[0].voicing.chord.barIndex}>
              <div className="bar-label">小節 {barPosition + 1}</div>
              <div className="voicing-grid">
                {bar.map(({ voicing, index }) => (
                  <article className="voicing-card" key={`${voicing.id}-${index}`}>
                    <div className="card-topline">
                      <span className="index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="movement">{movementLabel(voicing.movementFromPrevious)}</span>
                    </div>
                    <h3>{voicing.chord.symbol}</h3>
                    <div className="family">
                      {voicing.label}
                      {bar.length > 1 && <span className="beats"> · {voicing.chord.beats}拍</span>}
                    </div>
                    <div className="notes">
                      {voicing.noteNames.map((note) => <span key={note}>{note}</span>)}
                    </div>
                    <div className="degrees">{voicing.degrees.join(' · ')}</div>
                    <button className="play-one" onClick={() => playChord(voicing.midi)}>Play chord</button>
                  </article>
                ))}
              </div>
            </div>
          ))}

          <div className="note">
            Loop playは進行を繰り返し再生し、1周ごとにボイシングを選び直します。同じ進行でも毎周ちがう響きになります。
            スマホで鳴らないときは、本体の消音スイッチ(マナーモード)と音量を確認してください。
            Preview音はブラウザ内蔵の簡易シンセです。書き出すMIDIは音声ではなく演奏情報なので、DAW側で好きなピアノ音源を割り当てられます。
          </div>
        </section>
      )}

      <footer>
        <span>Prototype assumptions: 4-note voicings / practical jazz-piano vocabulary / static web app</span>
      </footer>
    </main>
  )
}

export default App
