import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { subscribeRfqItems, type RfqItem } from '../rfqs/rfqItemRepository'
import { localDateInput } from '../rfqs/rfqItemSchema'
import type { SupplierQuote } from './supplierQuoteRepository'
import { saveSupplierQuoteItem, subscribeSupplierQuoteItems, type SupplierQuoteItem } from './supplierQuoteItemRepository'
import { supplierQuoteItemSchema, type SupplierQuoteItemInput } from './supplierQuoteItemSchema'
import { calculateLine, type TaxCategory } from './quoteMoney'

const yen = (value: number) => `${value.toLocaleString('ja-JP')}円`
const categories: Record<TaxCategory, string> = { exclusive: '税抜', inclusive: '税込', exempt: '非課税' }
const empty: SupplierQuoteItemInput = { rfqItemId: '', productId: null, partNumber: '', itemName: '', unit: '', quantity: 1, unitPrice: 0, shippingFee: NaN, taxCategory: 'exclusive', taxRateBps: 1000, shippingTaxCategory: 'exclusive', shippingTaxRateBps: 1000, deliveryDate: '', note: '' }

function ItemEditor({ quote, item, rfqItems, close, saved }: { quote: SupplierQuote; item: SupplierQuoteItem | null; rfqItems: RfqItem[]; close: () => void; saved: () => void }) {
  const [input, setInput] = useState<SupplierQuoteItemInput>(item ? { ...item, deliveryDate: item.deliveryDate ? localDateInput(item.deliveryDate.toDate()) : '' } : empty)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const submitting = useRef(false)
  const expectedRevision = useRef(quote.revision)
  const initialQuote = useRef(quote).current
  const update = <K extends keyof SupplierQuoteItemInput>(key: K, value: SupplierQuoteItemInput[K]) => setInput(old => ({ ...old, [key]: value }))
  const parsed = supplierQuoteItemSchema.safeParse(input)
  const amounts = parsed.success ? calculateLine(parsed.data) : null
  const converting = initialQuote.itemCount === undefined
  const nextTotal = amounts ? (converting ? 0 : initialQuote.total) - (item?.total ?? 0) + amounts.total : null
  async function save(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    if (converting && !confirmed) { setError('明細計算額への切替を確認してください。'); return }
    submitting.current = true; setBusy(true); setError('')
    try { await saveSupplierQuoteItem(quote.rfqId, quote.id, item?.id ?? null, expectedRevision.current, parsed.data); saved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。') }
    finally { submitting.current = false; setBusy(false) }
  }
  const taxFields = (shipping: boolean) => {
    const categoryKey = shipping ? 'shippingTaxCategory' : 'taxCategory'
    const rateKey = shipping ? 'shippingTaxRateBps' : 'taxRateBps'
    return <Stack direction="row" spacing={2}>
      <TextField fullWidth select label={shipping ? '送料の税区分' : '商品の税区分'} value={input[categoryKey]} disabled={busy} onChange={event => { const category = event.target.value as TaxCategory; setInput(old => ({ ...old, [categoryKey]: category, [rateKey]: category === 'exempt' ? 0 : old[rateKey] })) }}>{Object.entries(categories).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
      <TextField fullWidth required type="number" label="税率（%）" value={input[rateKey] / 100} disabled={busy || input[categoryKey] === 'exempt'} slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01 } }} onChange={event => update(rateKey, Math.round(Number(event.target.value) * 100))} />
    </Stack>
  }
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : close}><form onSubmit={event => void save(event)}><DialogTitle>{item ? '見積明細を編集' : '見積明細を追加'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
    {error && <Alert severity="error">{error}</Alert>}
    <TextField select required label="案件品目" value={input.rfqItemId} disabled={busy || Boolean(item)} onChange={event => { const selected = rfqItems.find(value => value.id === event.target.value); if (selected) setInput(old => ({ ...old, rfqItemId: selected.id, productId: selected.productId || null, partNumber: selected.partNumber, itemName: selected.productName || selected.translatedDescription || selected.originalDescription, unit: selected.unit, quantity: selected.quantity })) }}>
      {rfqItems.filter(value => value.id === input.rfqItemId || (value.archivedAt === null && value.status !== 'cancelled')).map(value => <MenuItem key={value.id} value={value.id}>{value.lineNo}: {value.productName || value.originalDescription}</MenuItem>)}
    </TextField>
    <TextField required label="品名" value={input.itemName} disabled={busy} onChange={event => update('itemName', event.target.value)} />
    <Stack direction="row" spacing={2}><TextField fullWidth label="品番" value={input.partNumber} disabled={busy} onChange={event => update('partNumber', event.target.value)} /><TextField required label="単位" value={input.unit} disabled={busy} onChange={event => update('unit', event.target.value)} /></Stack>
    <Stack direction="row" spacing={2}><TextField fullWidth required type="number" label="数量" helperText="小数3桁まで" value={input.quantity} disabled={busy} slotProps={{ htmlInput: { min: 0.001, max: 1000000, step: 0.001 } }} onChange={event => update('quantity', Number(event.target.value))} /><TextField fullWidth required type="number" label="単価（円）" value={input.unitPrice} disabled={busy} slotProps={{ htmlInput: { min: 0, step: 1 } }} onChange={event => update('unitPrice', Number(event.target.value))} /></Stack>
    {taxFields(false)}
    <TextField required type="number" label="この明細の送料（円）" helperText="見積全体の送料は各明細へ配分してください。送料無料は0円、未確認の場合は確認後に保存してください。" value={Number.isNaN(input.shippingFee) ? '' : input.shippingFee} disabled={busy} slotProps={{ htmlInput: { min: 0, step: 1 } }} onChange={event => update('shippingFee', event.target.value === '' ? NaN : Number(event.target.value))} />
    {taxFields(true)}
    <TextField type="date" label="納期（未確認は空欄）" value={input.deliveryDate} disabled={busy} slotProps={{ inputLabel: { shrink: true } }} onChange={event => update('deliveryDate', event.target.value)} />
    <TextField multiline label="備考" value={input.note} disabled={busy} onChange={event => update('note', event.target.value)} />
    {amounts && <Alert severity="info">明細小計 {yen(amounts.subtotal)} ／ 税 {yen(amounts.tax)} ／ 明細総額 {yen(amounts.total)}<br />保存後の見積総額 {yen(nextTotal!)}（現在との差額 {yen(nextTotal! - initialQuote.total)}）</Alert>}
    {converting && <FormControlLabel control={<Checkbox checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />} label="手入力のヘッダー金額を明細の計算額に切り替えます。旧金額は履歴に保存されます。" />}
    <Typography variant="body2" color="text.secondary">商品代・送料ごとに円未満を切り捨てます。見積書の合計と差がある場合は、金額・税区分・送料を確認してください。</Typography>
  </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={close}>キャンセル</Button><Button type="submit" variant="contained" disabled={busy || (converting && !confirmed)}>{busy ? '保存中…' : '保存'}</Button></DialogActions></form></Dialog>
}

