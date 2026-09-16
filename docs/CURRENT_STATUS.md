## 品目編集内の楽天検索（2026-09-16・ユーザー確認待ち）
- RFQ品目の追加・編集で、EC購入候補の上に「楽天で検索」を追加。メーカー名と品番を検索語として初期入力する。
- 楽天検索結果は先頭から最大10件を品番で照合し、ストア掲載商品名に一致したものだけを、既存候補を上書きせず空き枠数まで自動反映する。5枠に満たなくても10件の判定後に終了する。
- 品目一覧の検索欄直下に一括楽天検索を追加。表示中かつEC検索を選択した品目を順番に処理し、品番一致候補を保存する。途中失敗は他品目を継続し、結果件数を表示する。
- 各候補のURLから商品ページを別タブで開ける。候補ごとに複数選択可能な「購入予定候補」チェックを追加し、既存候補は未選択として互換を維持する。いずれかをチェックすると品目状態を「見積取得済み」として保存する。既存のEC購入候補画面では従来どおり検索結果を個別選択できる。
- typecheck、lint、production build、品番照合・候補追記・購入予定候補を含む関連単体テスト19件成功。Firestore RulesテストはJava未導入のため未実施。購入予定候補の真偽値を許可し、採用済み品目でも状態だけを変更可能にするFirestore Rulesを2026-09-16に本番反映済み。本番Hostingは未反映。
# CURRENT_STATUS.md

## RFQ品目のEC購入候補5枠（2026-09-16・ユーザー確認待ち）
- 品目編集に、ストア掲載商品名・URL・価格を保存できるEC購入候補の入力枠を5件追加。空欄枠は保存せず、使用する候補は3項目すべて必須。
- RFQ品目へ最大5件の候補を保存し、Firestore Rulesでも件数・各フィールド・URL・価格を検証する。
- typecheck、lint、単体テスト118件、最小化なしのproduction build成功。Firestore RulesとHostingを2026-09-16に本番反映済み。公開先: https://ieppurchase.web.app 。

## RFQ品目の調達対応先選択（2026-09-15・ユーザー確認待ち）
- RFQ品目の追加・編集に「仕入先見積依頼」「EC購入候補」のチェックボックスを追加。両方選択可能で、少なくとも一方を必須とする。
- 仕入先見積依頼の対象品目とEC購入候補の案件品目を、それぞれ対応先が選択された品目だけに絞り込む。品目一覧にも対応先を表示する。
- 既存品目は保存項目が未設定でも従来どおり両方を選択済みとして扱い、表示互換を維持する。Firestore Rulesでも新規品目の選択必須とEC候補登録時の整合性を検証する。
- typecheck・lint・単体テスト116件成功。production buildとFirestore Rulesテストは端末の仮想メモリ不足で未完了。
- 2026-09-15にFirestore RulesとHostingを本番反映済み。公開先: https://ieppurchase.web.app 。ユーザー画面での動作確認待ち。
- ユーザー指摘により、対応先を編集ダイアログ内だけでなく品目一覧の各行で直接切替できるチェックボックスへ変更。仕入先見積・EC検索・両方を選べ、最後の1つは外せない。Hostingを再反映済み。

## RFQ内の一括翻訳（2026-09-15・完了／ユーザー確認OK）
- 品目一覧の「選択して一括翻訳」から対象を複数選択し、Google英訳を最大5件並行実行して各品目のtranslatedDescriptionへ保存。
- 品目ごとの成功・失敗を表示。再実行対象は失敗分だけを選択。原文・訳文の同時編集、削除、取消は保存時に拒否する。
- typecheck・lint成功、保存関連11テスト成功。Hosting未反映、ブラウザ実操作未確認。今回の対象は一括翻訳であり、一括商品検索は未実装。
- 動作確認: RFQ詳細でボタンを押す→2品目を選択→翻訳して保存→再読込して各品目の訳文と未選択品目が変わらないことを確認。
- ユーザー確認: 2026-09-15「翻訳はいい感じですね、いったんこれでOKとしましょうか。」を受領。管理シートへの反映は接続不可のため未実施。

