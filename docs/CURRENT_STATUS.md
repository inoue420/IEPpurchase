## 開発運用：Secret Manager集約（2026-10-14・完了／ユーザー確認OK）
- ユーザーの「2でお願い、既存には影響がないように」に対応。freeeのClient ID/SecretをFREEE_APP_CREDENTIALS、楽天のApplication ID/Access KeyをRAKUTEN_CREDENTIALSのJSONへ集約。稼働中の固定版からメモリ内でコピーし、本番の新しい固定版との値一致を確認。キーの再発行・認可URL・楽天の許可サイト・業務データ・画面・外部登録処理は変更していない。
- freeeトークン利用5関数の固定Secret bindingを空一覧で明示解除。FirestoreのintegrationSecrets/freeeOAuthTokensには秘密値を含まないcurrentVersionとserver timestampのみを保存し、Secret Managerの数値版を参照する。API応答のproject番号を正規化、transactionで版番号の後戻りを防止し、破棄と読取りの競合時は最新の管理情報を再取得して再試行する。
- 新版保存→数値版読み返し一致→管理情報更新の後だけ旧版を整理する処理を追加。移行中は自動整理FREEE_OAUTH_PRUNE_OLD_VERSIONSをfalseに保ち、ユーザー承認後にtrueへ変更してfreeeOAuthCallbackを本番再反映済み。tokenおよび旧4種類のラベルをFirebase CLIの自動prune対象から外し、移行中の旧版破棄を防止。Secret単位のaccessor／version manager権限を維持・設定。
- 自動確認: typecheck・lint・フロントproduction build・Functions build成功。フロント198件、Functions40件、Firestore Emulator146件成功。新規のJSONパーサー・数値版・同時更新・秘密値非露出・一般ユーザーの管理情報読書拒否・空binding manifestを検証。sandboxの一時ファイルrename／ローカル接続制約は許可済み再実行で解消。既存lint警告1件とbuildの依存注釈・bundleサイズ警告は継続。
- 対象8関数を本番更新済み。初回の新boolean設定未指定をfalse明示で修正。設定の省略では旧bindingが残ることを本番確認で検出し、空一覧を明示して5関数を再反映。Cloud Functions第1/第2世代の参照とCloud Runの実配信revisionを照合し、対象8関数がACTIVE・新revisionへ100%配信・旧bindingなしを確認。
- 本番確認: 楽天の実検索で20件取得、未認証Callable401・state無しOAuth callback400を確認。freeeトークン18は移行前から期限切れのため、実再認可とfreee見積登録は未実施。実行service accountへのなり代わり検証は403のため未実施（権限を拡張せず、Secret単位accessorを設定して維持）。
- 2026-10-14にユーザーが「旧27件の破棄と今後の自動整理を承認する」と明示承認。本番の全Functions参照・対象の実配信revision・保持6版がENABLEDであること・currentVersionを再確認し、承認済み旧27版を破棄済み。33保管版から、新しい静的2版＋トークン18＋翻訳/OCR3版＝6版へ削減。旧名のSecretと破棄版のメタデータは残すが、有効／無効の保管版は0でありその旧版の保管課金は停止。
- 最終本番確認（2026-10-14）: 保管6版、対象8関数ACTIVE／新revision100%配信、旧bindingなし、元のキーのコピー一致を示すimmutable版の確認記録、tokenのaccessor／version manager権限、自動整理trueを確認。楽天実検索20件・Callable401・OAuth callback400も再確認。実freee再認可・実行service accountへのなり代わり（403）は未実施を維持。
- ユーザー確認（2026-10-14）: 「freeeと楽天は動作することを確認しました。」と動作確認OKを受領。続いて秘密値を取得しない本番メタデータ監査で、freeeのcurrentVersionが19へ進み、トークン19だけがENABLED、旧18を含む旧トークン版が整理済み、総保管版が6件、自動整理true、旧静的4種類の有効／無効版が0件を確認。実再認可後の版更新・自動整理を本番で確認できた。なり代わりによる検証（403）とfreee見積の実登録は引き続き未実施で、ユーザーの連携動作確認と区別する。監査結果: tmp/secret-credentials-migration/user-confirmation-audit.json。
- 破棄版を参照する旧Cloud Run revisionへ直接切戻しはできない。集約Secretから旧名を再作成して旧ソースを再deployする復旧手順はdocs/SECRET_MANAGER.md。値を含まない承認対象一覧はtmp/secret-credentials-migration/approved-cleanup-plan.json、実行結果はfinalized.json、最終確認はverified.json／smoke.jsonへ記録。
- 通常保管6版でも再認可の安全な追加・整理中は一時7版以上となる。既発生料金・月1万回を超える読取り・別サービス費用は別扱いで、完全0円は保証しない。管理シート更新不要（運用費用の改善）。コミット未実施。既存のdevバージョン関連未コミット変更は保持。
- 主な変更: functions/src/freee.ts、freeeQuotation.ts、rakuten.ts、secretCredentials.ts、oauthTokenStore.ts、freeeTokenMetadata.ts、scripts/migrateSecretCredentials.cjs。移行・復旧手順: docs/SECRET_MANAGER.md。値を含まない本番確認結果・破棄一覧: tmp/secret-credentials-migration/。
- 次の作業: 今回のSecret Manager費用改善は完了。次の機能はユーザーの指示に従う。