export function SupplierQuoteItemsDialog({ quote, close }: { quote: SupplierQuote; close: () => void }) {
  const [items, setItems] = useState<SupplierQuoteItem[]>([])
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([])
  const [itemsReady, setItemsReady] = useState(false)
  const [rfqReady, setRfqReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState<SupplierQuoteItem | null | undefined>()
  const [notice, setNotice] = useState('')
  useEffect(() => subscribeSupplierQuoteItems(quote.id, next => { setItems(next); setItemsReady(true) }, () => setError('明細を取得できませんでした。')), [quote.id, attempt])
  useEffect(() => subscribeRfqItems(quote.rfqId, next => { setRfqItems(next); setRfqReady(true) }, () => setError('案件品目を取得できませんでした。')), [quote.rfqId, attempt])
  const disabled = !itemsReady || !rfqReady || Boolean(error) || quote.status === 'withdrawn'
  return <Dialog open fullWidth maxWidth="lg" onClose={editing === undefined ? close : undefined}><DialogTitle>見積明細 — {quote.quoteNumber}</DialogTitle><DialogContent>
    {error && <Alert severity="error" action={<Button onClick={() => { setError(''); setItemsReady(false); setRfqReady(false); setAttempt(value => value + 1) }}>再試行</Button>}>{error}</Alert>}
    {notice && <Alert severity="success">{notice}</Alert>}
    <Typography sx={{ mb: 2 }}>小計 {yen(quote.subtotal)} ／ 税 {yen(quote.tax)} ／ 総額 {yen(quote.total)} ／ うち送料（税込）{quote.shippingTotal === undefined ? '未集計' : yen(quote.shippingTotal)}</Typography>
    <Button disabled={disabled} onClick={() => setEditing(null)}>明細を追加</Button>
    <Table><TableHead><TableRow>{['品名・品番', '数量', '単価・税区分', '送料・税区分', '総額', '納期', '操作'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
      {items.length === 0 && <TableRow><TableCell colSpan={7}>{itemsReady ? '明細はありません。' : '読み込み中…'}</TableCell></TableRow>}
      {items.map(item => <TableRow key={item.id}><TableCell>{item.itemName}<br />{item.partNumber}</TableCell><TableCell>{item.quantity} {item.unit}</TableCell><TableCell>{yen(item.unitPrice)}<br />{categories[item.taxCategory]} {item.taxRateBps / 100}%</TableCell><TableCell>{yen(item.shippingFee)}<br />{categories[item.shippingTaxCategory]} {item.shippingTaxRateBps / 100}%</TableCell><TableCell>{yen(item.total)}</TableCell><TableCell>{item.deliveryDate?.toDate().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) ?? '未確認'}</TableCell><TableCell><Button disabled={disabled} onClick={() => setEditing(item)}>編集</Button></TableCell></TableRow>)}
    </TableBody></Table>
    {editing !== undefined && <ItemEditor quote={quote} item={editing} rfqItems={rfqItems} close={() => setEditing(undefined)} saved={() => { setEditing(undefined); setNotice('明細と見積合計を保存しました。') }} />}
  </DialogContent><DialogActions><Button disabled={editing !== undefined} onClick={close}>閉じる</Button></DialogActions></Dialog>
}
