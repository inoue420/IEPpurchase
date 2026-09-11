import { useRef, useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { createRfqItem, updateRfqItem, type RfqItem, type RfqItemInput, type RfqItemProduct } from './rfqItemRepository'
import { RFQ_ITEM_STATUSES, localDateInput, rfqItemSchema, rfqItemStatusLabels } from './rfqItemSchema'
import { rfqError } from './rfqError'
import { TranslationComparison } from './TranslationComparison'

const emptyInput: RfqItemInput = { originalDescription: '', translatedDescription: '', productId: '', manufacturerId: '', manufacturerName: '', partNumber: '', productName: '', quantity: 1, unit: '個', requestedDeliveryDate: '', status: 'pending', note: '' }
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const selectedProduct = products.find(product => product.id === input.productId) ?? null
  function chooseProduct(product: RfqItemProduct | null) {
    setInput(current => product ? { ...current, productId: product.id, manufacturerId: product.manufacturerId, manufacturerName: product.manufacturerName, partNumber: product.partNumber, productName: product.name, unit: product.unit || current.unit } : { ...current, productId: '', manufacturerId: '' })
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const result = rfqItemSchema.safeParse({ ...input, quantity: quantityText })
    if (!result.success) { setError(result.error.issues[0].message); return }
    submitting.current = true; setBusy(true); setError(null)
    try {
      if (item) await updateRfqItem(rfqId, item.id, result.data)
      else await createRfqItem(rfqId, result.data)
      onSaved(item ? '品目を更新しました。' : '品目を追加しました。')
    } catch (cause: unknown) { setError(rfqError(cause)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <Box component="form" onSubmit={event => void save(event)}>
      <DialogTitle>{item ? 'RFQ品目を編集' : 'RFQ品目を追加'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {input.productId && !selectedProduct && <Alert severity="info">紐付け済みの商品を取得できません。保存済みの商品情報を表示しています。</Alert>}
        <Autocomplete disabled={busy} options={products.filter(product => product.active || product.id === input.productId)} value={selectedProduct} isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={product => `${product.manufacturerName} ${product.partNumber} — ${product.name}`} onChange={(_, product) => chooseProduct(product)} renderInput={params => <TextField {...params} label="商品マスター（任意）" />} />
        {textFields.map(({ key, label, max, rows, required }) => <TextField key={key} label={label} required={required} multiline={Boolean(rows)} minRows={rows} value={input[key]} disabled={busy} slotProps={{ htmlInput: { maxLength: max } }} onChange={event => setInput(current => ({ ...current, [key]: event.target.value }))} />)}
        <TranslationComparison text={input.originalDescription} disabled={busy} onApply={translatedDescription => setInput(current => ({ ...current, translatedDescription }))} />
        <TextField label="数量" required type="number" slotProps={{ htmlInput: { min: 0, step: 'any' } }} value={quantityText} disabled={busy} onChange={event => setQuantityText(event.target.value)} />
        <TextField label="希望納期" type="date" slotProps={{ inputLabel: { shrink: true } }} value={input.requestedDeliveryDate} disabled={busy} onChange={event => setInput(current => ({ ...current, requestedDeliveryDate: event.target.value }))} />
        <TextField label="状態" select value={input.status} disabled={busy} onChange={event => setInput(current => ({ ...current, status: event.target.value as RfqItemInput['status'] }))}>
          {RFQ_ITEM_STATUSES.map(status => <MenuItem key={status} value={status}>{rfqItemStatusLabels[status]}</MenuItem>)}
        </TextField>
      </Stack></DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>キャンセル</Button><Button type="submit" variant="contained" disabled={busy}>{busy ? '保存中…' : '保存'}</Button></DialogActions>
    </Box>
  </Dialog>
}
