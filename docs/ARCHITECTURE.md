# ARCHITECTURE.md

## 1. 基本方針
IEPpurchaseは、顧客からのRFQ（見積依頼）を起点に、
品目、仕入候補、販売見積、発注、納品、分析までを紐付けて管理する。

Firebase / Firestoreを自社側の中心データストアとし、
freeeやAmazon、楽天等は外部連携先として扱う。

---

## 2. 中心エンティティ

### RFQ
顧客から受領した見積依頼案件。

主な項目例:
- id
- rfqNumber
- customerId
- customerName
- subject
- receivedAt
- dueDate
- status
- notes
- createdAt
- updatedAt

### RFQ Item
RFQ内の個々の品目。

主な項目例:
- id
- rfqId
- lineNumber
- productId
- manufacturer
- partNumber
- originalDescription
- translatedDescription
- quantity
- unit
- specification
- notes
- createdAt
- updatedAt

---

## 3. Phase 1想定コレクション

### customers
顧客マスター

### suppliers
仕入先マスター

### products
商品マスター

### rfqs
見積依頼案件

### rfqItems
見積依頼品目

Phase 1では上記を中心にCRUD・一覧・詳細・検索の基盤を作る。

---

## 4. 将来追加予定コレクション

### supplierQuoteRequests
仕入先へ送信した見積依頼履歴。

### supplierQuotes
仕入先から取得した見積。

### marketplaceOffers
Amazon / 楽天等の価格候補。

### sourcingDecisions
採用した購入先・価格・判断理由。

### salesQuotes
顧客向け販売見積。

### salesQuoteItems
販売見積明細。

### purchaseOrders
発注情報。

### purchaseOrderItems
発注明細。

### deliveries
納品情報。

### deliveryItems
納品明細。

### documents
見積書、納品書、添付資料等。

### activityLogs
重要操作・状態遷移等の履歴。

---

## 5. ID設計
Firestore document IDを内部IDとして使用する。

必要に応じて業務上の表示番号を別途持つ。

例:
- rfqNumber
- quotationNumber
- purchaseOrderNumber

外部サービスのIDは内部IDと分離する。

例:
- freeeQuotationId
- freeeDeliveryNoteId
- amazonAsin
- rakutenItemCode

---

## 6. 関係

```text
Customer
   |
   +-- RFQ
        |
        +-- RFQ Item
              |
              +-- Supplier Quote
              +-- Marketplace Offer
              +-- Sourcing Decision
              +-- Sales Quote Item
              +-- Purchase Order Item
              +-- Delivery Item
```

`rfqId` / `rfqItemId` を重要な追跡キーとして維持する。

---

## 7. 翻訳
将来的に日英・英日翻訳を実装する。

RFQ Itemでは最低限以下を分離する。

- originalDescription
- translatedDescription

必要になれば将来以下を追加可能とする。

- originalLanguage
- translatedLanguage
- translationSource
- translatedAt

---

## 8. 価格履歴
販売・仕入価格は将来分析対象となるため、
単純に商品マスターの現在価格だけを更新する設計にはしない。

見積・販売・発注・納品単位でSnapshotを保存できる設計とする。

---

## 9. 外部連携
外部APIはPhaseごとに追加する。

想定:
- freee API
- 楽天API
- Amazon API
- Gmail / メール
- AI / OCR
- 翻訳API

各連携は `src/integrations/` などに隔離し、
UI / domain logic から直接SDKを乱用しない。

---

## 10. 規模に対する設計
本システムは大規模SaaSではなく社内少人数利用を前提とする。

したがって:
- マイクロサービス化しない
- 不要なイベント駆動を導入しない
- 不要な抽象化を避ける
- Firebase無料〜低コスト枠を意識する
- 保守性と分かりやすさを優先する

---

## 11. 推奨ディレクトリ案

```text
src/
├─ app/
├─ components/
├─ features/
│  ├─ customers/
│  ├─ suppliers/
│  ├─ products/
│  └─ rfqs/
├─ repositories/
├─ services/
├─ integrations/
├─ types/
├─ utils/
└─ firebase/
```

既存構成がある場合は、無理にこの形へ変更しない。
