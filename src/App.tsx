import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getPlaybackPosition,
  playChord,
  playPerformance,
  startPerformanceLoop,
  stopPlayback,
} from './music/render/audio'
import { downloadMidi } from './music/render/midi'
import { buildPerformance, chordIndexAtBeat } from './music/perform'
import type { PerformOptions } from './music/perform'
import type { SwingSetting } from './music/humanize'
import { generateTakes } from './music/take'
import { spellChordDegree } from './music/theory'
import { voicingDistance } from './music/voicings'
import type { DensityPreset, Take, Voicing } from './music/types'

/**
 * 4小節で、最後のG7が1小節目のCmaj7へ戻る形にしてある。
 * 3小節だとループしたときに耳が小節を数えられず、「今どこを弾いているか
 * わからない」状態になる(docs/FEEDBACK_01.md §1)。
 */
const DEFAULT_PROGRESSION = 'Cmaj7 | A7alt | Dm7 | G7'

const DENSITY_OPTIONS: { id: DensityPreset; label: string }[] = [
  { id: 'powell', label: 'Powell · 2音、右手を空ける' },
  { id: 'shell3', label: 'シェル+ · 3音' },
  { id: 'standard', label: '標準 · 4〜5音' },
  { id: 'thick', label: '厚め · 5〜7音(既定)' },
]

