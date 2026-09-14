import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'

export interface SelectedFreeePartner { id: number; name: string; companyId: number }
interface SearchResult { companyId: number; partners: { id: number; name: string; code: string }[]; nextOffset: number | null }
export function FreeePartnerPicker({ value, disabled, onChange }: { value: SelectedFreeePartner | null; disabled: boolean; onChange: (value: SelectedFreeePartner) => void }) {
  const [open, setOpen] = useState(false), [keyword, setKeyword] = useState(''), [searched, setSearched] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function search(offset = 0) {
    setBusy(true); setError('')
    if (offset === 0) setResult(null)
    try {
      const query = offset ? searched : keyword
      const { data } = await httpsCallable<unknown, SearchResult>(firebaseFunctions, 'searchFreeePartners')({ keyword: query, offset })
      if (offset && result && data.companyId !== result.companyId) { setResult(null); throw new Error('接続事業所が変わりました。検索し直してください。') }
      setSearched(query)
      setResult({ ...data, partners: offset && result ? [...new Map([...result.partners, ...data.partners].map(p => [p.id, p])).values()] : data.partners })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '取得できませんでした。再検索してください。') }
    finally { setBusy(false) }
  }
  return <Stack spacing={1}>
    <Typography>{value ? `freee取引先：${value.name}（ID ${value.id}）` : 'freee取引先を名前で選択してください。'}</Typography>
    <Button disabled={disabled} variant="outlined" onClick={() => { setOpen(true); setResult(null); setError('') }}>freee取引先を選ぶ</Button>
    <Dialog open={open} fullWidth maxWidth="sm" onClose={busy ? undefined : () => setOpen(false)}>
      <DialogTitle>freeeの登録済み取引先を選択</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField label="取引先名で検索" value={keyword} disabled={busy} onChange={e => setKeyword(e.target.value)} helperText="空欄で検索すると登録済み取引先を表示します。" />
        <Button disabled={busy} onClick={() => void search()}>{busy ? '読み込み中…' : '検索・再読み込み'}</Button>
        {error && <Alert severity="error">{error}</Alert>}
        {result && <Typography variant="body2">接続事業所ID：{result.companyId}</Typography>}
        {result?.partners.length === 0 && <Alert severity="info">該当する取引先がありません。検索語またはfreee側の取引先登録を確認してください。</Alert>}
        {result?.partners.map(p => <Button key={p.id} disabled={busy || disabled} variant="outlined" onClick={() => { onChange({ id: p.id, name: p.name, companyId: result.companyId }); setOpen(false) }}>{p.name}（ID {p.id}{p.code ? ` ／ コード ${p.code}` : ''}）</Button>)}
        {result?.nextOffset != null && <Button disabled={busy} onClick={() => void search(result.nextOffset!)}>さらに読み込む</Button>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setOpen(false)}>閉じる</Button></DialogActions>
    </Dialog>
  </Stack>
}
