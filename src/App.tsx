import { useMemo, useState } from 'react'
import { playChord, playSequence } from './music/audio'
import { downloadMidi } from './music/midi'
import type { GeneratedVoicing, PlayContext } from './music/types'
import { generateProgressionVoicings, RANGE_PRESETS } from './music/voicings'

const DEFAULT_PROGRESSION = 'Dm7 | G7 | Cmaj7 | A7alt'

function App() {
  const [progression, setProgression] = useState(DEFAULT_PROGRESSION)
  const [context, setContext] = useState<PlayContext>('combo')
  const [rangeId, setRangeId] = useState('lh')
  const [colorful, setColorful] = useState(true)
  const [randomness, setRandomness] = useState(0.38)
  const [tempo, setTempo] = useState(100)
  const [beatsPerChord, setBeatsPerChord] = useState(4)
  const [voicings, setVoicings] = useState<GeneratedVoicing[]>([])
  const [error, setError] = useState('')

  const selectedRange = useMemo(
    () => RANGE_PRESETS.find((range) => range.id === rangeId) ?? RANGE_PRESETS[0],
    [rangeId],
  )

  const generate = () => {
    try {
      setError('')
      const next = generateProgressionVoicings(progression, {
        context,
        range: selectedRange,
        colorful,
        randomness,
      })
      setVoicings(next)
    } catch (caught) {
      setVoicings([])
      setError(caught instanceof Error ? caught.message : '生成に失敗しました。')
    }
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
          <small>例: Dm7 G7 Cmaj7 | F#m7b5 B7alt EmMaj7 | C7#11</small>
        </label>

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
            <span>Tempo</span>
            <div className="inline-number">
              <input
                type="number"
                min={40}
                max={240}
                value={tempo}
                onChange={(event) => setTempo(Number(event.target.value))}
              />
              <em>BPM</em>
            </div>
          </label>

          <label className="field">
            <span>Beats / chord</span>
            <select value={beatsPerChord} onChange={(event) => setBeatsPerChord(Number(event.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={8}>8</option>
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
              <button className="secondary" onClick={() => playSequence(voicings.map((item) => item.midi), tempo, beatsPerChord)}>
                Play all
              </button>
              <button className="primary" onClick={() => downloadMidi(voicings, tempo, beatsPerChord)}>
                Export MIDI
              </button>
            </div>
          </div>

          <div className="voicing-grid">
            {voicings.map((voicing, index) => (
              <article className="voicing-card" key={`${voicing.id}-${index}`}>
                <div className="card-topline">
                  <span className="index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="movement">{movementLabel(voicing.movementFromPrevious)}</span>
                </div>
                <h3>{voicing.chord.symbol}</h3>
                <div className="family">{voicing.label}</div>
                <div className="notes">
                  {voicing.noteNames.map((note) => <span key={note}>{note}</span>)}
                </div>
                <div className="degrees">{voicing.degrees.join(' · ')}</div>
                <button className="play-one" onClick={() => playChord(voicing.midi)}>Play chord</button>
              </article>
            ))}
          </div>

          <div className="note">
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