function App() {
  const [progression, setProgression] = useState(DEFAULT_PROGRESSION)
  const [density, setDensity] = useState<DensityPreset>('thick')
  const [withBass, setWithBass] = useState(true)
  const [strict, setStrict] = useState(false)
  const [swingMode, setSwingMode] = useState<'auto' | 'manual'>('auto')
  const [swingAmount, setSwingAmount] = useState(70) // 手動時のみ使う。0=イーブン, 100=最大
  const [randomness, setRandomness] = useState(0.38)
  const [topLineWeight, setTopLineWeight] = useState(0.6)
  const [tempo, setTempo] = useState(180)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [choruses, setChoruses] = useState(2)
  const [take, setTake] = useState<Take | null>(null)
  const [error, setError] = useState('')
  const [looping, setLooping] = useState(false)
  const [chorus, setChorus] = useState(0)
  /** 今どのコードが鳴っているか。再生していないときはnull。 */
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [tracking, setTracking] = useState(false)

  const swing: SwingSetting = swingMode === 'auto' ? 'auto' : swingAmount

  const generateOptions = useMemo(
    () => ({ density, randomness, topLineWeight, beatsPerBar, withBass }),
    [density, randomness, topLineWeight, beatsPerBar, withBass],
  )

  const performOptions: PerformOptions = useMemo(
    () => ({ tempo, beatsPerBar, withBass, strict, swing, density, choruses }),
    [tempo, beatsPerBar, withBass, strict, swing, density, choruses],
  )

  // ループ再生中にテンポ/設定を動かしても次のコーラスから反映させる
  const liveRef = useRef({ generateOptions, performOptions })
  useEffect(() => {
    liveRef.current = { generateOptions, performOptions }
  }, [generateOptions, performOptions])

  // 画面に出ているテイクを、毎フレーム作り直さずに参照するためのref
  const takeRef = useRef<Take | null>(take)
  useEffect(() => {
    takeRef.current = take
  }, [take])

  /**
   * AudioContextの時計を毎フレーム見て、今鳴っているコードを割り出す。
   * Web Audioは1コーラス分をまとめて予約するので、音が鳴る瞬間に呼ばれる
   * コールバックが無い。時計から逆算するしかない。
   */
  useEffect(() => {
    if (!tracking) {
      setPlayingIndex(null)
      return
    }

    let frame = 0
    // 再生開始直後は、予約はしたがまだ鳴り始めていない一瞬があるので、
    // 「一度鳴り始めたか」を持っておく。これが無いと開始直後に追跡を止めてしまう。
    let started = false

    const tick = () => {
      const position = getPlaybackPosition()
      const current = takeRef.current
      let next: number | null = null

      if (position) started = true
      // Play allのように1回で終わる再生では、鳴り終わったら追跡をやめる。
      // ループ中は次のコーラスが来るので止めない。
      if (started && !position && !looping) {
        setTracking(false)
        return
      }

      if (position && current) next = chordIndexAtBeat(current.chords, position.beat)

      // 同じ値ならReactは再描画しないので、毎フレーム呼んでも問題ない
      setPlayingIndex((previous) => (previous === next ? previous : next))
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [tracking, looping])

  const changeTempo = (value: number) => setTempo(Math.min(300, Math.max(40, Math.round(value))))

  const generate = () => {
    stopLoop()
    try {
      setError('')
      const [next] = generateTakes(progression, generateOptions)
      setTake(next)
    } catch (caught) {
      setTake(null)
      setError(caught instanceof Error ? caught.message : '生成に失敗しました。')
    }
  }

  const stopLoop = () => {
    stopPlayback()
    setLooping(false)
    setTracking(false)
  }

  const beginLoop = () => {
    setLooping(true)
    setTracking(true)
    // 前の周の最後のボイシングを覚えておき、次の周の1コードめをそこから繋げる。
    // これが無いと、継ぎ目が「無関係な2つのテイクの端どうし」になる。
    let previousVoicing: Voicing | undefined
    startPerformanceLoop(
      (chorusIndex) => {
        const [nextTake] = generateTakes(progression, {
          ...liveRef.current.generateOptions,
          previousVoicing,
        })
        previousVoicing = nextTake.voicings[nextTake.voicings.length - 1]
        setTake(nextTake)
        setChorus(chorusIndex + 1)
        // ループ再生自体が周回を担うので、書き出し用の「コーラス数」はここでは1固定にする
        return buildPerformance(nextTake, { ...liveRef.current.performOptions, choruses: 1 })
      },
      () => liveRef.current.performOptions.tempo,
    )
  }

  const barsOf = (currentTake: Take) => {
    const bars: { voicing: Voicing; chordIndex: number }[][] = []
    currentTake.voicings.forEach((voicing, chordIndex) => {
      const bar = bars[bars.length - 1]
      if (bar && currentTake.chords[bar[0].chordIndex].barIndex === currentTake.chords[chordIndex].barIndex) {
        bar.push({ voicing, chordIndex })
      } else {
        bars.push([{ voicing, chordIndex }])
      }
    })
    return bars
  }

  const noteNamesFor = (currentTake: Take, chordIndex: number, hand: 'left' | 'right') => {
    const voicing = currentTake.voicings[chordIndex]
    const chord = currentTake.chords[chordIndex]
    const notes = hand === 'left' ? voicing.left : voicing.right
    const degreeOffset = hand === 'left' ? 0 : voicing.left.length
    return notes.map((midi, i) => spellChordDegree(chord, voicing.degrees[degreeOffset + i], midi))
  }

  const movementLabel = (currentTake: Take, chordIndex: number) => {
    if (chordIndex === 0) return 'start'
    const prev = currentTake.voicings[chordIndex - 1]
    const curr = currentTake.voicings[chordIndex]
    const prevNotes = [...prev.left, ...prev.right]
    const currNotes = [...curr.left, ...curr.right]
    const movement = voicingDistance(prevNotes, currNotes)
    // 合計値は声部が増えるほど大きくなるので、そのままの閾値では厚いボイシングが
    // 常に「粗い」ように見えてしまう。1声部あたりの平均で評価する。
    const perVoice = movement / Math.max(prevNotes.length, currNotes.length)
    if (perVoice <= 1.5) return `move ${movement} · very smooth`
    if (perVoice <= 3) return `move ${movement} · smooth`
    return `move ${movement}`
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">JAZZ VOICING LAB · v0.2</div>
        <h1>Chord symbols in.<br />A trio comping track out.</h1>
        <p>
          両手コンピングとウォーキングベースを、進行全体を見るビームサーチで組み立てます。
          ブラウザで試聴して、スウィングとベロシティの揺れが乗ったマルチトラックMIDIへ。
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
            例: <code>Dm7 G7 | Cmaj7</code> なら1小節目はDm7とG7で2拍ずつ。
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
            <span>厚さ(Density)</span>
            <select value={density} onChange={(event) => setDensity(event.target.value as DensityPreset)}>
              {DENSITY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
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

          <label className="field">
            <span>コーラス数(書き出し用)</span>
            <input
              type="number"
              min={1}
              max={8}
              value={choruses}
              onChange={(event) => setChoruses(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
            />
            <small>MIDI書き出し時に、この回数ぶんリズムを引き直して連結します。</small>
          </label>
        </div>

        <div className="switch-row">
          <label className="check">
            <input type="checkbox" checked={withBass} onChange={(event) => setWithBass(event.target.checked)} />
            <span>ウォーキングベースを別トラックで鳴らす</span>
          </label>

          <label className="check">
            <input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} />
            <span>きっちりモード(スウィング以外の揺れをOFF。打ち込みの下敷き用)</span>
          </label>
        </div>

        <div className="switch-row">
          <label className="field">
            <span>スウィング</span>
            <select value={swingMode} onChange={(event) => setSwingMode(event.target.value as 'auto' | 'manual')}>
              <option value="auto">Auto(テンポに合わせて自動調整)</option>
              <option value="manual">手動</option>
            </select>
          </label>

          {swingMode === 'manual' && (
            <label className="range-control">
              <span>スウィング量 <strong>{swingAmount}%</strong></span>
              <input
                type="range"
                min={0}
                max={100}
                value={swingAmount}
                onChange={(event) => setSwingAmount(Number(event.target.value))}
              />
              <small>0%はイーブン、100%が最も強いシャッフル感になります。</small>
            </label>
          )}
        </div>

        <div className="switch-row">
          <label className="range-control">
            <span>Randomness <strong>{Math.round(randomness * 100)}%</strong></span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(randomness * 100)}
              onChange={(event) => setRandomness(Number(event.target.value) / 100)}
            />
            <small>0%はビームサーチの最良経路、100%ほど候補の幅を広げます。</small>
          </label>

          <label className="range-control">
            <span>トップラインの強さ <strong>{topLineWeight.toFixed(2)}</strong></span>
            <input
              type="range"
              min={0}
              max={150}
              value={Math.round(topLineWeight * 100)}
              onChange={(event) => setTopLineWeight(Number(event.target.value) / 100)}
            />
            <small>上げるほど、一番上の音が3〜4半音で滑らかに動くテイクが選ばれやすくなります。</small>
          </label>
        </div>

        <div className="action-row">
          <button className="primary" onClick={generate}>Generate take</button>
          {take && (
            <button className="secondary" onClick={generate}>Another take</button>
          )}
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      {take && (
        <section className="results">
          <div className="results-head">
            <div>
              <div className="eyebrow">GENERATED TAKE · {DENSITY_OPTIONS.find((option) => option.id === density)?.label}</div>
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
                  playPerformance(buildPerformance(take, { ...performOptions, choruses: 1 }), tempo)
                  setTracking(true)
                }}
              >
                Play all
              </button>
              <button
                className="primary"
                onClick={() =>
                  downloadMidi(
                    buildPerformance(take, {
                      ...performOptions,
                      // 2周目以降はボイシングも引き直す。同じ響きが繰り返されると
                      // 「毎周ちがう」というこのアプリの意味が無くなるため。
                      takeForChorus: (_chorusIndex, previousVoicing) =>
                        generateTakes(progression, { ...generateOptions, previousVoicing })[0],
                    }),
                    tempo,
                    beatsPerBar,
                  )
                }
              >
                Export MIDI
              </button>
            </div>
          </div>

          {barsOf(take).map((bar, barPosition) => (
            <div
              className={`bar-row${bar.some((item) => item.chordIndex === playingIndex) ? ' playing' : ''}`}
              key={take.chords[bar[0].chordIndex].barIndex}
            >
              <div className="bar-label">小節 {barPosition + 1}</div>
              <div className="voicing-grid">
                {bar.map(({ voicing, chordIndex }) => (
                  <article
                    className={`voicing-card${playingIndex === chordIndex ? ' playing' : ''}`}
                    key={`${take.id}-${chordIndex}`}
                  >
                    <div className="card-topline">
                      <span className="index">
                        {playingIndex === chordIndex ? '▶ NOW' : String(chordIndex + 1).padStart(2, '0')}
                      </span>
                      <span className="movement">{movementLabel(take, chordIndex)}</span>
                    </div>
                    <h3>{take.chords[chordIndex].symbol}</h3>
                    <div className="family">
                      {voicing.label}
                      {bar.length > 1 && <span className="beats"> · {take.chords[chordIndex].beats}拍</span>}
                    </div>
                    {voicing.left.length > 0 && (
                      <>
                        <div className="degrees">左手</div>
                        <div className="notes">
                          {noteNamesFor(take, chordIndex, 'left').map((note, i) => (
                            <span key={`${note}-${i}`}>{note}</span>
                          ))}
                        </div>
                      </>
                    )}
                    {voicing.right.length > 0 && (
                      <>
                        <div className="degrees">右手</div>
                        <div className="notes">
                          {noteNamesFor(take, chordIndex, 'right').map((note, i) => (
                            <span key={`${note}-${i}`}>{note}</span>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="degrees">{voicing.degrees.join(' · ')}</div>
                    <button
                      className="play-one"
                      onClick={() => playChord([...voicing.left, ...voicing.right])}
                    >
                      Play chord
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ))}

          <div className="note">
            Loop playは進行を繰り返し再生し、1周ごとにテイクとリズムを選び直します。同じ進行でも毎周ちがう響きになります。
            スマホで鳴らないときは、本体の消音スイッチ(マナーモード)と音量を確認してください。
            Preview音はブラウザ内蔵の簡易シンセです。書き出すMIDIは音声ではなく演奏情報なので、DAW側で好きなピアノ/ベース音源を割り当てられます。
          </div>
        </section>
      )}

      <footer>
        <span>Phase1: two-hand voicings / walking bass / comping rhythm / swing &amp; velocity / multitrack MIDI export</span>
      </footer>
    </main>
  )
}

export default App
