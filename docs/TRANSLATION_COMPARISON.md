# Google Translation

ユーザー指示により翻訳のみを追加。AI抽出・OCRは対象外。

RFQ品目の追加・編集で原文を入力し、Google Translationを実行する。原文言語は自動検出、翻訳先は英語。訳文と通信を含む応答時間を確認できる。原文を変更した場合は再翻訳が必要。結果の反映後に品目を保存する。Azure Translatorの比較はAzureサブスクリプション取得後に追加する。

## 接続準備

登録・課金有効化・実データ送信はユーザー確認後。キーをチャットやGitに貼らない。

- Google: Cloud Translation Basic v2を有効にしたプロジェクトでAPIキーを発行し、API制限をCloud Translation APIに限定する。Secret名はGOOGLE_TRANSLATE_API_KEY。
- GoogleはGOOGLE_TRANSLATE_API_KEYを設定後にtranslateGoogleTextをデプロイする。画面公開も別途必要。
- 入力は1〜5000文字、出力保存上限も5000文字。APIの予算通知だけでは費用停止を保証しないため、サービス側のクォータも設定する。現在アプリ独自の月額上限はない。

## 確認手順

1. RFQ品目編集で架空の英語説明を入力し、Googleを実行する。
2. 訳文と検出言語・応答時間を確認する。
3. 原文を変更し、以前の訳文を反映できないことを確認する。
4. 再翻訳して訳文を反映し、必要なら修正して保存する。再度開いて訳文を確認する。

公式仕様:
- https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate

Googleの本番API接続は設定済み。Azure比較は保留。
