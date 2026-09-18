import { useRef, useState, type ClipboardEvent } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { createRfqItems, type RfqItemInput } from './rfqItemRepository'
import { validateBulkRfqItemInput, type BulkRfqItemDraft } from './bulkRfqItemParser'
import { parseVisionOcrItems } from './visionOcrItemParser'
import { extractVisionOcrText } from './visionOcr'
import { rfqError } from './rfqError'
import { applyVisionOcrBatchEdit, visionOcrColumns, type VisionOcrBatchAction, type VisionOcrBatchScope, type VisionOcrColumnKey } from './visionOcrBatchEdit'

type Key = 'manufacturerName' | 'partNumber' | 'originalDescription' | 'quantity' | 'unit'
export function VisionOcrImportDialog({ rfqId, onClose, onSaved }: { rfqId: string; onClose: () => void; onSaved: (count: number) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null); const [text, setText] = useState(''); const [confidence, setConfidence] = useState<number | null>(null)
  const [rows, setRows] = useState<BulkRfqItemDraft[]>([]); const [selected, setSelected] = useState<number[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const [batchAction, setBatchAction] = useState<VisionOcrBatchAction>('move')
  const [batchSource, setBatchSource] = useState<VisionOcrColumnKey>('originalDescription')
  const [batchTarget, setBatchTarget] = useState<VisionOcrColumnKey>('partNumber')
  const [batchScope, setBatchScope] = useState<VisionOcrBatchScope>('selected')
  const targets = rows.filter(row => selected.includes(row.rowNumber) && !row.error)
  function selectFile(next: File | null) { setFile(next); setRows([]); setSelected([]); setText(''); setConfidence(null); setError(null) }
  function pasteScreenshot(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = Array.from(event.clipboardData.items).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (!pasted) { setError('クリップボードに画像がありません。スクリーンショットをコピーしてから貼り付けてください。'); return }
    event.preventDefault()
    const extension = pasted.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    selectFile(new File([pasted], 'screenshot-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + extension, { type: pasted.type, lastModified: Date.now() }))
  }
  function rebuildCandidates(source: string) { const next = parseVisionOcrItems(source); setRows(next); setSelected(next.filter(row => !row.error).map(row => row.rowNumber)); setError(next.length ? null : '品目候補を作成できませんでした。抽出テキストを修正してください。') }
  async function extract() {
    if (!file) return
    setBusy(true); setError(null)
    try { const result = await extractVisionOcrText(file); setText(result.text); setConfidence(result.confidence); rebuildCandidates(result.text) }
    catch (cause) { setError(rfqError(cause)) } finally { setBusy(false) }
  }
  function update(rowNumber: number, key: Key, value: string) {
    setRows(current => current.map(row => { if (row.rowNumber !== rowNumber) return row; const nextInput: RfqItemInput = { ...row.input, [key]: key === 'quantity' ? Number(value) : value }; const next = { ...row, input: nextInput, error: validateBulkRfqItemInput(nextInput) }; if (next.error) setSelected(ids => ids.filter(id => id !== rowNumber)); return next }))
  }
  function applyBatchEdit() {
    const result = applyVisionOcrBatchEdit(rows, selected, batchAction, batchSource, batchAction === 'clear' ? null : batchTarget, batchScope)
    if (!result.affectedCount) { setError(batchScope === 'selected' && !selected.length ? 'まとめて編集する行を選択してください。' : 'コピー元とコピー先には異なる列を選択してください。'); return }
    setRows(result.rows); setSelected(result.selectedRowNumbers); setError(null)
  }
  async function save() { if (!targets.length) return; setBusy(true); setError(null); try { await createRfqItems(rfqId, targets.map(row => row.input)); onSaved(targets.length) } catch (cause) { setError(rfqError(cause)) } finally { setBusy(false) } }
  return <Dialog open fullWidth maxWidth="xl" onClose={busy ? undefined : onClose}><DialogTitle>画像・スキャン表から品目候補を作成</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
    {error && <Alert severity="error">{error}</Alert>}<Alert severity="warning">選択したファイルはGoogle Cloud VisionへOCR処理のため送信されます。結果は候補です。品番・数量・単位を必ず確認してから登録してください。ファイル自体はこの画面から保存しません。</Alert>
    <Box tabIndex={0} onPaste={pasteScreenshot} sx={{ border: '2px dashed', borderColor: 'divider', borderRadius: 1, p: 2, outline: 'none', '&:focus': { borderColor: 'primary.main', bgcolor: 'action.focus' } }}><Typography fontWeight="bold">スクリーンショットを貼り付け</Typography><Typography variant="body2" color="text.secondary">この枠をクリックし、Ctrl+Vでクリップボードの画像を貼り付けてください。</Typography></Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}><Button variant="outlined" disabled={busy} onClick={() => input.current?.click()}>画像・PDFを選択</Button><Typography variant="body2">{file?.name ?? '未選択（10MB以下、PDFは先頭5ページ）'}</Typography><input ref={input} hidden type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,image/x-icon,application/pdf,.pdf" onChange={event => { selectFile(event.target.files?.[0] ?? null); event.target.value = '' }} /><Button variant="contained" disabled={busy || !file} onClick={() => void extract()}>{busy ? 'OCR処理中…' : 'OCRして候補を作成'}</Button></Stack>
    {text && <><TextField label="OCR抽出テキスト（確認・修正用）" value={text} multiline minRows={4} disabled={busy} onChange={event => setText(event.target.value)} helperText={confidence == null ? '文字の信頼度は取得できませんでした。' : `平均文字信頼度: ${Math.round(confidence * 100)}%`} /><Button variant="outlined" disabled={busy || !text.trim()} onClick={() => rebuildCandidates(text)}>修正したテキストから候補を再作成</Button></>}
    {rows.length > 0 && <><Alert severity={rows.some(row => row.error) ? 'warning' : 'info'}>候補は自動確定されません。修正後、登録する行だけを選択してください。</Alert><Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}><Typography fontWeight="bold" sx={{ mb: 1 }}>列をまとめて編集</Typography><Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}><FormControl size="small" sx={{ minWidth: 120 }}><InputLabel>操作</InputLabel><Select label="操作" value={batchAction} disabled={busy} onChange={event => setBatchAction(event.target.value as VisionOcrBatchAction)}><MenuItem value="copy">コピー</MenuItem><MenuItem value="move">移動</MenuItem><MenuItem value="clear">消去</MenuItem></Select></FormControl><FormControl size="small" sx={{ minWidth: 150 }}><InputLabel>{batchAction === 'clear' ? '消去する列' : '元の列'}</InputLabel><Select label={batchAction === 'clear' ? '消去する列' : '元の列'} value={batchSource} disabled={busy} onChange={event => setBatchSource(event.target.value as VisionOcrColumnKey)}>{visionOcrColumns.map(column => <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>)}</Select></FormControl>{batchAction !== 'clear' && <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel>先の列</InputLabel><Select label="先の列" value={batchTarget} disabled={busy} onChange={event => setBatchTarget(event.target.value as VisionOcrColumnKey)}>{visionOcrColumns.map(column => <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>)}</Select></FormControl>}<FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>対象</InputLabel><Select label="対象" value={batchScope} disabled={busy} onChange={event => setBatchScope(event.target.value as VisionOcrBatchScope)}><MenuItem value="selected">選択した行</MenuItem><MenuItem value="all">すべての候補行</MenuItem></Select></FormControl><Button variant="outlined" disabled={busy} onClick={applyBatchEdit}>まとめて適用</Button></Stack><Typography variant="caption" color="text.secondary">移動は元の列を空欄にします。値は上書きされます。入力エラーになった行は登録対象から外れます。</Typography></Box><TableContainer><Table size="small" sx={{ minWidth: 900 }}><TableHead><TableRow>{['登録', '行', 'メーカー', '品番', '品目説明', '数量', '単位', '状態'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{rows.map(row => <TableRow key={row.rowNumber}><TableCell padding="checkbox"><Checkbox checked={selected.includes(row.rowNumber)} disabled={busy || Boolean(row.error)} onChange={event => setSelected(ids => event.target.checked ? [...ids, row.rowNumber] : ids.filter(id => id !== row.rowNumber))} /></TableCell><TableCell>{row.rowNumber}</TableCell>{(['manufacturerName', 'partNumber', 'originalDescription'] as const).map(key => <TableCell key={key}><TextField size="small" value={row.input[key]} disabled={busy} onChange={event => update(row.rowNumber, key, event.target.value)} /></TableCell>)}<TableCell><TextField size="small" type="number" value={row.input.quantity} disabled={busy} onChange={event => update(row.rowNumber, 'quantity', event.target.value)} /></TableCell><TableCell><TextField size="small" value={row.input.unit} disabled={busy} onChange={event => update(row.rowNumber, 'unit', event.target.value)} /></TableCell><TableCell>{row.error ?? '登録可能'}</TableCell></TableRow>)}</TableBody></Table></TableContainer></>}
  </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>キャンセル</Button><Button variant="contained" disabled={busy || !targets.length} onClick={() => void save()}>{busy ? '登録中…' : `選択した${targets.length}件を登録`}</Button></DialogActions></Dialog>
}
