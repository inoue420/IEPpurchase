# CODEX_WORKFLOW.md

## Codex開発運用

### 新しいチャット開始時
Codexへ以下の順で確認させる。

1. `AGENTS.md`
2. `docs/CURRENT_STATUS.md`
3. `docs/ARCHITECTURE.md`
4. Google Drive管理シート
5. 今回のPhaseに必要な要件定義書 / コード仕様書
6. Git status
7. 現在のソース構成

要件定義書やコード仕様書は毎回全文を再読込するのではなく、
今回の作業に関連する部分を優先する。

---

## 実装開始前にCodexが提示する内容
- 現在の状況
- 今回実装する内容
- 変更予定ファイル
- 実装順序
- 動作確認方法
- リスク / 注意点

---

## 1機能の基本サイクル

```text
現状確認
↓
実装
↓
typecheck / lint / build
↓
Codexによる結果報告
↓
ユーザー向け動作確認手順
↓
ユーザーがブラウザ確認
↓
OK
↓
必要ならcommit
↓
次の機能
```

ユーザーがOKする前に大きな次工程へ進まない。

---

## Phase終了時

1. 全体build
2. 主要機能の動作確認
3. 要件との抜け漏れ確認
4. 未解決事項整理
5. Git commit
6. Google Drive管理シート更新
7. `docs/CURRENT_STATUS.md` 更新
8. 次Phase候補を記載
9. チャット終了

次Phaseは原則新しいCodexチャットで開始する。

---

## Google管理シート推奨列
- Phase
- 機能
- ステータス
- 実装日
- 動作確認
- 確認日
- 不具合
- 修正内容
- commit hash
- 関連要件
- 次作業
- 備考

ステータス例:
- 未着手
- 実装中
- Codex確認済
- ユーザー確認待ち
- 完了
- 保留

---

## Codex開始用テンプレート

以下を新規チャットの最初に使用できる。

```text
IEPpurchaseの開発を続行してください。

最初に以下を確認してください。
1. AGENTS.md
2. docs/CURRENT_STATUS.md
3. docs/ARCHITECTURE.md
4. Google Driveの開発管理シート
5. 今回の作業に関係する要件定義書・コード仕様書
6. git statusと現在のコード

一度に広範囲を実装せず、1機能ずつ実装→自動チェック→私の動作確認の順で進めてください。

まずコードを変更せず、
・現在の状況
・今回実装する内容
・変更予定ファイル
・実装順序
・最初の動作確認ポイント
を提示してください。
```
