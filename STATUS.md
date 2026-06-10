# 🛠 STATUS — キャラ工房（atelier）進捗

> claude.ai 側（くろくん）がリポジトリ経由で進捗を読むための常設の窓。
> 毎セッション終わりに「できたこと／未着手／既知の問題／次にやること」を追記する。
> 対象：きせかえマーケット（`fantasy_market.html`）＋ キャラ工房（`atelier.html`）
> 作業ブランチ：`claude/notion-project-build-kl8rb2`（開発）／ `claude/game-dev-feasibility-bUiGF`（Pages公開）

## 公開URL（Pages）
- ゲーム本体：https://aliced0247.github.io/farm_game/fantasy_market.html
- キャラ工房：https://aliced0247.github.io/farm_game/atelier.html

## アーキテクチャ方針（重要・ズレ防止）
- 描画ロジックの唯一の真実は **`fantasy_market.html`**。
- `atelier.html` は実行時に本体の `<script>` を **DOMをスタブした状態で注入**して、
  本体の関数（`renderChar` など）と state（`S`）をそのまま使う。
  → ビルド不要・二重管理なし・「片方だけ古い」が起きない。
- セーブは本体と**同じ localStorage キー**（`fantasy_market_save_v1`）。
  工房で作った顔は**ゲームにも反映**される。

---

## できたこと ✅
### Phase 1：顔スタジオ（輪郭の手術）
- 本体 `fantasy_market.html`：
  - `S.face` に輪郭パラメータ `faceW`(はば) / `faceH`(たかさ) / `chin`(あご) / `cheek`(ほっぺ) を追加。
  - `defaultFace()` に既定値（70/74/0/0）を追加。**既定値で従来の楕円と完全一致**（セーブ互換：古いセーブは `Object.assign` で既定補完）。
  - 頭の描画を固定楕円→**ベジェ曲線のパラメトリック輪郭**に置換（角を作らない）。耳・ほっぺ・鼻位置も `faceW` に追従。
- `atelier.html`（新規）：スマホ縦持ち前提のキャラ工房。
  - 上部に**人形プレビューを固定表示**（スクロールしても見える）。
  - スライダー：はば・たかさ・あご・ほっぺ・めの大きさ・めの間かく。
  - チップ：プリセット・め・まゆ・くち・パーツ選択。X/Y位置スライダー＋部分リセット。
  - スウォッチ：はだ・かみのいろ。
  - **即時反映＋自動保存**（適用ボタンなし）。「顔をぜんぶ戻す」あり。
- 統合テスト（node＋本体コード注入）で `S` 初期化・`renderChar`・`save` 往復・新キー永続を確認。

---

## 未着手（次のフェーズ）
- **Phase 2：作画スタジオ（ART_PIPELINE の GUI 化）★本丸**
  - スロット選択＋描画領域ガイドのオーバーレイ
  - SVG貼り付け→人形上ライブプレビュー→ドラッグ/ピンチで位置・拡大調整
  - 「art() コードをコピー」（hair `{back,front}` / acc `{body,head}` 対応）
  - 現行プロシージャル描画の半透明リファレンス重ね
- **Phase 3（余力）**：顔プリセットの JSON 書き出し／thumb 自動生成

## 既知の問題 / 注意 ⚠️
- atelier は `fetch("fantasy_market.html")` で本体を読むため、**`file://` 直開きでは動かない**（CORS）。Pages（https）で開くこと。
- 本体エンジン注入時、本体の `bootstrap()` も走る（DOMはスタブ）。セーブが無ければ既定キャラを作成して保存する（ゲーム初回起動と同じ挙動）。
- 輪郭を極端に細く/広くすると、髪（固定シルエット）と顔の縁が僅かにズレる場合あり。常用域では問題なし。髪の輪郭追従は将来課題。

## 次にやること 👉
1. もえちゃんがスマホで `atelier.html` を実機確認（受け入れ条件のチェック）。
2. OK が出たら Phase 2（作画スタジオ）に着手。
