# DRIVE_RESOURCES.md

## IEPpurchase Google Drive 開発資料

### 開発資料フォルダ
https://drive.google.com/drive/folders/1JCxWvh5D_KXSHpWfovhV9ZmELWAVGazO?usp=drive_link

このフォルダを IEPpurchase の正式な共有資料置き場として扱う。

---

## 開発管理シート
ファイル名: IEPpurchase_開発管理シート

Google Sheets:
https://docs.google.com/spreadsheets/d/1hXh2UDbJEP-6rBLrEY8fFtzL3k4_Ad7x9dHl0Tidng8/edit

### 運用
- 各Codexチャット開始時に最初に読み込む。
- 現在Phase、完了済み項目、ユーザー確認結果、未解決事項、次作業を確認する。
- ユーザーが動作確認して「OK」とした後、作業終了時に更新する。
- 進捗管理については、この管理シートを正式な記録として扱う。
- 同名ファイルが複数ある場合は、このURLのGoogleスプレッドシートを使用する。

---

## 要件定義書
ファイル名: 資材調達管理システム 要件定義書.pdf

上記の開発資料フォルダ内にある最新版を参照する。

## コード仕様書
ファイル名: 資材調達管理システム コード仕様書.pdf

上記の開発資料フォルダ内にある最新版を参照する。

## Phase 1 初回実装プロンプト
ファイル名: Codex Phase 1 初回実装プロンプト.pdf

Phase 1の初回実装時に参照する。

---

## Codexへの参照ルール

### 作業開始時
1. `AGENTS.md` を読む。
2. `docs/CURRENT_STATUS.md` を読む。
3. この `docs/DRIVE_RESOURCES.md` を読む。
4. 上記Google Driveフォルダを開く。
5. `IEPpurchase_開発管理シート` を読み、現在の進捗を確認する。
6. 今回の作業に必要な範囲だけ要件定義書・コード仕様書を確認する。
7. `git status` と現在のコードを確認する。

### 作業終了時
ユーザーの動作確認が「OK」になった後に限り、
`IEPpurchase_開発管理シート` の該当行を更新する。

更新内容の例:
- ステータス
- 実装内容
- Codex確認結果
- ユーザー動作確認結果
- 確認日
- 不具合・修正内容
- commit hash
- 次作業
- 備考

### 注意
- PDFの要件定義書・コード仕様書は、明示的な依頼がない限り変更しない。
- Google Driveフォルダ全体を毎回全文解析しない。
- 今回のタスクに必要なファイル・範囲だけ読む。
- Google Driveへアクセスできない場合は、推測で進捗を書き換えずユーザーへ報告する。
