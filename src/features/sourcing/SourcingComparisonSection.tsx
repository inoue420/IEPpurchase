import { useEffect, useState } from 'react'
import { Alert, Box, Chip, CircularProgress, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { subscribeMarketplaceOffers, type MarketplaceOffer } from '../marketplaceOffers/marketplaceOfferRepository'
import { subscribeRfqItems, type RfqItem } from '../rfqs/rfqItemRepository'
import { subscribeSupplierQuoteItems, type SupplierQuoteItem } from '../supplierQuotes/supplierQuoteItemRepository'
import { subscribeSupplierQuotes, type SupplierQuote } from '../supplierQuotes/supplierQuoteRepository'
import { buildSourcingCandidates, sortSourcingCandidates, type SourcingSortKey } from './sourcingComparison'

const yen = (value: number | null) => value === null ? '未確認' : `${value.toLocaleString('ja-JP')}円`
const dateText = (value: Date | null) => value ? value.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未確認'
const itemTitle = (item: RfqItem) => item.productName || item.translatedDescription || item.originalDescription

function useQuoteItems(quotes: SupplierQuote[]) {
  const [items, setItems] = useState<Record<string, SupplierQuoteItem[]>>({})
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const activeQuotes = quotes.filter((quote) => quote.archivedAt === null && quote.status !== 'withdrawn')
    if (activeQuotes.length === 0) { setItems({}); return }
    setFailed(false)
    const next: Record<string, SupplierQuoteItem[]> = {}
    const unsubscribers = activeQuotes.map((quote) => subscribeSupplierQuoteItems(quote.id, (value) => {
      next[quote.id] = value
      setItems({ ...next })
    }, () => setFailed(true)))
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [quotes])
  return { items, failed }
}

export function SourcingComparisonSection({ rfqId }: { rfqId: string }) {
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([])
  const [offers, setOffers] = useState<MarketplaceOffer[]>([])
  const [quotes, setQuotes] = useState<SupplierQuote[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [sortKey, setSortKey] = useState<SourcingSortKey>('total')
  const [ready, setReady] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => subscribeRfqItems(rfqId, (value) => { setRfqItems(value); setReady((old) => old | 1) }, () => setError('案件品目を取得できませんでした。')), [rfqId])
  useEffect(() => subscribeMarketplaceOffers(rfqId, (value) => { setOffers(value); setReady((old) => old | 2) }, () => setError('EC購入候補を取得できませんでした。')), [rfqId])
  useEffect(() => subscribeSupplierQuotes(rfqId, (value) => { setQuotes(value); setReady((old) => old | 4) }, () => setError('仕入先見積を取得できませんでした。')), [rfqId])

  const quoteState = useQuoteItems(quotes)
  const activeItems = rfqItems.filter((item) => item.archivedAt === null && item.status !== 'cancelled')
  const selected = activeItems.find((item) => item.id === selectedId) ?? activeItems[0]
  const candidates = selected ? sortSourcingCandidates(buildSourcingCandidates(selected, offers, quotes, quoteState.items), sortKey) : []

  return <Box sx={{ mt: 3 }}>
    <Typography component="h2" variant="h5" sx={{ mb: 1 }}>品目別購入候補の比較</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>同じ案件品目の仕入先見積明細とEC候補だけを比較します。未確認項目や期限切れは採用前に確認してください。</Typography>
    {error || quoteState.failed ? <Alert severity="error">{error || '仕入先見積明細を取得できませんでした。'}</Alert> : ready !== 7 ? <CircularProgress /> : activeItems.length === 0 ? <Alert severity="info">比較できる有効な案件品目がありません。</Alert> : <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField select label="案件品目" value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} sx={{ minWidth: 300 }}>{activeItems.map((item) => <MenuItem key={item.id} value={item.id}>{item.lineNo}: {itemTitle(item)}</MenuItem>)}</TextField>
        <TextField select label="並べ替え" value={sortKey} onChange={(event) => setSortKey(event.target.value as SourcingSortKey)} sx={{ minWidth: 210 }}><MenuItem value="total">送料込総額（安い順）</MenuItem><MenuItem value="unitPrice">単価（安い順）</MenuItem><MenuItem value="delivery">納期（早い順）</MenuItem></TextField>
      </Stack>
      {selected && <Alert severity="info">必要数量: {selected.quantity} {selected.unit} ／ 品番: {selected.partNumber || '—'}</Alert>}
      <TableContainer component={Paper}><Table size="small"><TableHead><TableRow>{['候補', '品名・品番', '数量', '単価', '送料', '送料込総額', '納期・在庫', '取得日', 'URL・備考'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {candidates.length === 0 ? <TableRow><TableCell colSpan={9} align="center">この品目の比較候補はありません。仕入先見積明細またはEC購入候補を登録してください。</TableCell></TableRow> : candidates.map((candidate) => <TableRow key={`${candidate.kind}-${candidate.id}`}><TableCell>{candidate.source}<br />{candidate.seller || '—'}{candidate.expired && <><br /><Chip size="small" color="warning" label="見積期限切れ" /></>}</TableCell><TableCell>{candidate.itemName}<br />{candidate.partNumber || '—'}</TableCell><TableCell>{candidate.quantity} {candidate.unit}{selected && (candidate.quantity !== selected.quantity || candidate.unit !== selected.unit) && <><br /><Chip size="small" color="info" label="数量・単位条件が異なります" /></>}</TableCell><TableCell>{yen(candidate.unitPrice)}</TableCell><TableCell>{yen(candidate.shippingFee)}</TableCell><TableCell>{yen(candidate.total)}</TableCell><TableCell>{dateText(candidate.delivery)}<br />{candidate.stock || '在庫未確認'}</TableCell><TableCell>{dateText(candidate.observedAt)}</TableCell><TableCell>{candidate.url ? <Link href={candidate.url} target="_blank" rel="noopener noreferrer">商品</Link> : '—'}{candidate.note && <><br />{candidate.note}</>}</TableCell></TableRow>)}
      </TableBody></Table></TableContainer>
    </Stack>}
  </Box>
}

