import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FreeeQuotationSection } from './FreeeQuotationSection'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Radio, RadioGroup, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import type { FreeeConnectionStatus } from '../freee/useFreeeConnectionStatus'
import { subscribeRfqItems, type RfqItem } from '../rfqs/rfqItemRepository'
import { getMissingQuoteOutputs, isImportableRfqItem, salesQuoteLineLabel, salesQuoteWriteError } from './salesQuotePreparation'
import { prepareSalesQuoteTranslation, setSalesQuoteConfirmation, startSalesQuoteRevision, subscribeSalesQuoteExportState, subscribeSalesQuote, subscribeSalesQuoteItems, updateSalesQuoteOutput, type SalesQuoteExportState, type SalesQuoteTranslation, type SalesQuoteTranslationItem } from './salesQuoteTranslationRepository'

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

function RevisionDialog({ source, close, save }: { source: SalesQuoteExportState; close: () => void; save: (presented: boolean) => Promise<void> }) {
  const choosesMode = source.status === 'sent' || !!source.updateTarget
  const [presented, setPresented] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const result = source.result ?? source.previousResult
  async function start() {
    setBusy(true); setError('')
    try { await save(presented === 'yes'); close() } catch (cause) { setError(cause instanceof Error ? cause.message : '編集を開始できませんでした。') } finally { setBusy(false) }
  }
  return <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : close}><DialogTitle>改訂版を作成して編集</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
    {error && <Alert severity="error">{error}</Alert>}
    <Typography>保存版 {source.revision} の明細・価格を引き継ぎます。過去の保存内容と転記履歴は保持します。</Typography>
    {result && <Typography>前回のfreee見積書：{result.number || '番号未取得'}（ID：{result.id}）</Typography>}
    {choosesMode ? <><Typography>この見積を顧客へ提示しましたか。別途メールやPDFで渡した場合も「提示済み」を選択してください。</Typography>
      <RadioGroup value={presented} onChange={event => setPresented(event.target.value)}>
        <FormControlLabel disabled={busy} value="no" control={<Radio />} label="未提示：同じfreee見積書を上書き更新する" />
        <FormControlLabel disabled={busy} value="yes" control={<Radio />} label="提示済み：旧見積を残し、改訂見積を新規作成する" />
      </RadioGroup>
      {presented && <Alert severity="info">{presented === 'no' ? '次回の転記は同じ見積書IDを更新します。freeeの見積書は増えません。' : '次回の転記では新しい見積書が1件増えます。案件番号は変わりません。'}</Alert>}
    </> : <Alert severity="info">{source.operation === 'create' && result ? '改訂見積はfreeeに新規作成します。旧見積は保持します。' : 'まだfreeeへの転記は完了していません。修正後に新しい保存版を作成してください。'}</Alert>}
  </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={close}>キャンセル</Button><Button variant="contained" disabled={busy || (choosesMode && !presented)} onClick={() => void start()}>{busy ? '開始中…' : '編集を開始'}</Button></DialogActions></Dialog>
}