## 開発運用：dev起動時の開発版表示（2026-10-14・ユーザー確認待ち）
- ユーザーがビルド後のv1.0.1表示を確認。変更のないタグ付きコミットではdev起動時にも正式番号のみとなる従来仕様に対し、開発サーバーでは常に「（開発版）」を表示するよう追加修正。
- Viteのcommandがserveの場合に開発版指定を渡す。変更のないタグ付きコードはdevで`v1.0.1（開発版）`、buildで`v1.0.1`。変更・タグ以降の更新・Git取得不能の既存表示は維持。
- 自動確認: typecheck・lint・production build成功。関連テスト8件成功（cleanタグのdev/build表示差とdirty時の表示を含む）。初回sandbox一時ファイルrenameのEPERMを再実行で解消。lintの既存tmp警告とbuildの既存依存注釈・bundleサイズ警告は継続。
- 開発サーバーの起動成功を確認。配信モジュールのHTTP取得はsandboxのソケット制約と再試行の応答待ちで確認未完了。実ログイン後の表示はユーザー確認待ち。
- 主な変更: vite.config.ts、scripts/gitVersion.ts、scripts/gitVersion.test.ts、docs/RELEASE.md。管理シート更新不要（開発運用の補助変更）。コミット・タグ作成・本番反映は実行していない。
- 次の作業: 起動中のdevを停止して`npm run dev`で再起動し、アカウント下に「（開発版）」が表示されることをユーザー確認する。

## 開発運用：Gitタグによるバージョン自動表示（2026-10-14・ユーザー確認OK／ビルド後表示確認済み）
- ユーザー指示により、ログイン後の共通アカウント欄でメールアドレスの下へバージョンを表示。Viteの起動・ビルド時にGitタグを文字列として埋め込み、ブラウザでGit/GitHubアクセスは行わない。
- `v1.0.0`形式の軽量タグ・注釈付きタグに対応。タグ付きコミットかつ変更なしの場合のみ正式番号を表示。タグ以降のコミット、未コミット・未追跡ファイルは開発版と区別。Git・タグ取得不能でも通常のdev/buildを利用可能。
- 既存の`npm run build`とHosting deployを維持。docs/RELEASE.mdへVS Codeコミット・同期後の4行、既存タグの保持、再ビルド、過去版取り出しの手順を追加。
- 自動確認: typecheck・lint・production build成功。フロントエンド既存190件＋実Gitリポジトリを使うバージョン判定7件＝197件成功。テスト初回はsandbox内の一時ファイルrenameでEPERMとなり、再実行で全件成功。lintは既存tmp/rfq-research/main.tsxのFast Refresh警告1件、buildは既存の依存ライブラリ注釈・大きいbundle警告あり。
- 生成JSへ`v1.0.0-dirty（開発版）`が埋め込まれ、未置換の`__APP_VERSION__`が残らないことを確認。Functions・Rules・データ変更なし。実ログイン後のブラウザ表示はユーザー確認待ち。
- 主な変更: scripts/gitVersion.ts、vite.config.ts、src/vite-env.d.ts、src/features/auth/AuthGate.tsx。READMEとローカル手順・進捗資料を更新。既存正式タスクへの紐付けがない開発運用の補助変更として管理シート更新不要。
- 次の作業: ユーザーがVS Codeで今回の変更をコミット・同期し、新タグ（例v1.0.1）を登録・push後にbuild／Hosting deploy。再読み込み後の正式番号表示を確認する。既存v1.0.0タグは付け替えない。

