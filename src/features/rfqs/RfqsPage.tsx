import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { rfqError } from './rfqError'
import { subscribeRfqs, type Rfq } from './rfqRepository'
import { getRfqDisplayStatus, rfqDisplayStatusLabels } from './rfqProgress'
import { useRfqProgress } from './useRfqProgress'
import { includesSearchText, normalizeSearchText } from '../../utils/searchText'

const dateText = (value: Rfq['receivedAt']) => value ? value.toDate().toLocaleDateString('ja-JP') : '—'

export function RfqsPage() {
  const [rfqs, setRfqs] = useState<Rfq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const progressStates = useRfqProgress(rfqs.filter(rfq => !['completed', 'cancelled'].includes(rfq.status)).map(rfq => rfq.id), retry)
  useEffect(() => subscribeRfqs(items => { setRfqs(items); setLoading(false); setError(null) }, cause => { setError(rfqError(cause)); setLoading(false) }), [retry])
  const rows = useMemo(() => rfqs.map(rfq => {
    const status = getRfqDisplayStatus(rfq.status, progressStates[rfq.id]?.progress)
    return { rfq, statusLabel: status ? rfqDisplayStatusLabels[status] : progressStates[rfq.id]?.error ? '取得失敗' : '確認中…' }
  }), [rfqs, progressStates])
  const visible = useMemo(() => {
    const keyword = normalizeSearchText(search)
    return rows.filter(({ rfq, statusLabel }) => !keyword || [rfq.rfqNumber, rfq.customerName, rfq.subject, rfq.note, statusLabel].some(value => includesSearchText(value, keyword)))
  }, [rows, search])
  const progressError = rfqs.some(rfq => !['completed', 'cancelled'].includes(rfq.status) && progressStates[rfq.id]?.error)
  const retryLoad = () => { setLoading(true); setError(null); setRetry(value => value + 1) }
  return <Box sx={{ maxWidth: 1280, mx: 'auto', p: { xs: 2, md: 3 } }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 3 }}>
      <Box><Typography component="h1" variant="h4">RFQ案件</Typography><Typography color="text.secondary">顧客から受けた見積依頼を案件単位で管理します。</Typography></Box>
      <Button component={Link} to="/rfqs/new" variant="contained">RFQ案件を登録</Button>
    </Stack>
    <Paper sx={{ p: 2, mb: 2 }}><TextField label="検索" placeholder="案件番号、顧客名、件名、ステータス、備考で検索" fullWidth value={search} onChange={event => setSearch(event.target.value)} /></Paper>
    {error && <Alert severity="error" action={<Button color="inherit" onClick={retryLoad}>再試行</Button>}>{error}</Alert>}
    {!error && <>
      {progressError && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" onClick={retryLoad}>再試行</Button>}>一部の案件のステータスを取得できませんでした。再試行してください。</Alert>}
      <TableContainer component={Paper}>{loading ? <Box sx={{ display: 'grid', minHeight: 220, placeItems: 'center' }}><CircularProgress /></Box> : <Table sx={{ minWidth: 800 }}>
        <TableHead><TableRow>{['案件番号', '顧客', '件名', '受信日', '見積期限', 'ステータス'].map(label => <TableCell key={label}>{label}</TableCell>)}<TableCell align="right">操作</TableCell></TableRow></TableHead>
        <TableBody>{visible.length === 0 ? <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}>該当するRFQ案件はありません。</TableCell></TableRow> : visible.map(({ rfq, statusLabel }) => <TableRow hover key={rfq.id}>
          <TableCell>{rfq.rfqNumber}</TableCell><TableCell>{rfq.customerName}</TableCell><TableCell>{rfq.subject}</TableCell><TableCell>{dateText(rfq.receivedAt)}</TableCell><TableCell>{dateText(rfq.dueDate)}</TableCell>
          <TableCell><Chip size="small" label={statusLabel} /></TableCell><TableCell align="right"><Button component={Link} to={`/rfqs/${rfq.id}`} size="small">詳細</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table>}</TableContainer>
    </>}
  </Box>
}
