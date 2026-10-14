# Secret Managerの集約・移行・復旧

対象プロジェクト: `ieppurchase`。既存の認証情報をそのまま使い、freeeと楽天の静的キーをJSONへ集約する。RFQ、顧客、仕入先、販売見積、送信履歴等の業務データは変更しない。移行コマンドはfreeeへの見積登録、実メール送信、購入を行わない。

## 集約後の6種類

| Secret | 保存内容 | 参照方法 |
| --- | --- | --- |
| `FREEE_APP_CREDENTIALS` | JSONの`clientId`、`clientSecret` | `beginFreeeOAuth`、`freeeOAuthCallback`のSecret binding |
| `RAKUTEN_CREDENTIALS` | JSONの`applicationId`、`accessKey` | `searchRakutenItems`のSecret binding |
| `FREEE_OAUTH_TOKENS` | 既存のトークンJSON。`accessToken`、`refreshToken`、`authorizedAt`、`expiresIn`、`companyId`等 | Admin SDKで取得した数値版をSecret Manager APIで参照 |
| `GOOGLE_TRANSLATE_API_KEY` | Google翻訳キー | 既存のSecret binding |
| `AZURE_TRANSLATOR_KEY` | Azure翻訳キー | 既存のSecret binding |
| `GOOGLE_CLOUD_VISION_API_KEY` | Google画像OCRキー | 既存のSecret binding |

