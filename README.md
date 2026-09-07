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
npm test
```

### 仕入先マスター（IEP-P1-005）

`/suppliers` で仕入先の一覧・検索・登録・編集・無効化／再有効化を行います。
画面上部の「顧客」「仕入先」から切り替えられます。
仕入先名が必須で、担当者名・メールアドレス・電話番号・郵便番号・住所・備考は任意です。
名前と連絡先は将来の見積依頼先選定で利用できる独立したフィールドとして保存します。
入力はZodで検証し、日時はFirestoreのserverTimestampを使用します。
無効化でもドキュメントとIDを保持します。外部送信・見積依頼の自動化は行いません。

動作確認の前に、管理者が対象Firebaseプロジェクトを確認して `firestore.rules` を反映してください。
今回のコード変更だけでは稼働環境のRulesは更新されません。
suppliersは認証必須・データ型と更新日時を検証・物理削除禁止です。既存customersのRulesは維持しています。
roleに基づく権限分離はIEP-P1-010の対象です。

動作確認:

1. `npm run dev` で起動し、ログインして「仕入先」を開く。
2. 「仕入先を登録」で名前・連絡先・住所・備考を保存し、一覧と成功通知を確認する。
3. 再読込して残ること、仕入先名・担当者・メール・備考で検索できることを確認する。
4. 「編集」で住所・備考も表示されることを確認し、修正・保存・再読込する。
5. 「無効化」のキャンセルで変更されないこと、確定後に通常一覧から消えることを確認する。
6. 「無効な仕入先を非表示」を押して無効な行を表示し、「有効化」で戻せることを確認する。
7. 空欄・空白だけの名前、不正なメールで保存できないことを確認する。
8. 顧客画面への切り替えができること、ログアウト後は `/suppliers` に直接アクセスしてもログイン画面に戻ることを確認する。

自動テストは入力検証とFirestore呼び出し（モック）の単体テストです。
実Firestoreでの保存・Rulesによるアクセス制御は別途確認が必要です。
