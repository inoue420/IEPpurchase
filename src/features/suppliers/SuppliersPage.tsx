import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, TextField } from '@mui/material'
import { setSupplierActive, subscribeSuppliers, type Supplier } from './supplierRepository'
import { SupplierDialog } from './SupplierDialog'
import { supplierError } from './supplierError'

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined)
  const [confirming, setConfirming] = useState<Supplier | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const submitting = useRef(false)

  useEffect(() => subscribeSuppliers(next => {
    setSuppliers(next); setLoading(false); setLoadError(null)
  }, cause => {
    setLoadError(supplierError(cause)); setLoading(false)
  }), [retry])

  const visibleSuppliers = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ja-JP')
    return suppliers.filter(supplier => (includeInactive || supplier.active) &&
      (!keyword || [supplier.name, supplier.contactName, supplier.email, supplier.phone, supplier.postalCode, supplier.address, supplier.notes]
        .some(value => value.toLocaleLowerCase('ja-JP').includes(keyword))))
  }, [suppliers, search, includeInactive])

  async function toggleActive() {
    if (!confirming || submitting.current) return
    submitting.current = true
    setBusy(true)
    setActionError(null)
    try {
      await setSupplierActive(confirming.id, !confirming.active)
      setNotice(confirming.active ? '仕入先を無効にしました。' : '仕入先を有効に戻しました。')
      setConfirming(null)
    } catch (cause: unknown) {
      setActionError(supplierError(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <Box sx={{ maxWidth: 1280, mx: 'auto', p: { xs: 2, md: 3 } }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 3 }}>
      <Box><Typography component="h1" variant="h4">仕入先</Typography>
        <Typography color="text.secondary">見積依頼・購入先選定に使用する仕入先マスターを管理します。</Typography></Box>
      <Button variant="contained" onClick={() => setEditing(null)}>仕入先を登録</Button>
    </Stack>
    <Paper sx={{ p: 2, mb: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField label="検索" placeholder="仕入先名、担当者、連絡先、住所、備考で検索" fullWidth value={search} onChange={event => setSearch(event.target.value)} />
      <Button variant={includeInactive ? 'contained' : 'outlined'} aria-pressed={includeInactive} onClick={() => setIncludeInactive(value => !value)}>
        {includeInactive ? '無効な仕入先を表示中' : '無効な仕入先を非表示'}
      </Button>
    </Stack></Paper>
    {loadError && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => {
      setLoading(true); setLoadError(null); setRetry(value => value + 1)
    }}>再試行</Button>}>{loadError}</Alert>}
    {!loadError && <TableContainer component={Paper}>
      {loading ? <Box sx={{ display: 'grid', minHeight: 220, placeItems: 'center' }}><CircularProgress aria-label="仕入先一覧を読み込み中" /></Box> :
        <Table aria-label="仕入先一覧" sx={{ minWidth: 760 }}>
          <TableHead><TableRow>{['仕入先名', '担当者', 'メールアドレス', '電話番号', '状態'].map(label => <TableCell key={label}>{label}</TableCell>)}<TableCell align="right">操作</TableCell></TableRow></TableHead>
          <TableBody>
            {visibleSuppliers.length === 0 ? <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>該当する仕入先はありません。</TableCell></TableRow> :
              visibleSuppliers.map(supplier => <TableRow key={supplier.id} hover>
                <TableCell sx={{ overflowWrap: 'anywhere', maxWidth: 300 }}>{supplier.name}</TableCell>
                <TableCell>{supplier.contactName || '—'}</TableCell><TableCell>{supplier.email || '—'}</TableCell><TableCell>{supplier.phone || '—'}</TableCell>
                <TableCell><Chip size="small" color={supplier.active ? 'success' : 'default'} label={supplier.active ? '有効' : '無効'} /></TableCell>
                <TableCell align="right"><Button size="small" onClick={() => setEditing(supplier)} disabled={busy}>編集</Button>
                  <Button size="small" color={supplier.active ? 'warning' : 'success'} disabled={busy} onClick={() => { setActionError(null); setConfirming(supplier) }}>
                    {supplier.active ? '無効化' : '有効化'}
                  </Button></TableCell>
              </TableRow>)}
          </TableBody>
        </Table>}
    </TableContainer>}
    {editing !== undefined && <SupplierDialog key={editing?.id ?? 'new'} supplier={editing} onClose={() => setEditing(undefined)} onSaved={message => { setEditing(undefined); setNotice(message) }} />}
    <Dialog open={confirming !== null} onClose={busy ? undefined : () => setConfirming(null)} aria-labelledby="supplier-status-title">
      <DialogTitle id="supplier-status-title">仕入先を{confirming?.active ? '無効化' : '有効化'}</DialogTitle>
      <DialogContent>
        {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
        <DialogContentText>「{confirming?.name}」を{confirming?.active ? '無効にします。登録情報は保持され、後から有効に戻せます。' : '有効に戻します。'}</DialogContentText>
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setConfirming(null)}>キャンセル</Button>
        <Button variant="contained" disabled={busy} onClick={() => void toggleActive()}>{busy ? '処理中…' : confirming?.active ? '無効化' : '有効化'}</Button></DialogActions>
    </Dialog>
    <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice} />
  </Box>
}
