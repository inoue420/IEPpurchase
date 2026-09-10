import { useState, type FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, TextField, Typography } from '@mui/material'
import { firebaseFunctions } from '../../firebase/firebase'
import type { MarketplaceOfferInput } from './marketplaceOfferSchema'

interface SearchItem { itemCode: string; itemName: string; itemPrice: number; itemUrl: string; shopName: string; taxFlag: number | null; postageFlag: number | null; availability: number | null }
interface SearchResult { items: SearchItem[]; retrievedAt: string }
const searchItems = httpsCallable<{ keyword: string }, SearchResult>(firebaseFunctions, 'searchRakutenItems', { timeout: 30000 })

export function RakutenSearchDialog({ close, select }: { close: () => void; select: (input: Partial<MarketplaceOfferInput>) => void }) {
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  async function search(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setResult(null)
    try { setResult((await searchItems({ keyword: keyword.trim() })).data) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '楽天検索に失敗しました。') }
    finally { setBusy(false) }
  }
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : close}>
    <DialogTitle>楽天で商品を検索</DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Typography>入力した検索語を楽天へ送信します。品番や商品名で検索してください。</Typography>
      <Box component="form" onSubmit={event => void search(event)}><Stack direction="row" spacing={1} sx={{ pt: 1 }}>
        <TextField fullWidth required label="検索語" value={keyword} disabled={busy} onChange={event => { setKeyword(event.target.value); setResult(null) }} />
        <Button type="submit" variant="contained" disabled={busy || !keyword.trim()}>検索</Button>
      </Stack></Box>
      {busy && <CircularProgress />}{error && <Alert severity="error">{error}</Alert>}
      {result && <Typography>検索結果 {result.items.length}件（最大20件）。絞り込む場合は検索語を追加してください。</Typography>}
      {result?.items.length === 0 && <Alert severity="info">該当する商品はありません。検索語を変更してください。</Alert>}
      {result?.items.map(item => <Box key={item.itemCode} sx={{ border: 1, borderColor: 'divider', p: 2, borderRadius: 1 }}>
        <Link href={item.itemUrl} target="_blank" rel="noopener noreferrer">{item.itemName}</Link>
        <Typography>{item.shopName} ／ {item.itemPrice.toLocaleString('ja-JP')}円 ／ {item.taxFlag === 0 ? '税込' : item.taxFlag === 1 ? '税抜' : '税区分未確認'}</Typography>
        <Typography color="text.secondary">{item.postageFlag === 0 ? '送料込み表示（配送条件は要確認）' : '送料要確認'} ／ {item.availability === 1 ? '販売可能表示（数量は未確認）' : item.availability === 0 ? '売り切れ表示' : '在庫未確認'}</Typography>
        <Button onClick={() => select({ source: 'rakuten', externalItemId: item.itemCode, sellerName: item.shopName, itemName: item.itemName, itemUrl: item.itemUrl, unitPrice: item.itemPrice, shippingFee: null, taxCategory: item.taxFlag === 1 ? 'exclusive' : 'inclusive', retrievedAt: result.retrievedAt, stockStatus: item.availability === 0 ? '売り切れ表示' : '必要数量は未確認', note: '楽天検索から取得。送料・税率・規格・数量・単位を商品ページで確認してください。' })}>内容を確認して候補保存</Button>
      </Box>)}
      <Link href="https://webservice.rakuten.co.jp/" target="_blank" rel="noopener noreferrer">Supported by Rakuten Developers</Link>
    </Stack></DialogContent>
    <DialogActions><Button disabled={busy} onClick={close}>閉じる</Button></DialogActions>
  </Dialog>
}
