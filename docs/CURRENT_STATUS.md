# CURRENT_STATUS.md

## プロジェクト
IEPpurchase 資材調達管理システム

## 現在Phase
Phase 1 - 基盤実装

## 状態
未着手 / 初期セットアップ段階

## Phase 1の目的
外部API連携を行う前に、業務データを管理する基盤を作る。

### Phase 1対象
- Firebase接続確認
- Authentication基盤（必要範囲）
- customers
- suppliers
- products
- rfqs
- rfqItems
- 一覧 / 詳細 / 登録 / 編集
- 基本検索
- バリデーション
- Firestore保存
- 最低限のSecurity Rules
- TypeScript / lint / build確認

### Phase 1対象外
- 楽天API
- Amazon API
- freee API
- AI / OCR
- メール自動取込
- 自動翻訳
- 仕入先への自動見積メール送信
- 発注自動化
- 納品自動連携
- 月次販売分析の本実装

## 現在完了済み
- 要件定義書作成
- コード仕様書作成
- Phase 1初回実装プロンプト作成
- 開発運用方針決定

## 次の作業
1. `C:\projects\IEPpurchase` にプロジェクトを配置
2. VS Codeで開く
3. GitHubリポジトリへ接続
4. Codexにプロジェクト構成を確認させる
5. Phase 1実装計画を提示させる
6. 小単位で実装・動作確認を開始

## 運用ルール
各機能の実装後にユーザーが実機 / ブラウザで動作確認する。
OK後に次の機能へ進む。

Phase完了時に:
- 管理シート
- CURRENT_STATUS.md
- 必要に応じてREADME / ARCHITECTURE
を更新する。

## 未解決事項
現時点では特になし。

## 最終更新
2026-09-07
