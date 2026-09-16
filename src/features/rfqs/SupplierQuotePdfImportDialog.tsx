import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { extractSupplierQuotePdfRows } from './supplierQuotePdfExtraction'
import { setRfqItemSupplierResponseUnitPrices, type RfqItem } from './rfqItemRepository'
import { normalizePartNumber, type SupplierQuotePdfRow } from './supplierQuotePdfParser'
import { rfqError } from './rfqError'

interface PdfMatch { item: RfqItem; row: SupplierQuotePdfRow }

export function SupplierQuotePdfImportDialog({ rfqId, items, onClose, onImported }: { rfqId: string; items: RfqItem[]; onClose: () => void; onImported: (count: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [rows, setRows] = useState<SupplierQuotePdfRow[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeItems = useMemo(() => items.filter(item => !item.archivedAt && item.status !== 'cancelled' && item.partNumber.trim()), [items])
  const matches = useMemo<PdfMatch[]>(() => activeItems.flatMap(item => {
    const matchedRows = rows.filter(row => normalizePartNumber(row.partNumber) === normalizePartNumber(item.partNumber))
    return matchedRows.length === 1 ? [{ item, row: matchedRows[0] }] : []
  }), [activeItems, rows])
  const matchedPartNumbers = new Set(matches.map(match => normalizePartNumber(match.row.partNumber)))
  const unmatchedRows = rows.filter(row => !matchedPartNumbers.has(normalizePartNumber(row.partNumber)))
  async function extract() {
    if (!file) { setError('PDFファイルを選択してください。'); return }
    setBusy(true); setError(null)
    try {
      const extracted = await extractSupplierQuotePdfRows(file, password)
      setRows(extracted)
      setSelectedItemIds(activeItems.flatMap(item => extracted.filter(row => normalizePartNumber(row.partNumber) === normalizePartNumber(item.partNumber)).length === 1 ? [item.id] : []))
      setPassword('')
    } catch (cause) { setRows([]); setSelectedItemIds([]); setError(cause instanceof Error ? cause.message : 'PDFの抽出に失敗しました。') }
    finally { setBusy(false) }
  }
  async function apply() {
    const selected = matches.filter(match => selectedItemIds.includes(match.item.id))
    if (selected.length === 0) { setError('反映する品目を1件以上選択してください。'); return }
    setBusy(true); setError(null)
    try {
      await setRfqItemSupplierResponseUnitPrices(rfqId, selected.map(match => ({ itemId: match.item.id, supplierResponseUnitPrice: match.row.supplierResponseUnitPrice })))
      onImported(selected.length)
    } catch (cause) { setError(rfqError(cause)) }
    finally { setBusy(false) }
  }
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : onClose}>
    <DialogTitle>仕入先見積PDFを取り込む</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography color="text.secondary">PDFとパスワードはこのブラウザ内でのみ読み取り、パスワードは保存しません。品番がRFQ品目と完全一致する仕切単価だけを確認して反映できます。</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}><Button variant="outlined" disabled={busy} onClick={() => inputRef.current?.click()}>PDFを選択</Button><Typography variant="body2">{file?.name ?? '未選択'}</Typography><input ref={inputRef} hidden type="file" accept="application/pdf,.pdf" onChange={event => { setFile(event.target.files?.[0] ?? null); setRows([]); setSelectedItemIds([]); setError(null) }} /></Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}><TextField label="PDFパスワード" type="password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} autoComplete="off" /><Button variant="contained" disabled={busy || !file || !password} onClick={() => void extract()}>{busy ? '抽出中…' : '抽出して照合'}</Button></Stack>
      {rows.length > 0 && <><Alert severity={matches.length ? 'success' : 'warning'}>PDFから{rows.length}件を抽出し、RFQ品目と完全一致した{matches.length}件を確認対象にしました。{unmatchedRows.length ? ` ${unmatchedRows.length}件は一致する品番がないか、PDF内で重複しています。` : ''}</Alert><TableContainer><Table size="small"><TableHead><TableRow><TableCell>反映</TableCell><TableCell>No.</TableCell><TableCell>品番</TableCell><TableCell align="right">PDFの仕切単価</TableCell><TableCell align="right">現在の回答単価</TableCell></TableRow></TableHead><TableBody>{matches.map(match => <TableRow key={match.item.id}><TableCell padding="checkbox"><Checkbox checked={selectedItemIds.includes(match.item.id)} disabled={busy} onChange={event => setSelectedItemIds(current => event.target.checked ? [...current, match.item.id] : current.filter(id => id !== match.item.id))} /></TableCell><TableCell>{match.item.lineNo}</TableCell><TableCell>{match.item.partNumber}</TableCell><TableCell align="right">{match.row.supplierResponseUnitPrice.toLocaleString('ja-JP')}円</TableCell><TableCell align="right">{match.item.supplierResponseUnitPrice == null ? '—' : `${match.item.supplierResponseUnitPrice.toLocaleString('ja-JP')}円`}</TableCell></TableRow>)}{matches.length === 0 && <TableRow><TableCell colSpan={5} align="center">反映できる一致品番がありません。</TableCell></TableRow>}</TableBody></Table></TableContainer></>}
    </Stack></DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>キャンセル</Button><Button variant="contained" disabled={busy || rows.length === 0 || selectedItemIds.length === 0} onClick={() => void apply()}>{busy ? '反映中…' : `選択した${selectedItemIds.length}件を反映`}</Button></DialogActions>
  </Dialog>
}
