import { useRef, useState } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'
import { saveRfqItemTranslation, type RfqItem } from './rfqItemRepository'

const translate = httpsCallable<{ text: string }, { translatedText: string }>(firebaseFunctions, 'translateGoogleText', { timeout: 30000 })
export function BulkTranslationDialog({ rfqId, items, onClose }: { rfqId: string; items: RfqItem[]; onClose: () => void }) {
  const candidates = items.filter(item => !item.archivedAt && item.status !== 'cancelled')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ id: string; line: number; error?: string }[]>([])
  const running = useRef(false)
  async function run() {
    if (running.current) return
    const targets = candidates.filter(item => selected.includes(item.id))
    if (!targets.length) return
    running.current = true; setBusy(true); setResults([])
    const failedIds: string[] = []
    try {
      for (let i = 0; i < targets.length; i += 5) {
        await Promise.all(targets.slice(i, i + 5).map(async item => {
          try {
            const { data } = await translate({ text: item.originalDescription })
            await saveRfqItemTranslation(rfqId, item.id, item.originalDescription, data.translatedText, item.translatedDescription)
            setResults(old => [...old, { id: item.id, line: item.lineNo }])
          } catch (cause) {
            failedIds.push(item.id)
            setResults(old => [...old, { id: item.id, line: item.lineNo, error: cause instanceof Error ? cause.message : '翻訳・保存に失敗しました。' }])
          }
        }))
      }
    } finally { setSelected(failedIds); running.current = false; setBusy(false) }
  }
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : onClose}>
    <DialogTitle>品目を選択して一括翻訳</DialogTitle>
    <DialogContent><Stack spacing={1}>
      <Alert severity="info">選択した原文をGoogle Translationで英訳し、各品目に保存します。既存の翻訳説明は置き換わります。</Alert>
      <FormControlLabel label="すべて選択" control={<Checkbox disabled={busy} checked={candidates.length > 0 && candidates.every(item => selected.includes(item.id))} onChange={(_, checked) => setSelected(checked ? candidates.map(item => item.id) : [])} />} />
      {!candidates.length && <Typography>対象の品目がありません。</Typography>}
      {candidates.map(item => <FormControlLabel key={item.id} label={`No. ${item.lineNo}: ${item.originalDescription}`} control={<Checkbox disabled={busy} checked={selected.includes(item.id)} onChange={(_, checked) => setSelected(old => checked ? [...old, item.id] : old.filter(id => id !== item.id))} />} />)}
      {busy && <Typography>処理中: {results.length}件完了。画面を閉じずにお待ちください。</Typography>}
      {results.map(result => <Alert key={result.id} severity={result.error ? 'error' : 'success'}>No. {result.line}: {result.error ?? '翻訳を保存しました。'}</Alert>)}
    </Stack></DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>閉じる</Button><Button variant="contained" disabled={busy || !selected.length} onClick={() => void run()}>選択した品目を翻訳して保存</Button></DialogActions>
  </Dialog>
}