## Google英訳の追加（2026-09-11・完了／ユーザー確認OK）
- ユーザーの明示指示により、AI抽出・OCR・Azure比較を保留し、Google Translationによる日本語から英語への手動翻訳だけを追加。
- RFQ品目編集で、検出言語・通信込み応答時間の表示、英訳の反映、既存translatedDescriptionへの保存に対応。原文変更後は古い結果を反映できない。
- translateGoogleText、GOOGLE_TRANSLATE_API_KEYのSecret設定、Firebase Hostingを本番反映済み。公開先: https://ieppurchase.web.app
- 自動確認: typecheck、lint、production build、フロントエンド82件、Functions 9件成功。ユーザー本番確認OK。
- Azure TranslatorはAzureサブスクリプション未登録のため保留。Azure用の一時Secretは実キー設定時に置き換える。
- 接続・操作手順: docs/TRANSLATION_COMPARISON.md。

## プロジェクト
IEPpurchase 資材調達管理システム

## 現在Phase・状態
Phase 3 — IEP-P3-004 販売見積基盤・freee翻訳明細転記（完了・ユーザー確認OK）。

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
1. 次のPhase 3機能を正式管理シートに従って選定する。

## 運用
1機能ごとに実装・自動確認・ユーザー動作確認を行い、OK後に次へ進む。
Phase 3以降の先行実装、実メール/本番外部送信、課金有効化は行わない。
進捗の正式記録は[Google Drive開発管理シート](https://docs.google.com/spreadsheets/d/1hXh2UDbJEP-6rBLrEY8fFtzL3k4_Ad7x9dHl0Tidng8/edit)。
正式要件・コード仕様PDFは明示依頼なく変更しない。

## 最終更新
2026-09-10（Phase 2クローズ・管理シート更新済み）
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
- ユーザー確認: 2026-09-10「OKでは管理シート記載してクローズして」を受領。管理シートのIEP-P2-007〜012を完了・Codex確認OK・ユーザー確認OKに更新済み。

## IEP-P2-013 楽天検索連携（2026-09-10・ユーザー確認待ち）
- 最新指示によりPhase 2追加連携を実装。楽天検索Function、検索画面、確認後のEC候補Snapshot保存を追加。
- Secret設定済。登録ドメイン https://sharprise.jp/ をReferer/Originとして送信し、実APIで六角ボルト20件取得成功。
- searchRakutenItemsを本番反映済み。未認証HTTP 401を確認。
- typecheck、lint、build、既存テスト82件、Functionsテスト5件、Rulesテスト115件成功。
- 認証済み画面での検索→候補保存はユーザー確認待ち（ブラウザ自動操作がsandbox起動エラー）。フロントHostingデプロイは未実施。
- 管理シートIEP-P2-013をユーザー確認待ちへ更新。詳細・操作手順: docs/IEP-P2-013.md。
- 次の作業はIEP-P2-013のユーザー確認と完了記録。未依頼のPhase 3実装へ進まない。
## IEP-P3-002 freee OAuthコールバック・Secret設定（2026-09-11・完了／ユーザー確認OK）
- 認証済み利用者だけが開始できるfreee OAuth認可導線と、事業所選択付き認可URLを追加。
- 10分で失効するランダムstateをハッシュ化して照合し、コールバック時に一度だけ消費する。
- 認可コードをサーバー側でトークンへ交換し、アクセストークンとリフレッシュトークンをGoogle Secret Managerの新しいSecretバージョンとして保存する。ブラウザ、Firestore、ログには保存しない。
- freee連携画面、Callable Function、HTTPSコールバックを本番デプロイ済み。見積書作成・送付は実装・実行していない。
- `FREEE_CLIENT_ID`、`FREEE_CLIENT_SECRET`、`FREEE_OAUTH_TOKENS` を設定済み。実行サービスアカウントに対象SecretのAccessorおよびVersion Adderを付与済み。
- 新しいfreeeプライベートアプリでOAuth連携に成功し、対象事業所の接続情報をSecret Managerへ保存できることをユーザー確認済み。
- 旧freeeアプリを削除し、旧Secret版を削除済み。現行版は `FREEE_CLIENT_ID@5`、`FREEE_CLIENT_SECRET@4`、`FREEE_OAUTH_TOKENS@2`。
- 自動確認: typecheck、lint、production build、単体テスト82件、Functions build、Functionsテスト5件成功。

## IEP-P3-003 翻訳済み品目の販売見積明細への取り込み・確認（2026-09-14・完了／ユーザー確認OK）
- RFQ詳細に販売見積明細（翻訳確認）を追加。アクティブなRFQ品目の`rfqId`、`rfqItemId`、品番、数量、単位、原文、英訳、見積用出力文を`salesQuotes/{rfqId}/items/{rfqItemId}`へ取り込む。
- 英訳未入力は明示表示し、見積用出力文を利用者が補完・修正できる。品番・数量・単位は翻訳・変更しない。
- 一括確定後は原文・訳文・出力文をスナップショットとして保持し、RFQ品目の後日の変更では上書きされない。Firestore Rulesでも確定後のヘッダー・明細更新を拒否する。
- 自動確認: typecheck、lint、production build、単体テスト82件、Firestore Rulesテスト成功。
- Firestore RulesとHostingを本番反映済み。ユーザー動作確認OKを受領し、Google Drive管理シートのIEP-P3-003を完了・Codex確認OK・ユーザー確認OKへ更新済み。

## IEP-P3-004 販売見積基盤・freeeへの翻訳明細転記（2026-09-14・完了／ユーザー確認OK）
- ユーザーの「基盤も実装しましょう」により、販売単価、税区分・税率・端数処理、ヘッダー、金額計算、保存版・履歴を追加。
- P3-003の確定出力文・品番・数量を保持し、freee摘要255文字と未翻訳確認を検証。送信前プレビューと明示登録操作を追加。
- サーバーで保存版・接続事業所を照合し、同時送信の重複を防止。明示拒否は再試行可能、結果不明時は再作成を停止して作成済みIDで復旧する。
- freeeExports配下はCallableのみ更新可能。原文・訳文・販売価格・送信Snapshot・結果履歴を保持。
- typecheck、lint、フロントbuild、Functions build、単体102件、Functions既存9件、Firestore Emulator124件成功。freeeとSecret Managerはテストでモック化し実登録なし。
- Firestore Rules、Hosting、saveSalesQuotePricing／sendFreeeQuotation／reconcileFreeeQuotation Functionsを2026-09-14に本番反映済み。先頭ゼロ付きfreee取引先IDを保存時に受け付ける。ブラウザ操作・実freee帳票確認はユーザー確認待ち。OAuthの期限切れ時は既存画面で再認可する（自動refreshは未追加）。
- ユーザー確認: 本番で販売見積の保存成功を確認。Google Drive管理シートを完了・Codex確認OK・ユーザー確認OKへ更新済み。\n- 詳細と動作確認手順: docs/IEP-P3-004.md。次はIEP-P3-005。

## IEP-P3-005 帳票・一連動作確認（2026-09-14・ユーザー確認待ち）
- 正式管理シートの受入条件に沿って結合テスト2件を追加。複数品目・改行・Unicode・小数数量・混在税率・訳文なしの手動確認、RFQ変更後のSnapshot保持、再送時のPOST一回、結果・履歴、長文と未確認訳文なしの保存拒否を検証。
- typecheck・lint・フロントbuild・Functions build成功。単体103件、Functions9件、Firestore Emulator126件成功。
- freeeとSecret Managerはモック。実freeeへの登録・帳票目視・ブラウザ一連操作は未実施。実帳票確認とユーザーOK後に完了とする。
- docs/IEP-P3-005.mdに2明細・税抜320円／税29円／合計349円の確認手順を記載。テストと資料のみ変更のため本番デプロイ不要。
- Google Drive管理シートをユーザー確認待ち／Codex確認OK／ユーザー未確認に更新済み。
- 次の作業: P3-005の実帳票確認と完了記録。

## freee取引先の名前選択（2026-09-14）
- ユーザー指示により、freee内部IDの手入力を名前検索・選択に変更。取引先コード設定は不要。
- searchFreeePartnersは接続事業所のGET /api/1/partnersを50件ずつ取得。名前検索・追加読み込み・空結果・認証期限切れ・権限不足に対応。ブラウザにはID・名前・コードだけを返す。
- 保存時に選択元事業所と現在の接続を照合し、GET /api/1/partners/{id}で有効性・IDを再確認。freeeから取得した名前を保存版に保持する。
- 旧クライアントの保存形式は互換性のため維持。新画面では名前選択が必須。登録拒否の旧見積は選び直して新しい版に保存する。送信済み・結果不明のロックは維持。
- typecheck・lint・フロントbuild・Functions build成功。単体103件、Functions9件、Firestore Emulator130件成功。実API検索・ブラウザ操作・実帳票はユーザー確認待ち。
- 主な変更: functions/src/freeePartners.ts、freeeQuotation.ts、src/features/salesQuotes/FreeePartnerPicker.tsx、FreeeQuotationSection.tsx。
- 次の作業: 本番画面で取引先名を選び直し、見積を保存して登録内容と帳票を確認する。
- 本番反映完了（2026-09-14）: searchFreeePartners作成、saveSalesQuotePricing更新、Hostingリリース成功。公開先 https://ieppurchase.web.app 。実API検索とユーザー操作確認は未実施。

## P3-005 保存後の登録確認ボタン修正（2026-09-14）
- ユーザー報告: 取引先選択・保存版2の保存後も「freeeへの登録内容を確認」が無効。
- 原因: Callable戻り値とFirestoreのマップ項目順の違いをJSON.stringifyで比較し、同じ値でも未保存と誤判定する実装。
- salesQuoteSettingsEqualで双方を同じスキーマの項目順へ正規化し、品目ID順で比較。実際の入力変更・不正入力・事業所変更・保存版競合の保護を維持。無効理由の案内も追加。
- 回帰テスト: 項目順・明細順だけの違い、項目の実変更、未完成入力の3件。単体106件成功。typecheck・lint・build成功。初回並列実行はメモリ不足、1ワーカー再実行で全件成功。
- 保存データ変更なし。Functions・Rules変更なし。実画面の再確認後に完了とする。

## P3-005 freee HTTP400の拒否理由表示（2026-09-14）
- 取引先を名前で選択し、登録確認ボタン修正後もHTTP400が継続することをユーザー画像で確認。400の原因は未確定。
- これまで捨てていた公式エラー形式errors[].messagesを、次回の明示登録時から画面・既存の結果履歴へ反映する。既存の過去エラー詳細は復元できない。
- 応答本文やヘッダー全体は保存しない。アクセストークンとBearer値を伏せ、最大5件・各300文字に制限。400で401の再認可案内を出す紛らわしい文言も修正。
- 不正JSON・HTML・過大な本文・詳細読取失敗では汎用エラーへ戻る。HTTP拒否の再試行可否と、結果不明時の再作成停止は維持。
- typecheck・lint・フロントbuild成功。単体109件成功、lint修正後の関連24件も成功。freeeへの実再送信はしていない。
- 次の作業: 修正反映後の明示登録で返される「freeeの詳細」を基に原因を修正し、帳票を確認する。

- 反映結果: sendFreeeQuotation の本番更新成功。Firestore Emulator結合テスト130件成功。HTTP400の原因は未確定で、次回の手動登録時の詳細応答を確認待ち。

## P3-005 摘要の不正文字対策（2026-09-15・ユーザー確認待ち）
- ユーザーの応答画像で「Lines > Descriptionに不正な文字が含まれています」を確認。システムが品番と出力文の間へ挿入していた改行を有力原因として対応。実APIでの解消確認は未実施。
- freee用摘要は品番と出力文をスペースで結合し、CRLF・CR・LF・タブ・Unicode行区切りをスペースへ変換。その他の制御文字は保存前に拒否する。原文・翻訳文・確定出力文は変更しない。
- プレビュー・255文字のカウント・保存ペイロードで同じ整形を利用。旧版は書き換えず、新版の再保存を画面で案内。旧改行入りペイロードは送信前にサーバーでも拒否する。送信済み・結果不明の再作成防止を維持。
- 自動確認: typecheck・lint・build成功、単体110件・Firestore結合131件成功。Java未検出はプロジェクト内の既存Java指定で解消。
- 動作確認: 画面を再読込し「販売見積を保存」で新版を作成、摘要がスペース区切りであることを確認して明示登録。API成功後の実帳票確認までは完了にしない。

- 本番反映: 未実施。Firebase CLIが credentials are no longer valid を返し、デプロイ失敗。firebase login --reauth 後に saveSalesQuotePricing・sendFreeeQuotation・Hosting を再デプロイする。freeeの再認可は不要。

- 2026-09-15 再認証後: saveSalesQuotePricing・sendFreeeQuotation・Hostingの本番反映成功。新版保存・手動登録・実帳票のユーザー確認待ち。

- 2026-09-15: 保存ボタンが表示されない事象を修正。Firestore初回読込時に既存保存版を編集状態へ反映し、旧版の摘要修正用に新版を保存できるようにした。typecheck・lint・build成功。Hosting本番反映成功。ユーザー確認待ち。

## P3-005 完了（2026-09-15・ユーザー確認OK）
- ユーザーが、摘要をスペース区切りにした新版の「販売見積を保存」が表示され、保存できることを本番で確認。
- 回帰確認: typecheck・lint・production build成功、フロントエンド単体110件・Firestore Emulator結合/権限131件成功。
- saveSalesQuotePricing・sendFreeeQuotation・Hostingの本番反映済み。freeeへの実登録・帳票確認はユーザーの明示実施時のみ行う。
