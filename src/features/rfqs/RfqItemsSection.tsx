import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { RfqItemDialog } from './RfqItemDialog'
import { setRfqItemArchived, subscribeRfqItemProducts, subscribeRfqItems, type RfqItem, type RfqItemProduct } from './rfqItemRepository'
import { rfqItemStatusLabels } from './rfqItemSchema'
import { rfqError } from './rfqError'
import { includesSearchText, normalizeSearchText } from '../../utils/searchText'

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
  const submitting = useRef(false)
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
  const retryLoad = () => { setLoading(true); setRetry(value => value + 1) }
  return <Box sx={{ mt: 3 }}>
    <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}><Typography component="h2" variant="h5">品目</Typography><Button variant="contained" disabled={loading || Boolean(loadError)} onClick={() => setEditing(null)}>品目を追加</Button></Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}><TextField label="品目を検索" fullWidth value={search} onChange={event => setSearch(event.target.value)} /><Button onClick={() => setShowArchived(value => !value)} variant={showArchived ? 'contained' : 'outlined'}>{showArchived ? '削除済みを表示中' : '削除済みを表示'}</Button></Stack>
    {productError && <Alert severity="warning" action={<Button onClick={retryLoad}>再試行</Button>}>商品マスターを読み込めません。品目は手入力できます。</Alert>}
    {loadError ? <Alert severity="error" action={<Button onClick={retryLoad}>再試行</Button>}>{loadError}</Alert> : loading ? <CircularProgress /> : <TableContainer component={Paper}><Table sx={{ minWidth: 800 }}>
      <TableHead><TableRow>{['No.', '品目説明 / 翻訳', 'メーカー / 品番 / 商品名', '数量', '希望納期', '状態', '操作'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
      <TableBody>{visible.length === 0 ? <TableRow><TableCell colSpan={7} align="center">該当する品目はありません。</TableCell></TableRow> : visible.map(item => <TableRow key={item.id}>
        <TableCell>{item.lineNo}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.originalDescription}{item.translatedDescription && <Typography color="text.secondary">{item.translatedDescription}</Typography>}</TableCell>
        <TableCell>{[item.manufacturerName, item.partNumber, item.productName].filter(Boolean).join(' / ') || '—'}</TableCell><TableCell>{item.quantity} {item.unit}</TableCell><TableCell>{item.requestedDeliveryDate?.toDate().toLocaleDateString('ja-JP') ?? '—'}</TableCell>
        <TableCell><Chip size="small" label={item.archivedAt ? '削除済み' : rfqItemStatusLabels[item.status] ?? item.status} /></TableCell>
        <TableCell><Button disabled={busy || Boolean(item.archivedAt)} onClick={() => setEditing(item)}>編集</Button><Button disabled={busy} color={item.archivedAt ? 'success' : 'warning'} onClick={() => { setActionError(null); setConfirming(item) }}>{item.archivedAt ? '復元' : '削除'}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></TableContainer>}
    {editing !== undefined && <RfqItemDialog key={editing?.id ?? 'new'} rfqId={rfqId} item={editing} products={products} onClose={() => setEditing(undefined)} onSaved={message => { setEditing(undefined); setNotice(message) }} />}
    <Dialog open={Boolean(confirming)} onClose={busy ? undefined : () => setConfirming(null)}><DialogTitle>品目を{confirming?.archivedAt ? '復元' : '削除'}</DialogTitle><DialogContent>{actionError && <Alert severity="error">{actionError}</Alert>}<DialogContentText>明細No. {confirming?.lineNo} を{confirming?.archivedAt ? '復元します。' : '削除します。登録情報は保持され、後から復元できます。'}</DialogContentText></DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirming(null)}>キャンセル</Button><Button disabled={busy} onClick={() => void archive()}>{busy ? '処理中…' : confirming?.archivedAt ? '復元' : '削除'}</Button></DialogActions></Dialog>
    <Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4000} onClose={() => setNotice(null)} />
  </Box>
}
