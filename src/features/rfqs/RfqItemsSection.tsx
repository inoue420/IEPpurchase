import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { RfqItemDialog } from './RfqItemDialog'
import { BulkTranslationDialog } from './BulkTranslationDialog'
import { appendRfqItemEcPurchaseCandidates, setRfqItemArchived, setRfqItemSourcingTargets, subscribeRfqItemProducts, subscribeRfqItems, type RfqItem, type RfqItemProduct } from './rfqItemRepository'
import { rfqItemStatusLabels } from './rfqItemSchema'
import { rfqError } from './rfqError'
import { includesSearchText, normalizeSearchText } from '../../utils/searchText'
import { searchRakutenItems } from '../marketplaceOffers/rakutenSearch'
import { selectPartNumberMatchedRakutenItems } from './rakutenCandidateSelection'
import { SupplierQuotePdfImportDialog } from './SupplierQuotePdfImportDialog'
import { BulkRfqItemDialog } from './BulkRfqItemDialog'

export function RfqItemsSection({ rfqId }: { rfqId: string }) {
  const [items, setItems] = useState<RfqItem[]>([])
  const [products, setProducts] = useState<RfqItemProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [productError, setProductError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<RfqItem | null | undefined>(undefined)
  const [confirming, setConfirming] = useState<RfqItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [updatingTargetId, setUpdatingTargetId] = useState<string | null>(null)
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const [pdfImportOpen, setPdfImportOpen] = useState(false)
  const [bulkItemOpen, setBulkItemOpen] = useState(false)
  const submitting = useRef(false)
  const bulkSearching = useRef(false)
  useEffect(() => subscribeRfqItems(rfqId, next => { setItems(next); setLoading(false); setLoadError(null) }, cause => { setLoadError(rfqError(cause)); setLoading(false) }), [rfqId, retry])
  useEffect(() => subscribeRfqItemProducts(next => { setProducts(next); setProductError(null) }, cause => setProductError(rfqError(cause))), [retry])
  const keyword = normalizeSearchText(search)
  const visible = items.filter(item => (showArchived || !item.archivedAt) && (!keyword || [item.originalDescription, item.translatedDescription, item.manufacturerName, item.partNumber, item.productName, item.note].some(value => includesSearchText(value, keyword))))
  async function archive() {
    if (!confirming || submitting.current) return
    submitting.current = true; setBusy(true); setActionError(null)
    try {
      await setRfqItemArchived(rfqId, confirming.id, !confirming.archivedAt)
      setNotice(confirming.archivedAt ? '品目を復元しました。' : '品目を削除しました。削除済み表示から復元できます。')
      setConfirming(null)
    } catch (cause: unknown) { setActionError(rfqError(cause)) }
    finally { submitting.current = false; setBusy(false) }
  }
  async function updateSourcingTargets(item: RfqItem, supplierQuoteRequestEnabled: boolean, marketplaceOfferEnabled: boolean) {
    if ((!supplierQuoteRequestEnabled && !marketplaceOfferEnabled) || updatingTargetId) return
    setUpdatingTargetId(item.id); setActionError(null)
    try {
      await setRfqItemSourcingTargets(rfqId, item.id, supplierQuoteRequestEnabled, marketplaceOfferEnabled)
      setNotice('明細No. ' + item.lineNo + ' の対応先を更新しました。')
    } catch (cause: unknown) { setActionError(rfqError(cause)) }
    finally { setUpdatingTargetId(null) }
  }
  async function bulkRakutenSearch() {
    const targets = visible.filter(item => !item.archivedAt && item.status !== 'cancelled' && item.marketplaceOfferEnabled)
    if (bulkSearching.current || targets.length === 0) return
    bulkSearching.current = true; setBusy(true); setActionError(null); setNotice(null)
    let addedItems = 0; let addedCandidates = 0; let skipped = 0; let failed = 0
    try {
      for (const [index, item] of targets.entries()) {
        setBulkProgress(`${index + 1}/${targets.length}: 明細No. ${item.lineNo} を楽天検索中…`)
        if (!item.manufacturerName.trim() || !item.partNumber.trim() || item.ecPurchaseCandidates.length >= 10) { skipped += 1; continue }
        try {
          const result = await searchRakutenItems(`${item.manufacturerName.trim()} ${item.partNumber.trim()}`)
          const matched = selectPartNumberMatchedRakutenItems(result.items, item.partNumber, 10 - item.ecPurchaseCandidates.length)
          if (matched.length === 0) { skipped += 1; continue }
          const added = await appendRfqItemEcPurchaseCandidates(rfqId, item.id, matched.map(value => ({ storeProductName: value.itemName, url: value.itemUrl, price: value.itemPrice, purchasePlanned: false })))
          if (added > 0) { addedItems += 1; addedCandidates += added } else skipped += 1
        } catch { failed += 1 }
      }
      setNotice(`楽天一括検索完了: ${targets.length}品目中、${addedItems}品目へ${addedCandidates}件を追加${skipped ? `、${skipped}品目は一致候補なし・入力不足・空き枠なし` : ''}${failed ? `、${failed}品目は検索または保存に失敗` : ''}。`)
    } finally {
      bulkSearching.current = false; setBusy(false); setBulkProgress(null)
    }
  }
  const retryLoad = () => { setLoading(true); setRetry(value => value + 1) }
  return <Box sx={{ mt: 3 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}><Typography component="h2" variant="h5">品目</Typography><Stack direction="row" spacing={1}><Button variant="outlined" disabled={loading || Boolean(loadError) || busy} onClick={() => setBulkItemOpen(true)}>表からまとめて追加</Button><Button variant="contained" disabled={loading || Boolean(loadError)} onClick={() => setEditing(null)}>品目を追加</Button></Stack></Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}><TextField label="品目を検索" fullWidth value={search} onChange={event => setSearch(event.target.value)} /><Button onClick={() => setShowArchived(value => !value)} variant={showArchived ? 'contained' : 'outlined'}>{showArchived ? '削除済みを表示中' : '削除済みを表示'}</Button></Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}><Button variant="outlined" disabled={loading || Boolean(loadError) || busy || !visible.some(item => !item.archivedAt && item.status !== 'cancelled' && item.marketplaceOfferEnabled)} onClick={() => void bulkRakutenSearch()}>{bulkProgress ?? '表示中のEC対象を楽天で検索'}</Button><Button variant="outlined" disabled={loading || Boolean(loadError) || busy || !items.some(item => !item.archivedAt && item.status !== 'cancelled' && item.partNumber.trim())} onClick={() => setPdfImportOpen(true)}>仕入先見積PDFを取り込む</Button><Typography variant="body2" color="text.secondary">EC対象は楽天を検索し、PDF取込はRFQ内の品番と一致した仕切単価を確認後に反映します。</Typography></Stack>
    {productError && <Alert severity="warning" action={<Button onClick={retryLoad}>再試行</Button>}>商品マスターを読み込めません。品目は手入力できます。</Alert>}
    {actionError && !confirming && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
    {loadError ? <Alert severity="error" action={<Button onClick={retryLoad}>再試行</Button>}>{loadError}</Alert> : loading ? <CircularProgress /> : <TableContainer component={Paper}><Table sx={{ minWidth: 800 }}>
      <TableHead><TableRow>{['No.', '品目説明 / 翻訳', 'メーカー / 品番 / 商品名', '数量', '対応先', '希望納期', '状態', '操作'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
      <TableBody>{visible.length === 0 ? <TableRow><TableCell colSpan={8} align="center">該当する品目はありません。</TableCell></TableRow> : visible.map(item => <TableRow key={item.id}>
        <TableCell>{item.lineNo}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.originalDescription}{item.translatedDescription && <Typography color="text.secondary">{item.translatedDescription}</Typography>}</TableCell>
        <TableCell>{[item.manufacturerName, item.partNumber, item.productName].filter(Boolean).join(' / ') || '—'}</TableCell><TableCell>{item.quantity} {item.unit}</TableCell><TableCell><Stack spacing={0}><FormControlLabel sx={{ m: 0 }} control={<Checkbox size="small" checked={item.supplierQuoteRequestEnabled} disabled={busy || Boolean(item.archivedAt) || updatingTargetId === item.id || !item.marketplaceOfferEnabled} onChange={event => void updateSourcingTargets(item, event.target.checked, item.marketplaceOfferEnabled)} />} label="仕入先見積" /><FormControlLabel sx={{ m: 0 }} control={<Checkbox size="small" checked={item.marketplaceOfferEnabled} disabled={busy || Boolean(item.archivedAt) || updatingTargetId === item.id || !item.supplierQuoteRequestEnabled} onChange={event => void updateSourcingTargets(item, item.supplierQuoteRequestEnabled, event.target.checked)} />} label="EC検索" /></Stack></TableCell><TableCell>{item.requestedDeliveryDate?.toDate().toLocaleDateString('ja-JP') ?? '—'}</TableCell>
        <TableCell><Chip size="small" label={item.archivedAt ? '削除済み' : rfqItemStatusLabels[item.status] ?? item.status} /></TableCell>
        <TableCell><Button disabled={busy || Boolean(item.archivedAt)} onClick={() => setEditing(item)}>編集</Button><Button disabled={busy} color={item.archivedAt ? 'success' : 'warning'} onClick={() => { setActionError(null); setConfirming(item) }}>{item.archivedAt ? '復元' : '削除'}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></TableContainer>}
    {editing !== undefined && <RfqItemDialog key={editing?.id ?? 'new'} rfqId={rfqId} item={editing} products={products} onClose={() => setEditing(undefined)} onSaved={message => { setEditing(undefined); setNotice(message) }} />}
    {pdfImportOpen && <SupplierQuotePdfImportDialog rfqId={rfqId} items={items} onClose={() => setPdfImportOpen(false)} onImported={count => { setPdfImportOpen(false); setNotice(`仕入先見積PDFから${count}品目の回答単価を反映しました。`) }} />}
    {bulkItemOpen && <BulkRfqItemDialog rfqId={rfqId} onClose={() => setBulkItemOpen(false)} onSaved={count => { setBulkItemOpen(false); setNotice(`${count}品目をまとめて登録しました。`) }} />}
    <Dialog open={Boolean(confirming)} onClose={busy ? undefined : () => setConfirming(null)}><DialogTitle>品目を{confirming?.archivedAt ? '復元' : '削除'}</DialogTitle><DialogContent>{actionError && <Alert severity="error">{actionError}</Alert>}<DialogContentText>明細No. {confirming?.lineNo} を{confirming?.archivedAt ? '復元します。' : '削除します。登録情報は保持され、後から復元できます。'}</DialogContentText></DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirming(null)}>キャンセル</Button><Button disabled={busy} onClick={() => void archive()}>{busy ? '処理中…' : confirming?.archivedAt ? '復元' : '削除'}</Button></DialogActions></Dialog>
    <Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4000} onClose={() => setNotice(null)} />
  </Box>
}

export function BulkTranslationSection({ rfqId }: { rfqId: string }) {
  const [items, setItems] = useState<RfqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => subscribeRfqItems(rfqId, next => { setItems(next); setLoading(false); setLoadError(false) }, () => { setLoading(false); setLoadError(true) }), [rfqId])
  return <Box sx={{ mt: 3 }}>
    <Button variant="outlined" disabled={loading || loadError || items.length === 0} onClick={() => setOpen(true)}>選択して一括翻訳</Button>
    {loadError && <Alert severity="warning" sx={{ mt: 1 }}>品目を読み込めないため、一括翻訳を開始できません。</Alert>}
    {open && <BulkTranslationDialog rfqId={rfqId} items={items} onClose={() => setOpen(false)} />}
  </Box>
}