export function SalesQuoteTranslationSection({ rfqId, freeeStatus = 'checking' }: { rfqId: string; freeeStatus?: FreeeConnectionStatus }) {
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([]), [quote, setQuote] = useState<SalesQuoteTranslation | null>(null), [items, setItems] = useState<SalesQuoteTranslationItem[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState<SalesQuoteTranslationItem | null>(null), [confirmReimport, setConfirmReimport] = useState(false)
  const [exportState, setExportState] = useState<SalesQuoteExportState | null>(null), [exportLoaded, setExportLoaded] = useState(false), [revisionSource, setRevisionSource] = useState<SalesQuoteExportState | null>(null)
  const [rfqItemsLoaded, setRfqItemsLoaded] = useState(false)
  const [quoteLoaded, setQuoteLoaded] = useState(false)
  const [itemsLoaded, setItemsLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [importState, setImportState] = useState<'idle' | 'attempted' | 'failed'>('idle')
  useEffect(() => subscribeRfqItems(rfqId, value => { setRfqItems(value); setRfqItemsLoaded(true) }, () => setLoadError('RFQ品目')), [rfqId])
  useEffect(() => subscribeSalesQuote(rfqId, value => { setQuote(value); setQuoteLoaded(true) }, () => setLoadError('販売見積')), [rfqId])
  useEffect(() => subscribeSalesQuoteItems(rfqId, value => { setItems(value); setItemsLoaded(true) }, () => setLoadError('販売見積明細')), [rfqId])
  useEffect(() => subscribeSalesQuoteExportState(rfqId, value => { setExportState(value); setExportLoaded(true) }, () => setLoadError('販売見積の保存状態')), [rfqId])
  const confirmed = quote?.status === 'confirmed'
  const blocked = !!exportState && ['sending', 'uncertain'].includes(exportState.status)
  const loading = !rfqItemsLoaded || !quoteLoaded || !itemsLoaded || !exportLoaded
  const canReimport = !loadError && !loading && (!exportState || (exportState.editing && exportState.status === 'draft'))
  const needsRevision = !!exportState && !exportState.editing
  const missingOutputs = quote && !confirmed ? getMissingQuoteOutputs(items) : []
  const importChecked = importState !== 'idle'
  const untranslatedSource = importState === 'failed'
    ? rfqItems.filter(item => isImportableRfqItem(item) && !item.translatedDescription.trim())
    : []
  async function prepare() {
    if (!canReimport) return
    setBusy(true)
    setError('')
    setNotice('')
    setImportState('attempted')
    try {
      await prepareSalesQuoteTranslation(rfqId, quote ? items : null)
      setNotice('RFQ品目の最新内容を販売見積明細へ取り込みました。')
    } catch (cause) {
      setImportState('failed')
      setError(salesQuoteWriteError(cause, '取り込み'))
    } finally {
      setBusy(false)
    }
  }
  async function reopen() { setBusy(true); setError(''); setNotice(''); try { await setSalesQuoteConfirmation(rfqId, items, false); setNotice('編集を再開しました。修正後に明細を再度確定してください。') } catch (cause) { setError(salesQuoteWriteError(cause, '編集の再開')) } finally { setBusy(false) } }
  async function confirm() { setBusy(true); setError(''); setNotice(''); setNotice(''); try { await setSalesQuoteConfirmation(rfqId, items, true); setNotice('販売見積明細を確定しました。以後、RFQの原文・英訳を変更してもこの見積は更新されません。') } catch (cause) { setError(salesQuoteWriteError(cause, '明細の確定')) } finally { setBusy(false) } }
  async function startRevision(source: SalesQuoteExportState, presented: boolean) { setError(''); setNotice(''); await startSalesQuoteRevision(rfqId, source, presented); setNotice('改訂版の編集を開始しました。修正後に明細を再度確定してください。') }
  return <><Paper sx={{ p: 3, mt: 3 }}><Stack spacing={2}><Box><Typography component="h2" variant="h6">販売見積明細（翻訳確認）</Typography><Typography variant="body2" color="text.secondary">原文・英訳・見積用出力文を別々に保持します。品番、数量、単位、金額は翻訳・変更しません。</Typography></Box>
    {loadError && <Alert severity="error">{loadError}を読み込めませんでした。通信状況を確認してページを再読み込みしてください。</Alert>}
    {error && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {!quote && <Button variant="contained" disabled={busy || !canReimport} onClick={() => void prepare()}>{busy ? '取り込み中…' : loading && !loadError ? '取り込みに必要な情報を読み込み中…' : 'RFQ品目を販売見積へ取り込む'}</Button>}
    {untranslatedSource.length > 0 && <Alert severity="info">
      次の行は翻訳説明が空欄です。英訳を使う場合は「選択して一括翻訳」を実行してください。
      <Box component="ul" sx={{ my: 1, pl: 3 }}>{untranslatedSource.map(item => <li key={item.id}>{salesQuoteLineLabel(item)}</li>)}</Box>
    </Alert>}
    {missingOutputs.length > 0 && <Alert severity="warning">
      明細の確定には、各行の「見積用の出力文」が必要です。次の行は「確認・修正」から入力して保存してください。RFQ側で英訳する場合は「選択して一括翻訳」を実行してから「RFQ品目を再取り込み」を押してください。
      <Box component="ul" sx={{ my: 1, pl: 3 }}>{missingOutputs.map(item => <li key={item.id}>{salesQuoteLineLabel(item)}：{!item.translatedDescription.trim() && '登録済み英訳が未入力。'}見積用の出力文が未入力。</li>)}</Box>
    </Alert>}
    {importChecked && freeeStatus === 'disconnected' && <Alert severity="warning" action={<Button component={Link} to="/integrations/freee" color="inherit" size="small">freee連携を開く</Button>}>
      freeeへの転記には連携が必要です。未連携・認証期限切れなどで接続できないため、「freee連携」で認可してください。明細の取り込みと確定は先に進められます。
    </Alert>}
    {importChecked && freeeStatus === 'unavailable' && <Alert severity="info" action={<Button component={Link} to="/integrations/freee" color="inherit" size="small">freee連携を開く</Button>}>
      freeeの連携状態を確認できませんでした。転記の前に「freee連携」で状態を確認してください。
    </Alert>}
    {quote && <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}><Alert severity={blocked ? 'warning' : confirmed ? 'success' : 'info'} sx={{ flex: 1 }}>{blocked ? '送信中・結果不明のため編集できません。下のfreee転記欄で結果を確認・照合してください。' : confirmed ? needsRevision ? '確定済み。修正は「改訂版を作成して編集」から開始します。' : '確定済み。編集の再開またはRFQ品目の再取り込みができます。' : '下書き：各明細を確認・修正してから確定してください。'}</Alert>{confirmed && <Button variant="outlined" disabled={busy || blocked || !exportLoaded} onClick={() => { if (needsRevision && exportState) setRevisionSource(exportState); else void reopen() }}>{needsRevision ? '改訂版を作成して編集' : '編集を再開'}</Button>}<Button variant="outlined" disabled={busy || !canReimport} onClick={() => setConfirmReimport(true)}>RFQ品目を再取り込み</Button>{!confirmed && <Button variant="contained" disabled={busy || blocked || Boolean(loadError) || !itemsLoaded || !exportLoaded || items.length === 0 || missingOutputs.length > 0} onClick={() => void confirm()}>{busy ? '確定中…' : '明細を確定'}</Button>}</Stack>}
    {exportState?.editing && <Alert severity="info">改訂中です。明細を再確定し、販売見積を保存してからfreeeへ反映してください。{exportState.updateTarget ? `同じfreee見積書（ID：${exportState.updateTarget.id}）を上書き更新します。` : exportState.previousResult ? '旧見積を残し、改訂見積を新規作成します。' : ''}数量・品番・品目の追加／削除はRFQ品目を編集してから「RFQ品目を再取り込み」で反映できます。</Alert>}
    {quote && <Table size="small"><TableHead><TableRow><TableCell>品番・数量</TableCell><TableCell>原文</TableCell><TableCell>登録済み英訳</TableCell><TableCell>見積用出力文</TableCell><TableCell>状態</TableCell></TableRow></TableHead><TableBody>{items.map(item => <TableRow key={item.id}><TableCell>{item.partNumber || '—'}<br />{item.quantity} {item.unit}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 240 }}>{item.originalDescription}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 240 }}>{item.translatedDescription || <Typography color="warning.main">未入力（補完が必要です）</Typography>}</TableCell><TableCell sx={{ whiteSpace: 'pre-wrap', maxWidth: 280 }}>{item.outputDescription || <Typography color="warning.main">未入力</Typography>}</TableCell><TableCell>{confirmed ? '確定済み' : <Button size="small" onClick={() => setEditing(item)}>確認・修正</Button>}</TableCell></TableRow>)}{items.length === 0 && <TableRow><TableCell colSpan={5}>明細を読み込み中です。</TableCell></TableRow>}</TableBody></Table>}
  </Stack>{revisionSource && <RevisionDialog source={revisionSource} close={() => setRevisionSource(null)} save={presented => startRevision(revisionSource, presented)} />}{editing && <EditDialog item={editing} close={() => setEditing(null)} saved={output => updateSalesQuoteOutput(rfqId, editing.id, output)} />}{confirmReimport && <Dialog open onClose={busy ? undefined : () => setConfirmReimport(false)}><DialogTitle>RFQ品目を再取り込み</DialogTitle><DialogContent><Typography>RFQの最新の原文・英訳・数量で明細を作り直します。現在の見積用出力文の修正内容は上書きされ、確定状態も下書きに戻ります。</Typography></DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirmReimport(false)}>キャンセル</Button><Button variant="contained" disabled={busy} onClick={() => { setConfirmReimport(false); void prepare() }}>再取り込み</Button></DialogActions></Dialog>}</Paper>{confirmed && items.length > 0 && <FreeeQuotationSection key={rfqId} rfqId={rfqId} items={items} rfqItems={rfqItems} />}</>
}
