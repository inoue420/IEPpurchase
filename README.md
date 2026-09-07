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
