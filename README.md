# Jazz Voicing Lab — MVP 0.1

コード進行を入力すると、ジャズピアノで実用的なボイシング候補を生成し、前後の移動量を考慮しながらランダムに1テイクを作るWebアプリです。

- React + TypeScript + Vite
- サーバー / DB 不要
- GitHub Pagesで公開可能
- ブラウザ内で簡易試聴
- Standard MIDI File (`.mid`) をブラウザ内で生成

## 起動

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

`dist/` が生成されます。`vite.config.ts` は `base: './'` にしてあるため、GitHub Pagesのリポジトリ名に依存しにくい構成です。

## GitHub Pages

`.github/workflows/deploy-pages.yml` を同梱しています。

GitHubのリポジトリで **Settings → Pages → Source: GitHub Actions** を選べば、`main` へのpushでデプロイできます。

## MVPで対応している主なコード

- `Cmaj7`, `CM7`, `CΔ7`
- `Cm7`, `C-7`, `Cm9`, `Cm11`
- `C7`, `C9`, `C13`
- `C7b9`, `C7#9`, `C7#11`, `C7b13`, `C7alt`
- `Cm7b5`, `Cø7`
- `Cdim7`, `Co7`, `C°7`
- `CmMaj7`
- `C7sus4`
- `C` はMVPではジャズ寄りの 6/9 系候補として扱います

スラッシュコードは記号自体は解析しますが、MVPのボイシング生成ではベース音をまだ独立トラックとして出していません。

## 生成ロジックの考え方

完全ランダムではありません。

1. コードタイプから実用的なテンプレート候補を作る
2. 指定音域に収まる配置だけ残す
3. 前のコードとの各声部の移動量を計算する
4. `Randomness` が低いほど最小移動を優先する
5. `Randomness` が高いほど上位候補から広くランダム選択する

ベースありでは rootless A/B、13th dominant、spread、minor 11等を中心にしています。ソロピアノではrootを含む候補へ切り替えます。

## MIDIについて

MIDIはMP3のような録音音声ではなく、ノート番号・タイミング・テンポ等の演奏情報です。

このMVPでは4声のブロックコードとして書き出します。DAWへ読み込んで、好きなピアノ音源やRhodes等を割り当てる想定です。

## まだ意図的に入れていないもの

少人数で触って要件を固めるため、最初から広げすぎていません。

- コンピングのリズムパターン
- Melody / top note を固定して下でボイシングする機能
- Upper Structure Triad
- Quartal / So What系の本格生成
- キーや機能和声を見て「使えるテンション」を変える判定
- ベースラインの別MIDIトラック
- 実ピアノSoundFont
- MusicXML
- ユーザープリセット保存
- Seed指定による同一ランダム結果の再現

次の要件ヒアリングでは、とくに「左手だけなのか両手なのか」「メロディのトップノートを守る必要があるか」「1コード何音が欲しいか」を確認すると設計が進みやすいです。

詳しい調査メモは `docs/VOICING_RESEARCH.md` を参照してください。