## RFQ品目編集の検索結果クリア・楽天再検索（2026-10-14・ユーザー確認待ち／本番反映済み）
- 品目編集（追加時も共通）のEC購入候補上部へ「検索結果をクリア」「楽天検索実行」を追加。クリアで全10枠のストア掲載商品名・URL・価格と購入予定チェックを空にする。変更は既存の保存操作で確定し、キャンセル時は保存済み候補を保持する。
- 「楽天検索実行」で入力中のメーカー名＋品番を既存のsearchRakutenItemsへ送信。既存の上位10件・品番照合・空き枠追加・価格昇順・検索後状態判定を共通利用する。検索語を手動変更する従来の検索ダイアログは「検索語を指定して検索」から利用可能。
- 検索中は入力・クリア・保存・閉じる操作と多重実行を抑止。通信失敗時は候補と状態を保持し、0件の場合も既存の検索後状態判定を適用する。
- 自動確認: typecheck・lint・production build成功、フロントエンド単体190件成功。初回テストはsandbox内の一時ファイルrename（EPERM）で開始不能、再実行で全件成功。
- ブラウザでテストデータ・検索/保存モックを使い、全10枠クリア、直接検索、検索中の操作制御、上位10件と品番照合、0円を含む価格昇順、候補保存、空候補保存、通信失敗時の保持、0件の状態、キャンセル時の保持、従来の検索ダイアログを確認。実楽天API・本番Firestoreへの書込みは未実施。
- 主な変更: src/features/rfqs/RfqItemDialog.tsx。Firestore Rules・Functionsの変更なし。Hostingを2026-10-14に本番反映済み。公開先: https://ieppurchase.web.app 。
- 2026-10-14初回のHostingデプロイはFirebase CLIの認証期限切れ（credentials are no longer valid）で失敗し、再認証を依頼。ユーザーのOKは実装・反映の承認として記録し、本番動作確認とは区別する。
- 2026-10-14再認証後: Hostingのアップロード・バージョン確定・リリース成功。公開ページHTTP 200、配信中の `/assets/index-BmB0-NV8.js` と検証済みローカルビルドのSHA-256一致を確認。実楽天検索・本番データ保存はユーザー動作確認待ち。
- Google Drive管理シートのIEP-P3-009へ追加実装・自動/ブラウザ確認結果・本番反映を追記し、ユーザー確認待ちを維持。書込み後の再取得で反映を確認。
- 次の作業: 本番を再読込し、品目編集でクリア→楽天検索実行→保存→再読込をユーザー確認する。動作確認OK後に完了記録する。

## IEP-P3-009 RFQ品目の楽天検索後状態（2026-10-13・ユーザー確認待ち／本番反映済み）
- 「表示中のEC対象を楽天で検索」で、上位10件から品番一致候補が見つかれば「候補掲載済」、一致候補が0件なら「検索結果無し」を品目へ保存する。重複URLだけの結果も候補ありとして扱い、既存候補は消さない。
- 購入予定候補が選択されていれば、従来どおり「見積取得済み」。再検索では見積取得済み・発注済み・入荷済みを戻さない。個別編集で楽天候補を反映する場合も同じ判定を利用する。
- 一致0件・候補重複時も状態保存を行う。入力不足・空き枠なしでの検索省略や通信・保存失敗は「検索結果無し」にせず、実行結果に区別して表示する。
- 保存トランザクションで最新の購入予定候補と状態を再取得し、検索中のメーカー・品番・EC対象の変更、取消・削除時は検索結果の反映を拒否する。
- 品目状態とFirestore Rulesへ `candidates_listed` / `no_search_results` を追加。RFQ案件の「見積取得済」はこれらの候補状態だけでは成立せず、従来どおり全有効品目の見積取得完了を必要とする。
- 自動確認: typecheck・lint・production build・Functions build成功。フロントエンド単体190件、Firestore Emulator140件成功。既存の一括登録上限50件と矛盾していたテストの期待値を修正。
- Hosting／Firestore Rulesを2026-10-13に本番反映済み。公開先: https://ieppurchase.web.app 。実楽天検索・購入予定候補選択後のユーザー確認待ち。
- 動作確認: RFQ詳細で一括楽天検索後の「候補掲載済」「検索結果無し」を確認し、品目編集で購入予定候補を選択・保存後に「見積取得済み」となること、再読込後も保持されることを確認する。
- 次の作業: IEP-P3-009のユーザー動作確認・完了記録。

