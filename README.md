# IEPpurchase

石川エンタープライズ向け 資材調達管理システム。

## 目的
見積依頼受付から、仕入先選定、販売見積、発注、納品、履歴分析までを一貫して管理し、
将来的にはメール・AI・freee・EC API連携による自動化を行う。

## 想定利用規模
- 利用者: 2〜5名程度
- 月間案件: 10〜100件程度
- 1案件あたり: 約10品目

## 技術構成
- React
- TypeScript
- Firebase / Firestore
- Firebase Authentication
- GitHub

## 開発資料
- `AGENTS.md` : Codex / AI開発ルール
- `docs/ARCHITECTURE.md` : システム構成・データ設計方針
- `docs/CURRENT_STATUS.md` : 現在のPhase・進捗
- `docs/CODEX_WORKFLOW.md` : Codexを使った開発手順

正式な要件定義書・コード仕様書・進捗管理シートは共有ストレージ側を正とする。

## 開発開始
```bash
npm install
npm run dev
```

※ 実際のpackage manager / scriptはプロジェクト初期化後にREADMEを更新すること。

## セキュリティ
`.env`、秘密鍵、サービスアカウントJSON、API Secret等はGitHubへコミットしない。

### Firebase設定

1. Firebase ConsoleでWebアプリを作成し、Authentication（Email/Password）、Cloud Firestore、Cloud Storageを有効化します。
2. `.env.example` を `.env.local` にコピーします。
3. Firebase ConsoleのWebアプリ設定値を、`VITE_FIREBASE_*` の各環境変数に設定します。

`.env.local` はGit管理されません。サービスアカウント鍵や外部APIの秘密情報は配置しません。

### Firebase Emulator（任意）

`.env.local` の `VITE_USE_FIREBASE_EMULATORS=true` で、Authentication（9099）、Firestore（8080）、Storage（9199）へ接続します。Emulator設定・Security Rulesは、それぞれの実装タスクで追加します。

### 品質確認

### ログイン基盤（IEP-P1-003）

Firebase AuthenticationのEmail/Passwordを有効化し、管理者が利用者をFirebase Consoleで登録してから利用します。
アプリの新規登録画面はありません。パスワードをコードやGitに保存しないでください。
認証状態の復元中は待機表示し、未ログインの場合は `/login` へ移動します。
ログイン状態の保存はFirebase SDKの既定のブラウザ永続化を使用します。共用PCでは利用後にログアウトしてください。

動作確認:

1. `npm run dev` で起動し、未ログインのブラウザで `/` を開く。ログイン画面へ移動すること。
2. 空欄では送信できず、不正なメール形式ではブラウザの検証が表示されること。
3. 登録済み利用者の正しいメール・パスワードでログインし、準備画面とメールアドレスが表示されること。
4. 再読み込み後もログイン済み画面を表示すること。
5. ログアウト後はログイン画面に戻り、戻る操作・URL直接入力でも準備画面に入れないこと。
6. 誤ったパスワードで日本語のエラーが表示され、修正後に再試行できること。

このタスクは認証と画面保護の最小基盤です。usersコレクションのrole/activeに基づく認可、Firestore Security Rulesはまだ実装されていません。
画面の保護はDBのアクセス制御を代替しないため、業務データを扱う前にRulesのタスクを完了してください。
本番設定の変更・利用者作成・Rulesのデプロイはこの実装では実行していません。

### 自動チェック

```bash
npm run typecheck
npm run lint
npm run build
```
