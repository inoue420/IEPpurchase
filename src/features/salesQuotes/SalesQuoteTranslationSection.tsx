import { useEffect, useState } from 'react'
import { FreeeQuotationSection } from './FreeeQuotationSection'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { subscribeRfqItems, type RfqItem } from '../rfqs/rfqItemRepository'
import { confirmSalesQuoteTranslation, prepareSalesQuoteTranslation, reopenSalesQuoteTranslation, subscribeSalesQuote, subscribeSalesQuoteItems, updateSalesQuoteOutput, type SalesQuoteTranslation, type SalesQuoteTranslationItem } from './salesQuoteTranslationRepository'

function EditDialog({ item, close, saved }: { item: SalesQuoteTranslationItem; close: () => void; saved: (output: string) => Promise<void> }) {
  const [output, setOutput] = useState(item.outputDescription)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); setError(''); try { await saved(output); close() } catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。') } finally { setBusy(false) } }
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : close}><DialogTitle>見積用の品目名・説明を確認</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
    {error && <Alert severity="error">{error}</Alert>}<TextField label="原文" value={item.originalDescription} multiline disabled /><TextField label="登録済み英訳" value={item.translatedDescription || '未入力'} multiline disabled />
    <TextField autoFocus required label="見積用の出力文" helperText="この文だけが確定後の販売見積に保存されます。" value={output} multiline minRows={3} disabled={busy} onChange={event => setOutput(event.target.value)} />
  </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={close}>キャンセル</Button><Button variant="contained" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</Button></DialogActions></Dialog>
}

export function SalesQuoteTranslationSection({ rfqId }: { rfqId: string }) {
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([]), [quote, setQuote] = useState<SalesQuoteTranslation | null>(null), [items, setItems] = useState<SalesQuoteTranslationItem[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState<SalesQuoteTranslationItem | null>(null), [confirmReimport, setConfirmReimport] = useState(false)
  useEffect(() => subscribeRfqItems(rfqId, setRfqItems, () => setError('RFQ品目を取得できませんでした。')), [rfqId])
  useEffect(() => subscribeSalesQuote(rfqId, setQuote, () => setError('販売見積を取得できませんでした。')), [rfqId])
  useEffect(() => subscribeSalesQuoteItems(rfqId, setItems, () => setError('販売見積明細を取得できませんでした。')), [rfqId])
  const confirmed = quote?.status === 'confirmed'
  async function prepare() { setBusy(true); setError(''); setNotice(''); try { await prepareSalesQuoteTranslation(rfqId, rfqItems, quote, items); setNotice('RFQ品目の最新内容を販売見積明細へ取り込みました。') } catch (cause) { setError(cause instanceof Error ? cause.message : '取り込めませんでした。') } finally { setBusy(false) } }
  async function reopen() { setBusy(true); setError(''); setNotice(''); try { await reopenSalesQuoteTranslation(rfqId, items); setNotice('編集を再開しました。修正後に明細を再度確定してください。') } catch (cause) { setError(cause instanceof Error ? cause.message : '編集を再開できませんでした。') } finally { setBusy(false) } }
  async function confirm() { setBusy(true); setError(''); try { await confirmSalesQuoteTranslation(rfqId, items); setNotice('販売見積明細を確定しました。以後、RFQの原文・英訳を変更してもこの見積は更新されません。') } catch (cause) { setError(cause instanceof Error ? cause.message : '確定できませんでした。') } finally { setBusy(false) } }
  return <><Paper sx={{ p: 3, mt: 3 }}><Stack spacing={2}><Box><Typography component="h2" variant="h6">販売見積明細（翻訳確認）</Typography><Typography variant="body2" color="text.secondary">原文・英訳・見積用出力文を別々に保持します。品番、数量、単位、金額は翻訳・変更しません。</Typography></Box>
    {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {!quote && <Button variant="contained" disabled={busy} onClick={() => void prepare()}>{busy ? '取り込み中…' : 'RFQ品目を販売見積へ取り込む'}</Button>}
    {quote && <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}><Alert severity={confirmed ? 'success' : 'info'} sx={{ flex: 1 }}>{confirmed ? '確定済み。編集の再開またはRFQ品目の再取り込みができます。' : '下書き：各明細を確認・修正してから確定してください。'}</Alert>{confirmed && <Button variant="outlined" disabled={busy} onClick={() => void reopen()}>編集を再開</Button>}<Button variant="outlined" disabled={busy} onClick={() => setConfirmReimport(true)}>RFQ品目を再取り込み</Button>{!confirmed && <Button variant="contained" disabled={busy || items.length === 0} onClick={() => void confirm()}>{busy ? '確定中…' : '明細を確定'}</Button>}</Stack>}
    {quote && <Table size="small"><TableHead><TableRow><TableCell>品番・数量</TableCell><TableCell>原文</TableCell><TableCell>登録済み英訳</TableCell><TableCell>見積用出力文</TableCell><TableCell>状態</TableCell></TableRow></TableHead><TableBody>{items.map(item => <TableRow key={item.id}><TableCell>{item.partNumber || '—'}<br />{item.quantity} {item.unit}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 240 }}>{item.originalDescription}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 240 }}>{item.translatedDescription || <Typography color="warning.main">未入力（補完が必要です）</Typography>}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 280 }}>{item.outputDescription || <Typography color="warning.main">未入力</Typography>}</TableCell><TableCell>{confirmed ? '確定済み' : <Button size="small" onClick={() => setEditing(item)}>確認・修正</Button>}</TableCell></TableRow>)}{items.length === 0 && <TableRow><TableCell colSpan={5}>明細を読み込み中です。</TableCell></TableRow>}</TableBody></Table>}
  </Stack>{editing && <EditDialog item={editing} close={() => setEditing(null)} saved={output => updateSalesQuoteOutput(rfqId, editing.id, output)} />}{confirmReimport && <Dialog open onClose={busy ? undefined : () => setConfirmReimport(false)}><DialogTitle>RFQ品目を再取り込み</DialogTitle><DialogContent><Typography>RFQの最新の原文・英訳・数量で明細を作り直します。現在の見積用出力文の修正内容は上書きされ、確定状態も下書きに戻ります。</Typography></DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirmReimport(false)}>キャンセル</Button><Button variant="contained" disabled={busy} onClick={() => { setConfirmReimport(false); void prepare() }}>再取り込み</Button></DialogActions></Dialog>}</Paper>{confirmed && items.length > 0 && <FreeeQuotationSection key={rfqId} rfqId={rfqId} items={items} rfqItems={rfqItems} />}</>
}