## IEP-P3-008 RFQ一覧の見積進捗ステータス（2026-10-13・完了／ユーザー確認OK）
- RFQ一覧・詳細のステータスを「見積取得中」「見積取得済」「見積作成済」「完了」で表示し、表示名での一覧検索にも対応。
- 有効品目が1件以上あり、すべて見積取得済み（または発注・入荷済み）なら「見積取得済」。取消・アーカイブ済み品目は対象外とし、対象品目0件は「見積取得中」とする。
- `salesQuotes/{rfqId}/freeeExports/current.status == sent` の既存転記成功記録があれば、品目状態より優先して「見積作成済」。下書き・送信中・拒否・結果不明は転記完了としない。
- 案件編集で指定した「完了」を最優先とする。既存のキャンセル表示は維持し、保存済みRFQデータ・Rules・外部登録処理は変更しない。
- 品目とfreee転記状態を購読し、両方の初回取得完了まで「確認中…」、取得失敗時はエラーと再試行を表示する。終了案件は追加の進捗購読を行わない。
- 自動確認: typecheck・lint・production build・Functions build成功。フロントエンド単体166件（進捗判定・購読23件を含む）、OAuth診断2件成功。既存lintエラーの不要な正規表現エスケープを1文字修正。
- ユーザーのFirebase CLI再認証後、Hostingの本番反映成功。公開先: https://ieppurchase.web.app 。2026-10-13にユーザーから「ありがとう。いい感じです。」の確認OKを受領。
- 動作確認: RFQ一覧を再読込し、全品目見積済みなら「見積取得済」、既存のfreee転記成功案件なら「見積作成済」、案件編集で完了を指定した案件なら「完了」を確認する。先の状態が優先されることと表示名検索も確認する。
- 次の作業: ユーザー依頼のRFQ品目の楽天検索後状態表示（IEP-P3-009）。

## IEP-P6-004 画像・スキャン表のOCR品目候補化（2026-09-18・ユーザー確認待ち）
- Google Cloud VisionのDOCUMENT_TEXT_DETECTIONを利用し、10MB以下の画像とPDF先頭5ページから文字・平均信頼度を取得する。
- OCRダイアログの貼り付け枠へスクリーンショットをCtrl+Vで貼り付け、そのままOCR対象にできる。ファイル選択も従来どおり利用可能。
- Visionの単語座標を行ごとにまとめ、メーカー・製品名／詳細・品番・数量・単位の見出し位置から列境界を復元する。行番号列を除外し、単位列がない場合は「個」、品名中の英数字型番は品番候補として補完する。
- 中央寄せ見出しによってメーカー欄へ製品名が混入する事象を、複数データ行の大きな横方向の空白位置から列境界を補正する方式で修正。
- 製品名見出しが「製」「品」「名」など複数のOCR単語に分割されるケースを位置ベースの結合で処理する。製品名・数量の両列がない表を2列として誤復元しない。Functions build・16テスト、lint成功。実画像での改善はユーザー確認待ち。
- 最終調整用に、候補表へ「列をまとめて編集」を追加。選択行または全候補行に対し、メーカー・品番・品目説明・数量・単位をコピー、移動、または消去できる。移動では元の列を空欄にし、入力エラーとなった行は登録対象から外す。品目説明→品番の一括移動などを、保存前に行える。
- 罫線付き画像では画像処理で縦横の罫線を検出し、十分な格子を検出した場合は縦罫線を列境界として優先する。罫線なし画像、罫線が不完全な表、PDFは従来のVision文字座標・空白幅による推定へ自動フォールバックする。Functions build・17テスト成功。
- OCR抽出文から最大50件の品目候補を作成。メーカー名・品番・品目説明・数量・単位を修正し、選択行だけを既存の一括登録トランザクションで保存する。自動確定は行わない。
- ファイルは利用者が「OCRして候補を作成」を実行した時だけGoogle Cloud Visionへ送信し、この画面からファイル本体は保存しない。APIキーはGOOGLE_CLOUD_VISION_API_KEYとしてSecret Managerに保存。
- typecheck、lint、production build、フロントエンド単体140件、Functions 14件成功。extractVisionOcrTextとHostingを2026-09-18に本番反映済み。公開先: https://ieppurchase.web.app 。
- 動作確認手順: docs/IEP-P6-004.md。

