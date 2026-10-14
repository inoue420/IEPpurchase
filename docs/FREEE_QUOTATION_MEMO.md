# freee見積書の社内メモ

2026-10-14：ローカル実装・自動確認・本番反映・ユーザー転記確認済み。本件は完了・クローズ。

## 記載内容

販売見積を保存すると、RFQから取得した案件番号と本番の案件詳細URLを社内メモに設定する。

```text
案件リンク：https://ieppurchase.web.app/rfqs/{rfqId}?freeeExportRevision={保存版}
案件番号：RFQ-2026-000001
```

URLは通常の`/rfqs/:rfqId`詳細画面へ遷移する。未ログイン時は既存のログイン画面を経由する。`freeeExportRevision`は転記照合用であり、過去版の案件画面を表示する指定ではない。保存版ごとにメモを区別し、同一明細・金額の改訂で前回帳票を今回の転記成功と誤認しない。

案件番号はサーバーのRFQから取得する。顧客向け備考`quotation_note`は既存入力のまま保持する。freeeの`memo`は社内メモで、帳票には出力されない。

社内メモはAPIの文字列フィールドへ送る。ユーザーの実画面確認では、freee上のURLはクリック不可だが、URLをブラウザへコピーすると対象RFQを開ける。URLと案件番号を文字列で転記し、必要時にURLをコピーして開く運用を完成形とする。

最終調査では、[公式OpenAPIのQuotationRequest.memo](https://github.com/freee/freee-api-schema/blob/master/iv/open-api-3/api-schema.yml#L8947)は文字列・1〜2000文字の定義で、リンク属性やHTML／Markdown形式を指定する項目がないことを確認した。[公式社内メモヘルプ](https://support.freee.co.jp/hc/ja/articles/43630340840089)もテキストエリアへの記入・保存を説明しており、リンク埋め込み手順は記載されていない。対応不可を明言した仕様まではないが、現行の公式仕様で埋め込みを実装する方法は確認できなかった。HTMLやMarkdownによる装飾を送る実装は採用しない。

ユーザーが「リンク埋め込みが無理であればclose」と指示し、転記・URLコピー移動を確認済みのため、この結果でクローズした。AIによる追加の本番帳票変更は行っていない。

## 既存データの扱い

- 従来の下書き／登録拒否は「販売見積を保存」で新しい保存版を作る。接続先Functionsに変更を反映済みなら新形式のメモになる。内容変更がなくても任意で再保存できる。
- 旧メモの形式だけでは未保存扱いにせず、保存済みの見積は確認画面の旧メモで転記できる。保存応答が旧形式のままなら未反映の案内を表示し、同じ内容の再保存で版が増え続けないようにする。価格・備考・明細・取引先等を変更した場合は再保存が必要。
- 過去保存版や転記済み帳票のメモは自動更新しない。転記済み帳票は既存の改訂・提示有無選択・再保存・転記確認を経て反映する。
- 送信中／結果不明の照合は保存した`payload.memo`全体で行い、従来の識別文字列も引き続き使える。
- freee上書き前は更新元の旧payloadを照合する。旧形式から新形式への改訂でも既存帳票の手修正保護を維持する。
- 保存済み内容・最終転記確認・保存履歴に、その版で実際に送信するメモを表示する。

## 自動確認

typecheck・lint・フロントproduction build・Functions build成功。販売見積単体46件、ローカルFirestore結合33件成功。freeeとSecret Managerは全てモック。旧形式照合、同一内容改訂の旧メモ拒否、保存版保持、上書き／新規方式、送信中ロックを確認した。

初回sandboxでの一時ファイルrename・Emulator接続エラーは許可済み再実行で解消。既存のlint警告1件と依存注釈・bundleサイズ警告は継続。

2026-10-14追加修正：dev画面と未反映Functionsの組み合わせで旧形式メモが未保存判定を繰り返す不具合を修正。typecheck・lint・フロントproduction build、販売見積単体46件成功。架空データと通信モックで実画面を確認し、旧サーバーで1回保存後の登録確認有効／同一内容再保存無効、備考変更時の未保存送信拒否、保存後のモック新規転記、新サーバーで新メモ保存後の同一IDモック更新を確認。確認画像は`tmp/freee-memo-preview/legacy-confirmation.png`・`new-confirmation.png`。この追加修正ではFunctions／Rulesを変更していない。

ユーザーのfreee転記成功と旧メモの画像を確認後、旧形式で送信済みの帳票から新メモへの改訂を追加検証。旧payload／digestと旧帳票を照合し、同じIDへのGET＋PUTで新メモを送り、旧保存版を保持する結合テストが成功。Firestore結合は合計34件成功。実freee／Secret Manager通信はモック。

## ユーザー確認手順

`saveSalesQuotePricing`・`reconcileFreeeQuotation`とHostingを2026-10-14に本番反映済み。対象2関数ACTIVE・新revision100%配信・未認証Callable401・固定Secret bindingなし、公開ページHTTP200・配信JSと検証ビルドのSHA-256一致、公開Firestore RulesとローカルRules一致を確認。実freee登録や既存帳票の更新は利用者が確認画面から実行する。

通常の`npm run dev`は画面だけをローカルで動かし、`VITE_USE_FIREBASE_EMULATORS=true`を明示していなければ本番FirebaseとFunctionsに接続する。反映前に保存・転記した見積は旧メモを保持する。今回の反映後はdevからの再保存も新形式になる。実データの保存・freee転記は本番への操作になる。

1. 案件詳細を再読み込みする。旧形式で転記済みの見積は「改訂版を作成して編集」で実際の顧客提示状況を選択する。未提示なら同じfreee見積書IDへ上書きし、提示済みなら旧見積を残して新規改訂を作る。
2. 明細を再確定して販売見積を保存し、保存済み送信内容と転記確認画面で「案件リンク」「案件番号」の2行を確認する。旧形式の下書きは再保存だけでよい。
3. 利用者の転記操作後にfreee社内メモの内容を確認し、URLをブラウザへコピーして同じRFQ詳細へ戻れることを確認する。ログインが必要ならログイン後の対象案件を確認する。

ユーザー確認結果（2026-10-14）：転記成功、freee上のURLクリック不可、ブラウザへのURLコピーで対象案件へ移動できることを確認済み。最終調査はドキュメントだけの変更で、typecheck・lint・build・testsは再実行不要（既存の成功結果を維持）。

本番確認記録（秘密値なし）：`tmp/freee-memo-preview/before-functions.json`・`verified-functions.json`・`verified-hosting-rules.json`。対象関数の更新先は`saveSalesQuotePricing`の`savesalesquotepricing-00009-rep`と`reconcileFreeeQuotation`の`reconcilefreeequotation-00005-suv`。配信ビルドは`/assets/index-BkpeCPbX.js`。

管理シート更新不要。既存販売見積の改善としてCURRENT_STATUSへ記録。

公式資料：[freee請求書OpenAPI](https://github.com/freee/freee-api-schema/blob/master/iv/open-api-3/api-schema.yml)、[freee社内メモのヘルプ](https://support.freee.co.jp/hc/ja/articles/43630340840089)。
