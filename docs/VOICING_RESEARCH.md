# ジャズ・ピアノ・ボイシング調査メモ — MVP向け

このメモは、理論を網羅するためではなく「コードネームから、ピアニストが実際に試せる候補を自動生成する」ための設計判断をまとめたものです。

## 1. まず3rdと7thを核にする

Berklee Onlineは7th chordの基本サウンドとして3rdと7thを重視し、5thはalteredでない限り必須ではないと整理しています。また4度・5度進行では、一方の3rd / 7thが次の7th / 3rdへ解決する動きを使うことで、滑らかなvoice leadingと演奏のしやすさにつながると説明しています。

MVPではこの考え方を「前後のボイシングの移動量を小さくする」というスコアに落としました。

Source:
- Berklee Online, Piano Voicing Techniques
  https://online.berklee.edu/takenote/basic-piano-voicing-techniques/
- Learn Jazz Standards, Voice Leading 101
  https://www.learnjazzstandards.com/blog/voice-leading/

## 2. ベースがいるならrootlessが実用的

複数のジャズピアノ教材で、ベーシストがrootを担うコンボではrootを省き、9thなどの色を入れた4声rootless voicingが基本語彙として紹介されています。

代表的な形:

- Major / minor A: `3-5-7-9`（minorはb3, b7）
- Major / minor B: `7-9-3-5`
- Dominant A: `3-13-b7-9`
- Dominant B: `b7-9-3-13`

A/Bは単なる名前よりも「どの度数が下にあるか」で扱う方が安全です。教材によってA/Bというラベルの扱いに差があるため、アプリ内部では度数列そのものを正とします。

Sources:
- PianoGroove, Rootless Chord Voicings
  https://www.pianogroove.com/jazz-piano-lessons/rootless-chord-voicings/
- Learn Jazz Standards, Left-Hand Piano Voicings for ii-V7-Is
  https://www.learnjazzstandards.com/blog/left-hand-piano-voicings-for-ii-v7-is/
- Jazzify, Type A and Type B Rootless Voicings for Jazz Piano
  https://en.jazzify.jp/blog/type-a-type-b-rootless-voicings/

## 3. Dominantでは5thより13thが実用的な場合が多い

rootless dominantでは5thを13thへ置き換える形がよく使われます。MVPのplain dominant (`G7`, `G9`, `G13`) は、自然9th + 13thを含む候補を基本にしています。

`7alt`, `7b9`, `7#9`, `7#11`, `7b13` のように記号側でalterationが明示された場合は、その指定を優先します。

Sources:
- PianoGroove, Rootless Chord Voicings
  https://www.pianogroove.com/jazz-piano-lessons/rootless-chord-voicings/
- Piano With Jonny, Rootless Voicings for Piano: The Complete Guide
  https://pianowithjonny.com/piano-lessons/rootless-voicings-for-piano-the-complete-guide/

## 4. 音域は重要

rootless voicingは低すぎると濁り、高すぎると薄くなりやすいため、中央付近でA/Bやinversionを選ぶ考え方が実践教材で繰り返し出てきます。

MVPは音域プリセットを用意し、候補をその範囲へ制限しています。

Sources:
- PianoGroove, Rootless Chord Voicings
  https://www.pianogroove.com/jazz-piano-lessons/rootless-chord-voicings/
- Learn Jazz Standards, Left-Hand Piano Voicings for ii-V7-Is
  https://www.learnjazzstandards.com/blog/left-hand-piano-voicings-for-ii-v7-is/

## 5. Shellは「簡略版」ではなく、設計の基準として有用

shell voicingはroot + 3rd + 7th、または文脈によって3rd + 7thを中心にした最小構成として扱われます。Open Studioの教材も3rd / 7thをchordを定義するnotesとして説明しています。

MVPではshellそのものを大量に出すより、3rd / 7thが保たれることを候補設計の基準にしています。

Sources:
- Open Studio, Jazz Piano Jump-Start workbook
  https://www.openstudiojazz.com/wp-content/uploads/2024/11/Jazz-Piano-Jump-Start-2024-workbook.pdf
- Learn Jazz Standards, 2-5-1 Chord Progression Masterclass
  https://www.learnjazzstandards.com/blog/2-5-1-chord-progression/

## 6. 「いろんなボイシング」は最終的にはrootlessだけでは足りない

Jazz Piano Siteではrootless以外にもquartal harmony、So What chords、upper structures等を別語彙として整理しています。Open Studioもrooted, shells, fourths, clustersなどを実践的なleft-hand vocabularyとして扱っています。

ただしMVPで全部を混ぜると、「何がランダムなのか」が分かりにくくなります。まずrootless / rooted spreadを核にし、利用者のフィードバック後に以下を追加するのが妥当です。

- Quartal voicing
- So What voicing
- Upper Structure Triad（特にdominant）
- Cluster
- Two-handed spread

Sources:
- The Jazz Piano Site, Jazz Chord Voicings
  https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/
- The Jazz Piano Site, Upper Structures
  https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/upper-structures/
- Open Studio, Jazz Piano Basics Vol. 2: Left Hand Voicings
  https://www.openstudiojazz.com/courses/jazz-piano-basics-vol-2-left-hand-voicings/

## 7. このMVPでの重要な仮定

現時点では利用者から「完全ランダムではなく、使えるボイシング候補を生成して、その中からランダムに選ぶ」という方向だけ確認できています。

そのため以下は暫定です。

- 1コード4声を基本にする
- Combo/Bassありではrootless中心
- Soloではroot入り
- Plain dominantにも9th / 13thを許す
- `C` のようなplain majorは6/9 colorとして扱う
- Melody top noteは未指定なので拘束しない
- リズムは1コードごとのblock chord
- ランダム性は候補生成ではなく候補選択に入れる
- 前後の移動量が小さい候補を優先する

利用者からの次の回答次第で、ここを変えるのが本来のMVPの目的です。