## IEP-P3-006 RFQ品目の一括手入力（2026-09-18・完了／ユーザー確認OK）
- RFQ品目一覧へ「表からまとめて追加」を追加。メール本文などからタブ・パイプ・カンマ区切りの見出し付き表を貼り付け、メーカー名・品番・商品名／詳細・数量・単位・備考を判定する。
- 最大50件をプレビューし、各行を修正・選択して最終確認後に登録する。入力エラー行は選択不可とし、既存のRFQ品目入力制約を共通利用する。
- 選択品目は同一Firestoreトランザクションで連番を採番して一括保存し、途中登録を防止する。外部送信・ファイル取込・OCRは含めない。
- typecheck、lint、production build、フロントエンド単体132件、Firestore Emulator Rulesテスト成功。複数品目の連番採番を許可するRulesを2026-09-18に本番反映済み。公開画面での一括登録はユーザー確認待ち。
- ユーザー動作確認で、カンマ見出しと空白揃えの本文行では品番・数量が分割されないことを確認。見出しがカンマ（半角・全角）で、本文行が複数空白または全角空白で揃えられた形式を列数一致時だけ分割するよう補正し、Hostingを2026-09-18に再反映済み。typecheck・lint・production build・関連5テスト成功。ユーザー確認OKを受領。
- 動作確認手順: docs/IEP-P3-006.md。

## freee摘要へのメーカー名追加（2026-09-16・ユーザー確認待ち）
- freeeへ送信する明細摘要を「メーカー名＋品番＋確定出力文」へ変更。メーカー名が未登録の品目は従来どおり品番＋確定出力文とする。
- 入力中・保存済み送信内容のプレビュー、255文字上限の判定、送信ペイロードを同じ形式で統一。既に作成済みの保存版・freee見積書は変更しない。
- typecheck、lint、production build、フロントエンド単体123件、Firestore Rules／Functions結合136件成功。saveSalesQuotePricingとHostingを本番反映済み。公開先: https://ieppurchase.web.app 。

## 販売見積の原価・マージン自動計算（2026-09-16・ユーザー確認待ち）
- 販売見積明細へ購入金額、送料、マージンを追加。購入金額はRFQ品目の「購入予定候補」の価格を自動転記し、複数選択時は合計する。候補未選択時や補正が必要な場合は手入力できる。
- 送料は空欄、マージンは1.2を初期値とし、販売単価を（購入金額＋送料）×マージンで計算して10の位を四捨五入（100円単位）する。
- 原価項目は販売見積の内部保存版に保持するが、freee送信項目には追加しない。送信する販売単価は従来どおり1項目のみ。
- typecheck、lint、production build、フロントエンド単体123件、Firestore Rules／Functions結合136件成功。saveSalesQuotePricingとHostingを本番反映済み。公開先: https://ieppurchase.web.app 。

## 販売見積明細の再編集・再取り込み（2026-09-16・ユーザー確認待ち）
- 販売見積明細の取り込み後も「編集を再開」で見積用出力文を修正し、再確定できるように変更。
- 「RFQ品目を再取り込み」でRFQの最新の原文・英訳・数量を反映し、取消・アーカイブ済み品目を販売見積明細から除外する。手修正した出力文が上書きされるため実行前に確認を表示する。
- freee用の販売見積保存版が存在する場合は、保存済み内容との不整合を防ぐため再編集・再取り込みを拒否する。
- typecheck、lint、production build、フロントエンド単体121件、Firestore Rulesテスト136件成功。Firestore RulesとHostingを本番反映済み。公開先: https://ieppurchase.web.app 。

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
