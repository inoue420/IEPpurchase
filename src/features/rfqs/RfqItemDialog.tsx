import { useRef, useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, Link, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { createRfqItem, updateRfqItem, type EcPurchaseCandidate, type RfqItem, type RfqItemInput, type RfqItemProduct } from './rfqItemRepository'
import { RFQ_ITEM_STATUSES, localDateInput, rfqItemSchema, rfqItemStatusLabels } from './rfqItemSchema'
import { rfqError } from './rfqError'
import { TranslationComparison } from './TranslationComparison'
import { RakutenSearchDialog, type RakutenSearchItem } from '../marketplaceOffers/RakutenSearchDialog'
import { selectPartNumberMatchedRakutenItems } from './rakutenCandidateSelection'

const emptyInput: RfqItemInput = { originalDescription: '', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 1, unit: '個', supplierQuoteRequestEnabled: true, marketplaceOfferEnabled: true, ecPurchaseCandidates: [], requestedDeliveryDate: '', status: 'pending', note: '' }
type EcPurchaseCandidateDraft = Omit<EcPurchaseCandidate, 'price'> & { price: string }
const textFields = [
  { key: 'originalDescription', label: '品目説明（原文）', max: 5000, rows: 3, required: true },
  { key: 'translatedDescription', label: '翻訳説明（手入力・任意）', max: 5000, rows: 2 },
  { key: 'manufacturerName', label: 'メーカー名', max: 200 },
  { key: 'partNumber', label: '品番', max: 200 },
  { key: 'productName', label: '商品名', max: 500 },
  { key: 'unit', label: '単位', max: 50, required: true },
  { key: 'note', label: '備考', max: 5000, rows: 2 },
] satisfies { key: keyof RfqItemInput; label: string; max: number; rows?: number; required?: boolean }[]

export function RfqItemDialog({ rfqId, item, products, onClose, onSaved }: { rfqId: string; item: RfqItem | null; products: RfqItemProduct[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [input, setInput] = useState<RfqItemInput>(item ? { ...item, requestedDeliveryDate: item.requestedDeliveryDate ? localDateInput(item.requestedDeliveryDate.toDate()) : '' } : emptyInput)
  const [quantityText, setQuantityText] = useState(String(item?.quantity ?? 1))
  const [ecPurchaseCandidates, setEcPurchaseCandidates] = useState<EcPurchaseCandidateDraft[]>(() => Array.from({ length: 5 }, (_, index) => { const candidate = item?.ecPurchaseCandidates[index]; return candidate ? { ...candidate, price: String(candidate.price) } : { storeProductName: '', url: '', price: '', purchasePlanned: false } }))
  const [rakutenSearchOpen, setRakutenSearchOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const submitting = useRef(false)
  const selectedProduct = products.find(product => product.id === input.productId) ?? null
  function chooseProduct(product: RfqItemProduct | null) {
    setInput(current => product ? { ...current, productId: product.id, manufacturerId: product.manufacturerId, manufacturerName: product.manufacturerName, partNumber: product.partNumber, productName: product.name, unit: product.unit || current.unit } : { ...current, productId: '', manufacturerId: '' })
  }
  function addRakutenCandidates(results: RakutenSearchItem[]) {
    const emptyCount = ecPurchaseCandidates.filter(candidate => !candidate.storeProductName && !candidate.url && !candidate.price).length
    const matched = selectPartNumberMatchedRakutenItems(results, input.partNumber, emptyCount)
    setRakutenSearchOpen(false)
    if (matched.length === 0) {
      setNotice(null)
      setError('検索上位10件を確認しましたが、品番がストア掲載商品名に一致する候補はありませんでした。')
      return
    }
    setEcPurchaseCandidates(current => {
      let resultIndex = 0
      return current.map(candidate => {
        if (candidate.storeProductName || candidate.url || candidate.price || resultIndex >= matched.length) return candidate
        const result = matched[resultIndex++]
        return { storeProductName: result.itemName, url: result.itemUrl, price: String(result.itemPrice), purchasePlanned: false }
      })
    })
    setError(null)
    setNotice(`楽天検索の上位10件を確認し、品番一致の${matched.length}件をEC購入候補へ追加しました。`)
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const result = rfqItemSchema.safeParse({ ...input, quantity: quantityText, status: ecPurchaseCandidates.some(candidate => candidate.purchasePlanned) ? 'quoted' : input.status, ecPurchaseCandidates: ecPurchaseCandidates.filter(candidate => candidate.storeProductName || candidate.url || candidate.price) })
    if (!result.success) { setError(result.error.issues[0].message); return }
    submitting.current = true; setBusy(true); setError(null)
    try {
      if (item) await updateRfqItem(rfqId, item.id, result.data)
      else await createRfqItem(rfqId, result.data)
      onSaved(item ? '品目を更新しました。' : '品目を追加しました。')
    } catch (cause: unknown) { setError(rfqError(cause)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <>
  <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <Box component="form" onSubmit={event => void save(event)}>
      <DialogTitle>{item ? 'RFQ品目を編集' : 'RFQ品目を追加'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        {input.productId && !selectedProduct && <Alert severity="info">紐付け済みの商品を取得できません。保存済みの商品情報を表示しています。</Alert>}
        <Autocomplete disabled={busy} options={products.filter(product => product.active || product.id === input.productId)} value={selectedProduct} isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={product => `${product.manufacturerName} ${product.partNumber} — ${product.name}`} onChange={(_, product) => chooseProduct(product)} renderInput={params => <TextField {...params} label="商品マスター（任意）" />} />
        {textFields.map(({ key, label, max, rows, required }) => <TextField key={key} label={label} required={required} multiline={Boolean(rows)} minRows={rows} value={input[key]} disabled={busy} slotProps={{ htmlInput: { maxLength: max } }} onChange={event => setInput(current => ({ ...current, [key]: event.target.value }))} />)}
        <TranslationComparison text={input.originalDescription} disabled={busy} onApply={translatedDescription => setInput(current => ({ ...current, translatedDescription }))} />
        <TextField label="数量" required type="number" slotProps={{ htmlInput: { min: 0, step: 'any' } }} value={quantityText} disabled={busy} onChange={event => setQuantityText(event.target.value)} />
        <Box><Button disabled={busy || !input.manufacturerName.trim() || !input.partNumber.trim() || !ecPurchaseCandidates.some(candidate => !candidate.storeProductName && !candidate.url && !candidate.price)} onClick={() => setRakutenSearchOpen(true)}>楽天で検索</Button><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>メーカー名と品番で楽天を検索し、上位10件を確認して品番がストア掲載商品名に一致するものだけを空き枠へ追加します。</Typography></Box>
        <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>EC購入候補（最大5件）</Typography><Stack spacing={1}>{ecPurchaseCandidates.map((candidate, index) => <Box key={index} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}><Stack direction="row" spacing={1} alignItems="center"><Typography variant="caption" color="text.secondary">候補 {index + 1}</Typography><FormControlLabel sx={{ m: 0 }} control={<Checkbox size="small" checked={candidate.purchasePlanned} disabled={busy || !candidate.storeProductName || !candidate.url || candidate.price === ''} onChange={event => { setEcPurchaseCandidates(current => current.map((value, candidateIndex) => candidateIndex === index ? { ...value, purchasePlanned: event.target.checked } : value)); if (event.target.checked) setInput(current => ({ ...current, status: 'quoted' })) }} />} label="購入予定候補" /></Stack><Stack spacing={1} sx={{ mt: 1 }}><TextField label="ストア掲載商品名" value={candidate.storeProductName} disabled={busy} slotProps={{ htmlInput: { maxLength: 500 } }} onChange={event => setEcPurchaseCandidates(current => current.map((value, candidateIndex) => candidateIndex === index ? { ...value, storeProductName: event.target.value } : value))} /><TextField label="URL" type="url" value={candidate.url} disabled={busy} slotProps={{ htmlInput: { maxLength: 2000 } }} onChange={event => setEcPurchaseCandidates(current => current.map((value, candidateIndex) => candidateIndex === index ? { ...value, url: event.target.value } : value))} />{/^https?:\/\/.+/i.test(candidate.url) && <Link href={candidate.url} target="_blank" rel="noopener noreferrer">商品ページを開く</Link>}<TextField label="価格（円）" type="number" value={candidate.price} disabled={busy} slotProps={{ htmlInput: { min: 0, step: 1 } }} onChange={event => setEcPurchaseCandidates(current => current.map((value, candidateIndex) => candidateIndex === index ? { ...value, price: event.target.value } : value))} /></Stack></Box>)}</Stack></Box>
        <Box><Typography variant="subtitle2">対応先（1つ以上選択）</Typography><FormGroup row><FormControlLabel control={<Checkbox checked={input.supplierQuoteRequestEnabled} disabled={busy} onChange={event => setInput(current => ({ ...current, supplierQuoteRequestEnabled: event.target.checked }))} />} label="仕入先見積依頼" /><FormControlLabel control={<Checkbox checked={input.marketplaceOfferEnabled} disabled={busy} onChange={event => setInput(current => ({ ...current, marketplaceOfferEnabled: event.target.checked }))} />} label="EC購入候補" /></FormGroup></Box>
        <TextField label="希望納期" type="date" slotProps={{ inputLabel: { shrink: true } }} value={input.requestedDeliveryDate} disabled={busy} onChange={event => setInput(current => ({ ...current, requestedDeliveryDate: event.target.value }))} />
        <TextField label="状態" select value={input.status} disabled={busy} onChange={event => setInput(current => ({ ...current, status: event.target.value as RfqItemInput['status'] }))}>
          {RFQ_ITEM_STATUSES.map(status => <MenuItem key={status} value={status}>{rfqItemStatusLabels[status]}</MenuItem>)}
        </TextField>
      </Stack></DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>キャンセル</Button><Button type="submit" variant="contained" disabled={busy}>{busy ? '保存中…' : '保存'}</Button></DialogActions>
    </Box>
  </Dialog>
  {rakutenSearchOpen && <RakutenSearchDialog initialKeyword={`${input.manufacturerName.trim()} ${input.partNumber.trim()}`} close={() => setRakutenSearchOpen(false)} selectTopResults={results => addRakutenCandidates(results)} />}
  </>
}
