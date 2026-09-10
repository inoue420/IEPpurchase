# CURRENT_STATUS.md

## プロジェクト
IEPpurchase 資材調達管理システム

## 現在Phase・状態
Phase 2 — IEP-P2-012 総合確認（採用処理の安全性補強を本番反映・ユーザー再確認待ち）。

仕入先見積添付、購入候補比較、数量採用・解除、履歴、Firestore／Storage Rulesを本番反映済み。2026-09-10に採用成功・数量超過拒否・解除を確認し、候補原本のサーバー再検証と採用中品目ロックを追加反映した。

## 完了記録と確認事実
- 正式管理シートでIEP-P1-001〜011、013の完了記録を確認（2026-09-08）。
- React / TypeScript / Vite、Firebase接続、Email/Password認証。
- customers / suppliers / products / rfqs / RFQ品目CRUD・検索・入力検証。
- RFQ案件/品目採番、users.active/roleによるFirestore認可、Rulesテスト。
- Storage Rules・Emulator設定。本番バケット作成/Rulesデプロイは保留記録あり。
- 過去の自動/ユーザー確認結果は正式管理シートを参照し、今回の検証結果とは区別する。

## 未解決事項
- Phase 1完了申告とP1-012保留の差異。auditLogsと/dashboardの不足を先に解消するか、別管理して進むか要確認。
- ARCHITECTUREの概略名rfqItems/activityLogsと正式仕様の差異。実装の品目パスはrfqs/{rfqId}/items/{rfqItemId}、履歴は正式仕様のauditLogsを参照する。
- Phase 2の税区分・端数処理・送料配賦・期限切れ候補の扱いは設計案レビュー待ち。
- P2-007のサーバー実行環境/費用条件とP2-009の本番Storage条件は導入前に確認。
- 楽天/Amazonの認証準備はP2-013/014で段階案内。手入力は取得待ちにしない。

## 次の作業
1. IEP-P2-012の総合ユーザー確認を行う。

## 運用
1機能ごとに実装・自動確認・ユーザー動作確認を行い、OK後に次へ進む。
Phase 3以降の先行実装、実メール/本番外部送信、課金有効化は行わない。
進捗の正式記録は[Google Drive開発管理シート](https://docs.google.com/spreadsheets/d/1hXh2UDbJEP-6rBLrEY8fFtzL3k4_Ad7x9dHl0Tidng8/edit)。
正式要件・コード仕様PDFは明示依頼なく変更しない。

## 最終更新
2026-09-10（採用処理の安全性補強を本番反映）
## 認可方針の変更（2026-09-09・ユーザー明示指示）
ログイン済みの全ユーザーを同じアプリ権限で扱う。users文書の存在・active・roleはアクセス条件に使用しない。
未ログイン拒否、各コレクションの入力検証、作成者と作成日時の保持、物理削除禁止は維持。
仕入先見積依頼は作成者以外のログインユーザーも編集可能。
firestore.rulesをieppurchaseへデプロイ済み。Firestore Emulator Rulesテスト80件成功、単体テスト48件成功。
過去のusers.active/role必須という記述より本項を優先。ユーザーのRFQアクセス再確認待ち。


## IEP-P2-007 のデプロイ保留（2026-09-09）
- 購入先採用・数量分割の画面、Callable Cloud Functions、Firestore Rulesをローカル実装済み。
- Cloud Functions第2世代はBlaze（従量課金）への切替が必要。ユーザー判断により切替・課金有効化は行わない。
- Functions / Firestore Rulesの本番デプロイは未実施。公開済みFunctionsは0件を確認。
- 本件は実装完了・本番デプロイおよびFirebase連携のユーザー確認待ちとしてクローズする。
- 再開条件: Blaze切替後、FunctionsとRulesをデプロイし、10へ6+4成功、6+5拒否、採用解除を実機確認する。
## IEP-P2-008 の実装（2026-09-09・完了／本番デプロイ保留）
- 採用時点の候補スナップショット（候補ID、仕入先、数量、単価、送料、総額、観測日時）を `sourcingDecisions` に固定保存。
- 採用・解除を同一Firestoreトランザクション内で `auditLogs` へ記録。変更前後、操作者、日時、RFQ・採用IDを保持する。
- `auditLogs` はログインユーザーが参照可能で、クライアントからの作成・更新・削除を拒否するRulesを追加。
- RFQ品目の採用パネルに、採用・解除の日時、操作者、理由を含む変更履歴を表示。
- `auditLogs(rfqId, createdAt desc)` Indexを追加。管理シートを完了・Codex確認OK・ユーザー確認OKへ更新済み。本番反映はP2-007と同様、Blaze切替後のFunctions/Rules/Indexデプロイが必要。
- 自動確認: Functions build、typecheck、lint、sourcingComparison test、production build 成功。Rules EmulatorはJava未設定のため未実施。
## IEP-P2-009 の実装（2026-09-09・ユーザー確認OK／本番反映保留）
- ユーザー確認: 2026-09-09「OKです。」を受領。Google Drive管理シートへの今回の反映は未実施。
- 仕入先見積の編集画面からPDF・画像・Excel（.xls/.xlsx、10MB以下）をアップロード・参照可能にした。
- `documents` にfileName、storagePath、mimeType、fileSize、documentType、entityType、entityId、rfqId、uploadedBy、createdAtを不変メタデータとして保存。
- 見積への紐付けはrevisionとrevisions履歴を同一トランザクションで更新し、紐付け失敗時は再試行可能。メタデータ書込みは一時失敗時に同一IDで再試行する。
- Firestore RulesでRFQ・見積・Storageパス・MIME・容量・操作者の整合性を検証。Storage Rulesで未認証、存在しないRFQ、形式外、空、10MB超、上書き、削除を拒否する。
- 自動確認: typecheck、lint、build、単体テスト82件、Firestore Rulesテスト113件、Storage Rulesテスト2件成功。
- 本番Storageバケット／Rulesは2026-09-10までに反映・ユーザー確認済み。

## 2026-09-10 本番反映状況（過去の保留記録より優先）
- Blaze切替後、Storageバケット、Storage Rules、Firestore Rules、Index、Callable Functionsを本番反映済み。
- ユーザー確認: 添付、採用、数量超過拒否、採用解除、変更履歴表示が本番で成功。
- 採用時の候補単価・数量・関連IDは、Callable FunctionがFirestoreの候補原本を再取得して検証する。
- 採用数量が残るRFQ品目は、数量・単位・状態・アーカイブをクライアントから変更できないRulesを追加。
- 自動確認: typecheck、lint、単体テスト82件、Firestore Rulesテスト114件、Functions build、production build成功。
- FunctionsはNode.js 22。Artifact Registryの未使用イメージは7日後に削除するcleanup policyを設定済み。
