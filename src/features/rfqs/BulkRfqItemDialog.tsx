import { useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { parseBulkRfqItems, validateBulkRfqItemInput, type BulkRfqItemDraft } from './bulkRfqItemParser'
import { readBulkRfqItemFile } from './bulkRfqItemParser'
import { createRfqItems, type RfqItemInput } from './rfqItemRepository'
import { rfqError } from './rfqError'

type EditableKey = 'manufacturerName' | 'partNumber' | 'originalDescription' | 'quantity' | 'unit' | 'note'

export function BulkRfqItemDialog({ rfqId, onClose, onSaved }: { rfqId: string; onClose: () => void; onSaved: (count: number) => void }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BulkRfqItemDraft[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const submitting = useRef(false)
  const targets = rows.filter(row => selected.includes(row.rowNumber) && !row.error)

  function preview() {
    const lineCount = text.replace(/\r/g, '').split('\n').filter(line => line.trim()).length
    if (lineCount > 51) {
      setRows([])
      setSelected([])
      setError('一度に登録できる品目は50件までです。表を分けて貼り付けてください。')
      return
    }
    const next = parseBulkRfqItems(text)
    setRows(next)
    setSelected(next.filter(row => !row.error).map(row => row.rowNumber))
    setError(next.length ? null : '見出し付きの表を貼り付けてください。タブ・パイプ・カンマ区切りに対応しています。')
  }
  async function chooseFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const previewed = await readBulkRfqItemFile(file)
      if (previewed.dataRowCount > 50) throw new Error('一度に登録できる品目は50件までです。ファイルを分けてください。')
      const next = parseBulkRfqItems(previewed.text)
      setText(previewed.text); setFileName(`${file.name}（${previewed.sheetName}）`)
      setRows(next); setSelected(next.filter(row => !row.error).map(row => row.rowNumber))
      setError(next.length ? null : '見出し付きの表を選択してください。')
    } catch (cause: unknown) {
      setRows([]); setSelected([]); setFileName(null)
      setError(cause instanceof Error ? cause.message : 'ファイルを読み取れませんでした。')
    }
  }
  function updateRow(rowNumber: number, key: EditableKey, value: string) {
    setRows(current => current.map(row => {
      if (row.rowNumber !== rowNumber) return row
      const input: RfqItemInput = { ...row.input, [key]: key === 'quantity' ? Number(value) : value }
      const next = { ...row, input, error: validateBulkRfqItemInput(input) }
      if (next.error) setSelected(values => values.filter(number => number !== rowNumber))
      return next
    }))
  }
  async function save() {
    if (!targets.length || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await createRfqItems(rfqId, targets.map(row => row.input))
      onSaved(targets.length)
    } catch (cause: unknown) {
      setConfirming(false)
      setError(rfqError(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return <>
    <Dialog open={!confirming} fullWidth maxWidth="xl" onClose={busy ? undefined : onClose}>
      <DialogTitle>品目をまとめて追加</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography color="text.secondary">メール本文などの表を貼り付けてください。1行目の見出しからメーカー名・品番・商品名／詳細・数量・単位・備考を判定します。最大50件です。</Typography>
        <Box><Button component="label" variant="outlined" disabled={busy}>CSV・Excelファイルを選択<input hidden type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} /></Button>{fileName && <Typography component="span" variant="body2" sx={{ ml: 1 }}>{fileName}</Typography>}</Box>
        <Typography variant="body2" color="text.secondary">ファイルはこのブラウザ内だけで読み取り、外部へアップロード・送信しません。</Typography>
        <TextField label="貼り付ける表" multiline minRows={7} value={text} disabled={busy} onChange={event => setText(event.target.value)} placeholder={'メーカー名\t品番\t詳細\t数量\t単位\t備考\nABC\tA-001\t六角ボルト\t10\t本\t至急'} />
        <Box><Button variant="outlined" disabled={busy || !text.trim()} onClick={preview}>プレビュー</Button></Box>
        {rows.length > 0 && <><Alert severity={rows.some(row => row.error) ? 'warning' : 'info'}>内容を修正し、登録する行を選択してください。エラーのある行は選択できません。</Alert><TableContainer><Table size="small" sx={{ minWidth: 1180 }}><TableHead><TableRow><TableCell>登録</TableCell><TableCell>行</TableCell><TableCell>メーカー</TableCell><TableCell>品番</TableCell><TableCell>詳細</TableCell><TableCell>数量</TableCell><TableCell>単位</TableCell><TableCell>備考</TableCell><TableCell>状態</TableCell></TableRow></TableHead><TableBody>{rows.map(row => <TableRow key={row.rowNumber} selected={selected.includes(row.rowNumber)}><TableCell padding="checkbox"><Checkbox checked={selected.includes(row.rowNumber)} disabled={busy || Boolean(row.error)} onChange={event => setSelected(current => event.target.checked ? [...current, row.rowNumber] : current.filter(value => value !== row.rowNumber))} /></TableCell><TableCell>{row.rowNumber}</TableCell>{(['manufacturerName', 'partNumber', 'originalDescription'] as const).map(key => <TableCell key={key}><TextField size="small" value={row.input[key]} disabled={busy} onChange={event => updateRow(row.rowNumber, key, event.target.value)} /></TableCell>)}<TableCell><TextField size="small" type="number" inputProps={{ min: 0, step: 'any' }} value={Number.isFinite(row.input.quantity) ? row.input.quantity : ''} disabled={busy} onChange={event => updateRow(row.rowNumber, 'quantity', event.target.value)} /></TableCell><TableCell><TextField size="small" value={row.input.unit} disabled={busy} onChange={event => updateRow(row.rowNumber, 'unit', event.target.value)} /></TableCell><TableCell><TextField size="small" value={row.input.note} disabled={busy} onChange={event => updateRow(row.rowNumber, 'note', event.target.value)} /></TableCell><TableCell><Typography variant="body2" color={row.error ? 'error' : 'success.main'}>{row.error ?? '登録可能'}</Typography></TableCell></TableRow>)}</TableBody></Table></TableContainer></>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={onClose}>キャンセル</Button><Button variant="contained" disabled={busy || !targets.length} onClick={() => setConfirming(true)}>{`${targets.length}件の登録内容を確認`}</Button></DialogActions>
    </Dialog>
    <Dialog open={confirming} onClose={busy ? undefined : () => setConfirming(false)}><DialogTitle>選択した品目を登録</DialogTitle><DialogContent>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<DialogContentText>確認済みの{targets.length}件をこのRFQへ登録します。すべての品目をまとめて保存します。</DialogContentText></DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirming(false)}>戻る</Button><Button variant="contained" disabled={busy || !targets.length} onClick={() => void save()}>{busy ? '登録中…' : '登録する'}</Button></DialogActions></Dialog>
  </>
}