旧`FREEE_CLIENT_ID`、`FREEE_CLIENT_SECRET`、`RAKUTEN_APPLICATION_ID`、`RAKUTEN_ACCESS_KEY`の現行値をコピーし、コピー後に値の一致を確認する。キーの再発行、値の置換、freeeの認可URL・コールバックURL、楽天の許可WebサイトURLの変更は行わない。静的キーの更新時は、対応するbindingを使う全関数を再デプロイする。[Firebase公式Secret管理ガイド](https://firebase.google.com/docs/functions/config-env#managing_secrets)

秘密値を`.env`、ソース、ログ、移行記録、ブラウザ、Firestoreへ保存しない。移行スクリプトは秘密値をメモリ内だけで扱う。

## freeeトークンの数値版参照

既存の固定binding解除は、対象5関数の`secrets: []`を明示してデプロイする。項目を省略するだけではCloud FunctionsのPATCHで旧参照が残るため、発行するmanifestでも空一覧であることをテストし、本番のFunctions設定と実配信Cloud Run revisionを確認する。

Firestoreの`integrationSecrets/freeeOAuthTokens`には、次の管理情報だけを保存する。

- `currentVersion`: `projects/ieppurchase/secrets/FREEE_OAUTH_TOKENS/versions/18`のような数値版のリソース名
- `updatedAt`: server timestamp

トークン本体はSecret Managerに保持する。Firestore Rulesの既存の拒否ルールにより、一般ユーザーと匿名クライアントはこの管理情報の取得、一覧、作成、更新、削除ができない。参照・更新はサーバーのAdmin SDKから行う。

Secret Managerは、新規版を追加した直後の数値版アクセスには強整合性を提供するが、`latest`・aliasはその対象ではない。通常は数分、場合により数時間の反映遅延があるため、再認可後の数値版を管理情報へ保存し、その版を直接読む。[Google公式の整合性説明](https://docs.cloud.google.com/secret-manager/docs/reference/consistency)

管理情報がまだ存在しない移行途中だけ、従来の`latest`参照へ戻る。管理情報が不正な場合は別Secretや`latest`へ読み替えず、接続不可として扱う。API応答のproject番号表記は信頼できる応答の境界でproject ID表記へ正規化し、保存済み管理情報は対象project・Secret・数値版との一致を厳格に検証する。

再認可の保存順序は、新版追加、同じ数値版の読み返し・内容一致確認、Firestore transactionによる`currentVersion`更新である。版番号は数値で比較し、古い認可処理が後から終了しても新しい版へ進んだ管理情報を戻さない。

読み取り中に参照版が破棄された場合は管理情報を再取得する。より新しい版へ変わっていれば、その版で再試行する。管理情報が変わらない失敗や、最大4回のアクセスで解決しない競合は一般的な読み取りエラーを返す。秘密値やAPI応答本文をエラーへ含めない。

## 旧版保持と自動整理の切替

`FREEE_OAUTH_PRUNE_OLD_VERSIONS`の既定値は`false`。移行と動作確認の間は、旧版を保持し、自動破棄を行わない。この状態では再認可のたびに保管版が増えるため、集約コードの反映だけで無料枠へ収まるわけではない。

旧版破棄の承認後にだけ、`functions/.env.ieppurchase`の非秘密設定へ次を設定し、`freeeOAuthCallback`を再デプロイする。

```dotenv
FREEE_OAUTH_PRUNE_OLD_VERSIONS=true
```

有効時は、新版の保存・検証・管理情報更新が成功した後、その新版より小さい有効・無効の旧版だけを破棄する。別の同時認可が作成した上位版や、自分が保存した新版は破棄しない。整理に失敗した場合は秘密値を含まない警告を記録し、保存できた認可そのものは成功として扱う。費用確認と手動整理が必要になる場合がある。

無効へ戻す場合は設定を`false`にしてcallbackを再デプロイする。既に破棄した版は戻らない。

## Firebase CLIによる自動破棄を防ぐ管理

Firebase CLIは未参照Secret版を自動整理する場合があり、`functions:secrets:prune`も関数のbindingを基準にする。[Firebase公式Secret管理ガイド](https://firebase.google.com/docs/functions/config-env#managing_secrets)

`FREEE_OAUTH_TOKENS`は固定bindingを使わずAPIから直接参照するため、Firebase CLIの未使用判定に任せない。移行スクリプトの`prepare`は、トークンSecretと旧静的4種類から`firebase-managed`ラベルを外し、`iep-managed=migration-held`を付与して保持する。トークンSecretは移行後もこの管理を継続し、`firebase-managed=true`へ戻さない。

トークンSecretの作成・更新・整理は、OAuth callbackまたはこの移行スクリプトで行う。`firebase functions:secrets:set FREEE_OAUTH_TOKENS`による管理への戻しや、一般的なpruneだけに依存した整理は避ける。ラベルの設定とFirebase CLIの挙動はCLI更新時にも確認する。

トークン利用関数の実行サービスアカウントには、対象Secret単位の`roles/secretmanager.secretAccessor`を維持する。callbackの実行サービスアカウントには同じSecret単位の`roles/secretmanager.secretVersionManager`を付与する。project全体へSecret管理権限を広げない。

## 移行コマンド

リポジトリ直下で実行する。Firebase CLIのログイン権限を使い、projectはスクリプト内で`ieppurchase`へ固定する。移行中は別のSecret更新、freee再認可、並行デプロイを行わない。

### 1. 旧版を保護して新Secretを準備

```powershell
node scripts/migrateSecretCredentials.cjs prepare
```

全SecretとFunctions、対象8関数の実配信Cloud Run revisionを記録し、稼働中の固定参照版から静的キーをコピーする。必要なSecret単位のIAM権限と、旧5種類の保持ラベルを設定する。初回の`before.json`は再実行でも上書きしない。新Secretが既に存在する場合は、値の一致を確認して再利用する。

記録先は`tmp/secret-credentials-migration/`。Secret値は含まないが、移行・復旧に必要なため、この作業が完了するまで記録を保持する。

### 2. 現行トークンの管理情報を初期化

```powershell
node scripts/migrateSecretCredentials.cjs initialize-token-pointer
```

現行のトークンを読み、数値版の名前だけを管理情報へ保存する。更新競合を検出し、既により新しい版が保存されていれば維持する。既存トークンの期限は延長しない。

### 3. 自動整理を無効にして対象8関数を反映

`FREEE_OAUTH_PRUNE_OLD_VERSIONS=false`または未設定であることを確認してから実行する。

```powershell
npm --prefix functions run build
npx firebase deploy --only "functions:beginFreeeOAuth,functions:freeeOAuthCallback,functions:getFreeeConnectionStatus,functions:searchFreeePartners,functions:saveSalesQuotePricing,functions:sendFreeeQuotation,functions:reconcileFreeeQuotation,functions:searchRakutenItems" --project ieppurchase
```

Hosting、Firestore Rules、業務データの変更はこの移行に含めない。デプロイが部分的に失敗した場合は旧版を保持したまま対象関数を再実行し、次の検証が成功するまで整理しない。

### 4. 配信状態とコピー値を検証

```powershell
node scripts/migrateSecretCredentials.cjs verify
```

全世代のFunctionsで旧静的キー・トークンの固定参照が残っていないこと、対象8関数がACTIVEで各新revisionへ100%配信されていること、実配信revisionの旧参照がないこと、新Secretの値が元の参照版と一致すること、トークン管理情報が読めることを確認する。到達不能regionや配信分割があれば停止する。

このSecret読取りは移行操作者の権限である。実行サービスアカウントのAccessor保持も確認し、ブラウザで既存の楽天検索とfreee連携画面を確認する。freeeトークンが既に期限切れの場合、接続状態が未接続になることは従来通りであり、移行によって再認可を実行することはない。

### 5. 破棄計画を作成して承認を得る

```powershell
node scripts/migrateSecretCredentials.cjs cleanup-plan
```

`tmp/secret-credentials-migration/cleanup-plan.json`へ、保持6版と破棄候補の数値版リストを保存する。今回の調査から想定する破棄候補は、旧静的11版とトークン旧16版の計27版。実際の件数・版は、その時点の生成結果を優先する。

旧版破棄は不可逆なため、具体的なリストと復旧上の制約をユーザーへ示し、承認後に次へ進む。将来のcallback自動整理の有効化もこの時点で承認対象を明確にする。

### 6. 承認済み計画を実行

承認前には実行しない。

```powershell
node scripts/migrateSecretCredentials.cjs finalize --approved-plan
```

実行前に配信・固定参照・現行トークン・新規版の発生を再確認する。計画作成後に新しい版が作成された場合等は停止し、再度計画を作る。各候補の破棄前にも現行トークンではないことを確認する。

`finalized.json`で保持版と実行結果を確認する。その後、承認済みの場合だけ自動整理を有効にしてcallbackを再デプロイし、`verify`で設定と配信を確認する。

## 復旧

破棄前は旧Secret版を保持しているため、元の設定を使う旧ソースを再デプロイできる。切戻し中は自動整理を無効に保ち、旧版を整理しない。

破棄後は、破棄版を固定参照する旧Cloud Run revisionへの直接切戻し・cold startはできない。静的キーは新JSON Secretの値をメモリ内で読み、旧名のSecretへ必要な項目を再作成してから、旧ソースを再デプロイする。元の数値版IDを再作成することはできないため、旧revisionの再利用ではなく新たなデプロイが必要になる。

破棄したOAuthトークン版の内容は復元できない。保持中の現行版が利用可能なら維持する。必要なトークンを失った場合や、期限切れ・失効の場合はfreee画面から再認可し、新しいトークンと数値版管理情報を保存する。トークンをFirestoreや平文ファイルへ退避する復旧方法は使わない。

## 費用の範囲

Secret Managerの無料枠は、同じ請求先アカウント全体で月6保管版、アクセス月10,000回、ローテーション通知月3回。EnabledとDisabledはいずれも保管課金対象であり、無効化だけでは保管料金は止まらない。automatic replicationは1保存先として課金され、保管期間に応じて計算される。[Google公式料金表](https://cloud.google.com/secret-manager/pricing)

整理後の通常保管を6版へ減らして無料枠を目指す。再認可では安全な保存を先に行うため、新版追加から旧版整理まで一時的に7版以上となる。同時再認可、整理失敗、移行中の旧版保持、同じ請求先の他project、アクセス数等によっても費用が発生し得るため、完全な0円は保証しない。

既に発生した保管料金は取り消されない。Cloud Functions、Firestore、翻訳、OCR、その他サービスの料金は別であり、この変更によってシステム全体が無料になるわけではない。最終的な料金は請求レポートで確認する。

## 2026-10-14の反映・確認状況

8関数の本番切替、旧固定binding解除、元のキーと新JSONの値一致、各新revisionへの100%配信を確認した。楽天実検索は20件、未認証Callableは401、state無しOAuth callbackは400。typecheck・lint・フロント/Functions build成功、フロント198件・Functions40件・Firestore Emulator146件成功。

freeeトークンの管理情報は18を保持。移行前から期限切れのため、画面での再認可・取引先検索はユーザー確認が必要。実行service accountへのなり代わり検証は403で利用不能だったため、権限を拡張しない。Secret単位の読取り権限は移行準備で維持・設定した。

ユーザーから「旧27件の破棄と今後の自動整理を承認する」の明示承認を受領。配信中の参照と保持6版のENABLED状態を再確認して旧27版を破棄し、保管33件から6件へ削減した。続いて`FREEE_OAUTH_PRUNE_OLD_VERSIONS=true`としてcallbackを本番再反映した。

最終確認で、保管6版、対象8関数のACTIVE・新revision100%配信・旧bindingなし、Secret単位accessor／version manager権限、自動整理true、楽天実検索20件・Callable401・state無しcallback400を確認済み。元の静的キーとのコピー一致は、破棄前に確認した不変の版IDの記録を保持している。実freee再認可と実行service accountへのなり代わり検証（403）は未実施として維持する。

承認済み破棄対象は`tmp/secret-credentials-migration/approved-cleanup-plan.json`、破棄結果は`finalized.json`、最終確認は`verified.json`／`smoke.json`へ記録した。現在の`cleanup-plan.json`は整理後の状態で、追加破棄候補は0件。確認結果のmetadataファイルに秘密値は含まれない。

旧名のSecretと破棄済み版のmetadataは保持しているため、コンソールの一覧には旧名が残る。旧名にEnabled／Disabledの保管版はなく、その旧版の保管料金は発生しない。破棄した値は復元できず、必要な静的キーは新JSONから旧名へ再作成して旧ソースを新たにデプロイする。

## ユーザー確認完了（2026-10-14）

ユーザーから「freeeと楽天は動作することを確認しました。」と確認OKを受領し、この費用改善を完了として記録した。

その後、秘密値を取得せず、`node scripts/migrateSecretCredentials.cjs audit-storage`で本番のmetadataだけを読み取った。freeeの管理情報は19へ進み、トークンの保管版は19の1件だけがENABLED。旧18を含む旧トークン版は整理され、総保管は6件、自動整理設定はtrue、旧静的キーの有効／無効版は0件だった。再認可後も版数を6件へ戻す処理が本番で動作したことを確認できた。

この確認結果は`tmp/secret-credentials-migration/user-confirmation-audit.json`に保存した。以前の`verified.json`／`smoke.json`の18・期限切れは、ユーザー再認可前の履歴である。実行service accountへのなり代わり検証（403）と、freee見積の実登録は未実施であり、今回のユーザー連携確認とは別に扱う。
