import { useRef, useState, type FormEvent } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { createDeliveryLocation, setDeliveryLocationActive } from './deliveryLocationRepository'
import { useDeliveryLocations } from './useDeliveryLocations'
import { normalizeDeliveryLocation } from '../../../functions/src/deliveryLocationModel'

export function DeliveryLocationsPage() {
  const { locations, loading, error: readError, retry } = useDeliveryLocations()
  const [name, setName] = useState(''), [search, setSearch] = useState(''), [inactive, setInactive] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const saving = useRef(false)
  async function act(action: () => Promise<unknown>, message: string) {
    if (saving.current) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(message) } catch (cause) { setError(cause instanceof Error ? cause.message : '納品場所を保存できませんでした。') } finally { saving.current = false; setBusy(false) }
  }
  function add(event: FormEvent) { event.preventDefault(); void act(async () => { await createDeliveryLocation(name); setName('') }, '納品場所を登録しました。同じ名前がある場合は既存の候補を利用します。') }
  const visible = locations.filter(item => (inactive || item.active) && normalizeDeliveryLocation(item.name).includes(normalizeDeliveryLocation(search)))
  return <Box sx={{ maxWidth: 1000, mx: 'auto', p: 3 }}><Stack spacing={2}>
    <Typography component="h1" variant="h4">納品場所マスタ</Typography><Typography color="text.secondary">RFQで共通利用する候補です。無効化しても過去のRFQ・見積に保存した場所は保持されます。</Typography>
    {(readError || error) && <Alert severity="error" action={readError ? <Button onClick={retry}>再試行</Button> : undefined}>{readError || error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    <Paper component="form" onSubmit={add} sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><TextField label="新しい納品場所" required fullWidth value={name} disabled={busy} onChange={event => setName(event.target.value)} /><Button type="submit" variant="contained" disabled={busy || !name.trim()}>登録</Button></Stack></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><TextField fullWidth label="納品場所を検索" value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outlined" onClick={() => setInactive(value => !value)}>{inactive ? '無効を含めて表示中' : '無効を非表示'}</Button></Stack>
    <Paper><Table aria-label="納品場所一覧"><TableHead><TableRow><TableCell>納品場所</TableCell><TableCell>状態</TableCell><TableCell>操作</TableCell></TableRow></TableHead><TableBody>{visible.map(item => <TableRow key={item.id}><TableCell sx={{ overflowWrap: 'anywhere' }}>{item.name}</TableCell><TableCell><Chip size="small" label={item.active ? '有効' : '無効'} /></TableCell><TableCell><Button disabled={busy} color={item.active ? 'warning' : 'success'} onClick={() => void act(() => setDeliveryLocationActive(item.id, !item.active), item.active ? '納品場所を無効にしました。' : '納品場所を有効にしました。')}>{item.active ? '無効化' : '有効化'}</Button></TableCell></TableRow>)}{!visible.length && <TableRow><TableCell colSpan={3}>{loading ? '読み込み中…' : '該当する納品場所はありません。'}</TableCell></TableRow>}</TableBody></Table></Paper>
  </Stack></Box>
}
