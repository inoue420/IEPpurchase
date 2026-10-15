import { alignSalesQuotePrices, recalculateSalesQuoteSettings, salesQuoteSettingsEqual, syncSalesQuotePurchaseAmounts } from './salesQuoteSettingsEqual'
import { useEffect, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Timestamp, collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, firebaseFunctions } from '../../firebase/firebase'
import { calculateSalesUnitPrice, freeeDescription, hasUnsupportedFreeeDescription, buildQuotePreview, parseQuoteSettings, type QuotePreview, type QuoteSettings } from '../../../functions/src/salesQuoteModel'
import type { SalesQuoteTranslationItem } from './salesQuoteTranslationRepository'
import type { RfqItem } from '../rfqs/rfqItemRepository'
import { FreeePartnerPicker, type SelectedFreeePartner } from './FreeePartnerPicker'
import { subscribeRfq } from '../rfqs/rfqRepository'
import type { DeliveryLocationSelection } from '../../../functions/src/deliveryLocationModel'

interface SavedQuote {
  partnerName?: string
  revision: number; digest: string; companyId: number; customerName: string; marker: string
  payload?: { memo: string }
  status: 'draft' | 'sending' | 'failed' | 'uncertain' | 'sent'; preview: QuotePreview; error: string
  result: { id: number; number: string; reportUrl: string; total: number | null; tax: number | null; verification: 'matched' | 'needs_review' } | null
  editing?: boolean; operation?: 'create' | 'update'; updateTarget?: { id: number; number: string } | null
  previousResult?: SavedQuote['result']; customerPresented?: boolean
}
interface History { id: string; action: string; revision: number; userId: string; createdAt: Timestamp | null; message: string; operation?: 'create' | 'update'; result?: SavedQuote['result']; previousResult?: SavedQuote['result'] }
const yen = (value: number) => `${value.toLocaleString('ja-JP')} 円`
const fractionLabels = { omit: '切り捨て', round: '四捨五入', round_up: '切り上げ' }
const statusLabels = { draft: '下書き', sending: '転記中・結果確認待ち', failed: '反映未完了（再試行可能）', uncertain: '結果不明（再転記停止）', sent: '転記済み' }
const actionLabels: Record<string, string> = { saved: '販売見積保存', revision_started: '改訂の編集開始', sending: '転記開始', failed: '転記拒否', uncertain: '結果不明', sent: '転記成功', reconciled: '転記結果を照合' }
function usesLegacyMemo(saved: SavedQuote): boolean {
  return (saved.payload?.memo ?? saved.marker) === saved.marker
}
function settingsForEditing(saved: SavedQuote): QuoteSettings {
  const settings = ['draft', 'failed'].includes(saved.status) ? recalculateSalesQuoteSettings(saved.preview.settings) : saved.preview.settings
  return saved.editing && saved.operation === 'create' && saved.previousResult ? { ...settings, quotationNumber: '' } : settings
}
function purchaseAmount(item: RfqItem | undefined): string {
  const selected = item?.ecPurchaseCandidates.filter(candidate => candidate.purchasePlanned) ?? []
  return selected.length ? String(selected.reduce((sum, candidate) => sum + candidate.price, 0)) : ''
}
function defaults(items: SalesQuoteTranslationItem[], rfqItems: RfqItem[]): QuoteSettings {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  return { partnerId: '', quotationDate: today, expirationDate: '', subject: '', quotationNumber: '', partnerTitle: '御中', taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: false,
    prices: items.map(item => { const purchase = purchaseAmount(rfqItems.find(rfqItem => rfqItem.id === item.id)), margin = '1.2'; return { rfqItemId: item.id, purchaseAmount: purchase, shippingFee: '', margin, unitPrice: calculateSalesUnitPrice(purchase, '', margin), taxRate: 10, reducedTaxRate: false } }) }
}
function Preview({ preview, memo }: { preview: QuotePreview; memo?: string }) {
  const s = preview.settings
  return <Stack spacing={1}>
    <Typography>件名：{s.subject} ／ 見積日：{s.quotationDate} ／ 有効期限：{s.expirationDate || '指定なし'}</Typography>
    <Typography>freee取引先ID：{s.partnerId} ／ 敬称：{s.partnerTitle} ／ 見積書番号：{s.quotationNumber || 'freeeで自動採番'}</Typography>
    <Typography>納品場所：{s.deliveryLocationName || '未指定'}</Typography>
    <Typography variant="body2">JPY・{s.taxEntryMethod === 'out' ? '税別' : '税込'}単価 ／ 明細金額：{fractionLabels[s.lineAmountFraction]} ／ 税率ごとの消費税：{fractionLabels[s.taxFraction]}</Typography>
    {preview.warnings.map(warning => <Alert key={warning} severity="warning">{warning} 利用者による確認済みです。</Alert>)}
    <TableContainer><Table size="small"><TableHead><TableRow><TableCell>freee摘要（メーカー名＋品番＋確定出力文）</TableCell><TableCell>数量</TableCell><TableCell>販売単価</TableCell><TableCell>税率</TableCell><TableCell>明細金額</TableCell></TableRow></TableHead><TableBody>
      {preview.lines.map(line => <TableRow key={line.rfqItemId}><TableCell sx={{ whiteSpace: 'pre-wrap', minWidth: 240 }}>{line.description}</TableCell><TableCell>{line.quantity} {line.unit}</TableCell><TableCell>{line.unitPrice} 円</TableCell><TableCell>{line.taxRate}%{line.reducedTaxRate ? '（軽減）' : ''}</TableCell><TableCell>{yen(line.amount)}</TableCell></TableRow>)}
    </TableBody></Table></TableContainer>
    <Typography fontWeight="bold">税抜小計：{yen(preview.subtotal)} ／ 消費税：{yen(preview.tax)} ／ 合計：{yen(preview.total)}</Typography>
    {s.note && <Typography sx={{ whiteSpace: 'pre-wrap' }}>備考：{s.note}</Typography>}
    {memo && <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>freee社内メモ：<br />{memo}</Typography>}
  </Stack>
}
type DisplayItem = SalesQuoteTranslationItem & { manufacturerName: string }
function Editor({ rfqId, items, rfqItems, saved, deliveryLocation }: { rfqId: string; items: DisplayItem[]; rfqItems: RfqItem[]; saved: SavedQuote | null; deliveryLocation: DeliveryLocationSelection }) {
  const initialSettings = () => saved ? alignSalesQuotePrices(settingsForEditing(saved), defaults(items, rfqItems)) : defaults(items, rfqItems)
  const [settings, setSettings] = useState<QuoteSettings>(initialSettings)
  const currentSettings = { ...settings, ...deliveryLocation }
  const [baseRevision, setBaseRevision] = useState(saved?.revision ?? 0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirming, setConfirming] = useState<SavedQuote | null>(null)
  const [quotationId, setQuotationId] = useState('')
  const [memoRefreshUnavailable, setMemoRefreshUnavailable] = useState(false)
  const [partner, setPartner] = useState<SelectedFreeePartner | null>(() => saved?.partnerName ? { id: Number(saved.preview.settings.partnerId), name: saved.partnerName, companyId: saved.companyId } : null)
  // Firestore arrives after the editor has mounted. Start an existing draft from
  // that saved version instead of the empty defaults, so it can be revised.
  useEffect(() => {
    if (!saved || baseRevision !== 0) return
    setSettings(alignSalesQuotePrices(settingsForEditing(saved), defaults(items, rfqItems)))
    setBaseRevision(saved.revision)
    setPartner(saved.partnerName ? { id: Number(saved.preview.settings.partnerId), name: saved.partnerName, companyId: saved.companyId } : null)
  }, [baseRevision, saved, items, rfqItems])
  const purchaseSignature = items.map(item => `${item.id}:${purchaseAmount(rfqItems.find(rfqItem => rfqItem.id === item.id))}`).join('|')
  useEffect(() => {
    setSettings(previous => syncSalesQuotePurchaseAmounts(previous, new Map(rfqItems.map(item => [item.id, purchaseAmount(item)]))))
  }, [purchaseSignature, rfqItems])
  const locked = !!saved && !['draft', 'failed'].includes(saved.status)
  const updating = saved?.operation === 'update'
  const stale = (saved?.revision ?? 0) !== baseRevision
  const needsDescriptionResave = !!saved?.preview.lines.some(line => hasUnsupportedFreeeDescription(line.description))
  const hasLegacyMemo = !!saved && usesLegacyMemo(saved)
  let localPreview: QuotePreview | null = null, validation = ''
  try { localPreview = buildQuotePreview(parseQuoteSettings(currentSettings), items) } catch (cause) { validation = cause instanceof Error ? cause.message : '入力を確認してください。' }
  const sourceChanged = !!saved && !!localPreview && (localPreview.lines.length !== saved.preview.lines.length || localPreview.lines.some(line => {
    const previous = saved.preview.lines.find(value => value.rfqItemId === line.rfqItemId)
    return !previous || ['lineNo', 'partNumber', 'quantity', 'unit', 'manufacturerName', 'originalDescription', 'translatedDescription', 'outputDescription'].some(key => line[key as keyof typeof line] !== previous[key as keyof typeof previous])
  }))
  const dirty = !!saved?.editing || needsDescriptionResave || sourceChanged || !saved || !salesQuoteSettingsEqual(currentSettings, saved.preview.settings) || partner?.name !== saved.partnerName || (!!partner && partner.companyId !== saved.companyId)
  // Memo refresh is optional. An older server returning its saved legacy memo
  // must not turn an otherwise saved quote into an endless save/send blocker.
  const canRefreshMemo = hasLegacyMemo && !memoRefreshUnavailable
  function update<K extends keyof QuoteSettings>(key: K, value: QuoteSettings[K]) { setSettings(previous => ({ ...previous, [key]: value })) }
  async function save() {
    if (!partner) { setError('freee取引先を名前で選択してください。'); return }
    setBusy(true); setError('')
    try {
      const call = httpsCallable<unknown, SavedQuote>(firebaseFunctions, 'saveSalesQuotePricing')
      const { data } = await call({ rfqId, settings: currentSettings, expectedRevision: baseRevision, partnerCompanyId: partner.companyId })
      setSettings(data.preview.settings); setBaseRevision(data.revision)
      setMemoRefreshUnavailable(usesLegacyMemo(data))
      setPartner({ id: Number(data.preview.settings.partnerId), name: data.partnerName ?? partner.name, companyId: data.companyId })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。') } finally { setBusy(false) }
  }
  async function send() {
    if (!confirming) return
    setBusy(true); setError('')
    try {
      const call = httpsCallable<unknown, { error?: string }>(firebaseFunctions, 'sendFreeeQuotation', { timeout: 70_000 })
      const { data } = await call({ rfqId, revision: confirming.revision, digest: confirming.digest, confirm: true })
      if (data.error) setError(data.error)
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : '送信結果を確認できませんでした。'} 保存状態と履歴を確認してください。`) }
    finally { setConfirming(null); setBusy(false) }
  }
  async function reconcile() {
    setBusy(true); setError('')
    try {
      await httpsCallable(firebaseFunctions, 'reconcileFreeeQuotation', { timeout: 70_000 })({ rfqId, quotationId: Number(quotationId) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '照合できませんでした。') } finally { setBusy(false) }
  }
  return <Stack spacing={2}>
    {error && <Alert severity="error">{error}</Alert>}
    {saved && <Alert severity={saved.status === 'sent' ? 'success' : saved.status === 'draft' ? 'info' : 'warning'}>保存版 {saved.revision}：{statusLabels[saved.status]} ／ 接続事業所ID：{saved.companyId} ／ 顧客：{saved.customerName}</Alert>}
    {saved && !locked && <Alert severity="info">{updating ? `次回は同じfreee見積書（ID：${saved.updateTarget?.id} ／ 番号：${saved.updateTarget?.number || '—'}）を上書き更新します。見積書は増えません。` : saved.previousResult ? '次回は改訂見積を新規作成します。旧見積は保持し、見積書が1件増えます。' : '次回はfreeeに見積書を新規作成します。'}</Alert>}
    {!locked && <>
      {stale && <Alert severity="warning" action={<Button disabled={busy} onClick={() => { if (saved) { setSettings(settingsForEditing(saved)); setBaseRevision(saved.revision); setPartner(saved.partnerName ? { id: Number(saved.preview.settings.partnerId), name: saved.partnerName, companyId: saved.companyId } : null) } }}>保存済みを読み直す</Button>}>保存版が更新されています。入力内容を確認してから読み直してください。</Alert>}
      <Box component="fieldset" disabled={busy || stale} sx={{ border: 0, p: 0, m: 0 }}><Stack spacing={2}>
        <TextField label="納品場所（RFQから反映）" value={deliveryLocation.deliveryLocationName} slotProps={{ htmlInput: { readOnly: true } }} helperText="変更する場合はRFQ詳細上部の納品場所を保存してください。この販売見積を保存すると、freeeの納品場所へ反映する値が確定します。" />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <FreeePartnerPicker value={partner} disabled={busy || stale || (updating && !!partner)} onChange={selected => { setPartner(selected); update('partnerId', String(selected.id)) }} />
          <TextField required label="件名" value={settings.subject} onChange={e => update('subject', e.target.value)} sx={{ flex: 1 }} />
          <TextField select label="敬称" value={settings.partnerTitle} onChange={e => update('partnerTitle', e.target.value as QuoteSettings['partnerTitle'])}>{['御中', '様', '(空白)'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField required label="見積日" type="date" slotProps={{ inputLabel: { shrink: true } }} value={settings.quotationDate} onChange={e => update('quotationDate', e.target.value)} />
          <TextField label="有効期限" type="date" slotProps={{ inputLabel: { shrink: true } }} value={settings.expirationDate} onChange={e => update('expirationDate', e.target.value)} />
          <TextField label="見積書番号" value={settings.quotationNumber} onChange={e => update('quotationNumber', e.target.value)} slotProps={{ htmlInput: { readOnly: updating } }} helperText={updating ? '同じfreee見積書番号を保持します' : 'freeeが自動採番なら空欄、手動採番なら新しい番号を入力'} />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select label="単価の税区分" value={settings.taxEntryMethod} onChange={e => update('taxEntryMethod', e.target.value as QuoteSettings['taxEntryMethod'])}><MenuItem value="out">税別（外税）</MenuItem><MenuItem value="in">税込（内税）</MenuItem></TextField>
          {(['lineAmountFraction', 'taxFraction'] as const).map(key => <TextField key={key} select label={key === 'taxFraction' ? '消費税の端数処理' : '明細金額の端数処理'} value={settings[key]} onChange={e => update(key, e.target.value as QuoteSettings[typeof key])}>{Object.entries(fractionLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>)}
        </Stack>
        <Typography variant="body2">販売単価＝（購入金額＋送料）÷（2−マージン）、100円単位で四捨五入。マージンは0より大きく2未満で入力してください。</Typography>
        <TableContainer><Table size="small"><TableHead><TableRow><TableCell>確定明細</TableCell><TableCell>数量</TableCell><TableCell>購入金額（円）</TableCell><TableCell>送料（円）</TableCell><TableCell>マージン</TableCell><TableCell>販売単価（円）</TableCell><TableCell>税率</TableCell></TableRow></TableHead><TableBody>{items.map(item => {
          const price = settings.prices.find(p => p.rfqItemId === item.id)
          const changePrice = (change: Partial<QuoteSettings['prices'][number]>) => update('prices', settings.prices.map(p => p.rfqItemId === item.id ? { ...p, ...change } : p))
          const changeCost = (change: Partial<Pick<QuoteSettings['prices'][number], 'purchaseAmount' | 'shippingFee' | 'margin'>>) => { if (!price) return; const next = { ...price, ...change }; changePrice({ ...change, unitPrice: calculateSalesUnitPrice(next.purchaseAmount, next.shippingFee, next.margin) }) }
          return <TableRow key={item.id}><TableCell sx={{ minWidth: 220, whiteSpace: 'pre-wrap' }}>{item.manufacturerName && <>{item.manufacturerName}<br /></>}{item.partNumber}<br />{item.outputDescription}<Typography variant="caption" display="block">摘要 {Array.from(freeeDescription(item.manufacturerName, item.partNumber, item.outputDescription)).length}/255文字</Typography>{!item.translatedDescription.trim() && <Typography color="warning.main" variant="caption">登録英訳なし：出力文の確認が必要</Typography>}</TableCell><TableCell>{item.quantity} {item.unit}</TableCell><TableCell><TextField size="small" value={price?.purchaseAmount ?? ''} placeholder="未選択" onChange={e => changeCost({ purchaseAmount: e.target.value })} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `明細${item.lineNo}の購入金額` } }} helperText="購入予定候補から自動転記" /></TableCell><TableCell><TextField size="small" value={price?.shippingFee ?? ''} placeholder="未記載" onChange={e => changeCost({ shippingFee: e.target.value })} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `明細${item.lineNo}の送料` } }} /></TableCell><TableCell><TextField required size="small" value={price?.margin ?? '1.2'} onChange={e => changeCost({ margin: e.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `明細${item.lineNo}のマージン` } }} /></TableCell><TableCell><TextField required size="small" value={price?.unitPrice ?? ''} slotProps={{ htmlInput: { readOnly: true, 'aria-label': `明細${item.lineNo}の販売単価` } }} helperText="100円単位" /></TableCell><TableCell><TextField select size="small" value={price?.reducedTaxRate ? '8r' : String(price?.taxRate ?? 10)} onChange={e => changePrice({ taxRate: e.target.value === '8r' ? 8 : Number(e.target.value) as 0 | 8 | 10, reducedTaxRate: e.target.value === '8r' })} slotProps={{ htmlInput: { 'aria-label': `明細${item.lineNo}の税率` } }}><MenuItem value="10">10%</MenuItem><MenuItem value="8r">8%（軽減）</MenuItem><MenuItem value="8">8%</MenuItem><MenuItem value="0">0%</MenuItem></TextField></TableCell></TableRow>
        })}</TableBody></Table></TableContainer>
        <TextField label="見積書備考" multiline minRows={2} value={settings.note} onChange={e => update('note', e.target.value)} />
        <FormControlLabel control={<Checkbox checked={settings.translationsReviewed} onChange={e => update('translationsReviewed', e.target.checked)} />} label="登録英訳が未入力、または日本語を含む明細も、出力文が顧客向けとして適切なことを確認しました" />
      </Stack></Box>
      {validation && <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>{validation}</Alert>}
      {localPreview && <><Typography component="h3" variant="subtitle1">入力中のプレビュー</Typography><Preview preview={localPreview} /></>}
      <Button variant="outlined" disabled={busy || stale || !localPreview || (!dirty && !canRefreshMemo) || !partner} onClick={() => void save()}>{busy ? '処理中…' : '販売見積を保存'}</Button>
    </>}
    {saved && <>
      <Typography>freee取引先：{saved.partnerName ?? '未確認：名前で選択して保存し直してください'}</Typography>
      <Typography component="h3" variant="subtitle1">保存済みの送信内容（版 {saved.revision}）</Typography><Preview preview={saved.preview} memo={saved.payload?.memo ?? saved.marker} />
      {!locked && !busy && !stale && (!partner || dirty) && <Alert severity="info">{needsDescriptionResave ? '摘要の改行をスペースに変換します。入力中のプレビューを確認し、「販売見積を保存」で新しい版を作成してください。' : !partner ? 'freee取引先を選択して、販売見積を保存してください。' : '未保存の変更があります。「販売見積を保存」してから登録内容を確認してください。'}</Alert>}
      {!locked && hasLegacyMemo && <Alert severity={memoRefreshUnavailable ? 'warning' : 'info'}>{memoRefreshUnavailable ? '見積は保存済みです。案件リンク・案件番号への変更は接続先にまだ反映されていません。転記確認画面には、今回送る旧形式の社内メモを表示します。' : '社内メモは旧形式です。「販売見積を保存」で案件リンク・案件番号への更新を試せます。見積内容が保存済みなら、表示中の社内メモで転記確認へ進めます。'}</Alert>}
      {saved.status === 'draft' && <Alert severity="info">この版はIEPpurchase内に保存済みです。freeeへの反映は、確認画面で実行した後に完了します。</Alert>}
      {saved.error && <Alert severity="warning">保存版 {saved.revision} はfreeeへの反映が完了していません。{saved.error}</Alert>}
      {!locked && <Button variant="contained" disabled={busy || dirty || stale || !partner} onClick={() => setConfirming(saved)}>{saved.status === 'failed' ? 'freeeへの再試行内容を確認' : updating ? 'freeeへの上書き内容を確認' : 'freeeへの登録内容を確認'}</Button>}
      {saved.result && <Alert severity={saved.result.verification === 'matched' ? 'success' : 'warning'}>freee見積書ID：{saved.result.id} ／ 番号：{saved.result.number || '—'} ／ freee合計：{saved.result.total === null ? '未取得' : yen(saved.result.total)}<br />{saved.result.verification === 'matched' ? '明細・金額は送信内容と一致しました。' : 'freeeの応答と送信内容に差異または未取得項目があります。帳票を確認してください。再作成は行いません。'}{saved.result.reportUrl && <><br /><Link href={saved.result.reportUrl} target="_blank" rel="noopener noreferrer">freee見積書を開く</Link></>}</Alert>}
      {saved.previousResult && saved.previousResult.id !== saved.result?.id && <Alert severity="info">前回反映済みのfreee見積書：{saved.previousResult.number || `ID ${saved.previousResult.id}`}。{updating ? '同じ見積書の現在の内容を確認できます。' : '改訂前の見積書です。'}{saved.previousResult.reportUrl && <><br /><Link href={saved.previousResult.reportUrl} target="_blank" rel="noopener noreferrer">前回のfreee見積書を開く</Link></>}</Alert>}
      {['sending', 'uncertain'].includes(saved.status) && <Stack spacing={1}><Alert severity="warning" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>2分以上経過しても結果が確定しない場合、freeeで見積書を確認してください。上の送信内容と社内メモ全体が一致する見積書のIDで照合します。見つからない場合は管理者による調査が必要です。</Alert><TextField label="作成済みfreee見積書ID" value={quotationId} onChange={e => setQuotationId(e.target.value)} /><Button disabled={busy || !/^[1-9]\d*$/.test(quotationId)} onClick={() => void reconcile()}>freeeの作成結果を照合</Button></Stack>}
    </>}
    <Dialog open={!!confirming} fullWidth maxWidth="lg" onClose={busy ? undefined : () => setConfirming(null)}><DialogTitle>{updating ? '同じfreee見積書を上書き更新します' : 'freee見積書を新規作成します'}</DialogTitle><DialogContent>{confirming && <Stack spacing={2}><Alert severity="warning">接続事業所ID {confirming.companyId} のfreeeに{updating ? `上書き更新します（見積書ID：${confirming.updateTarget?.id}）。見積書は増えません。` : '新規登録します。'}顧客「{confirming.customerName}」とfreee取引先「{confirming.partnerName}」（ID {confirming.preview.settings.partnerId}） の対応を確認してください。{updating && confirming.preview.settings.deliveryLocationName && '納品場所も下記の選択値で上書きします。'}</Alert><Preview preview={confirming.preview} memo={confirming.payload?.memo ?? confirming.marker} /><Typography>保存版 {confirming.revision} を転記します。顧客へのメール送付は行いません。</Typography></Stack>}</DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirming(null)}>キャンセル</Button><Button variant="contained" disabled={busy || confirming?.digest !== saved?.digest || dirty || locked} onClick={() => void send()}>{busy ? '転記中…' : updating ? '確認した内容でfreeeを上書き更新' : '確認した内容でfreeeに新規登録'}</Button></DialogActions></Dialog>
  </Stack>
}

export function FreeeQuotationSection({ rfqId, items, rfqItems }: { rfqId: string; items: SalesQuoteTranslationItem[]; rfqItems: RfqItem[] }) {
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocationSelection | null>(null)
  const [saved, setSaved] = useState<SavedQuote | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState('')
  const [events, setEvents] = useState<History[]>([]), [versions, setVersions] = useState<(SavedQuote & { id: string })[]>([]), [version, setVersion] = useState<SavedQuote | null>(null)
  useEffect(() => {
    const ref = doc(firestore, 'salesQuotes', rfqId, 'freeeExports', 'current')
    const fail = () => setError('販売見積の保存状態・履歴を取得できませんでした。接続とFirestore Rulesを確認して再読込してください。')
    const stop = onSnapshot(ref, snapshot => { setSaved(snapshot.exists() ? snapshot.data() as SavedQuote : null); setLoaded(true) }, fail)
    const stopEvents = onSnapshot(query(collection(ref, 'events'), orderBy('createdAt', 'desc'), limit(20)), snapshot => setEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as History))), fail)
    const stopVersions = onSnapshot(query(collection(ref, 'revisions'), orderBy('revision', 'desc'), limit(20)), snapshot => setVersions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SavedQuote & { id: string }))), fail)
    const stopRfq = subscribeRfq(rfqId, rfq => { if (!rfq) { fail(); return }; setDeliveryLocation({ deliveryLocationId: rfq.deliveryLocationId ?? '', deliveryLocationName: rfq.deliveryLocationName ?? '' }) }, fail)
    return () => { stop(); stopEvents(); stopVersions(); stopRfq() }
  }, [rfqId])
  return <Paper sx={{ p: 3, mt: 3 }}><Stack spacing={2}>
    <Typography component="h2" variant="h6">販売見積・freee転記</Typography>
    <Typography variant="body2">確定した品番・数量・出力文を使い、販売単価を設定します。JPY、小数3桁までの数量・単価、100明細まで対応します。</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {!loaded || !deliveryLocation ? <Typography>保存状態を読み込み中…</Typography> : !error && <Editor rfqId={rfqId} items={items.map(item => ({ ...item, manufacturerName: rfqItems.find(rfqItem => rfqItem.id === item.id)?.manufacturerName ?? '' }))} rfqItems={rfqItems} saved={saved} deliveryLocation={deliveryLocation} />}
    {versions.length > 0 && <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap"><Typography>保存履歴（最新20版）：</Typography>{versions.map(v => <Button key={v.id} size="small" onClick={() => setVersion(v)}>版 {v.revision}</Button>)}</Stack>}
    {events.length > 0 && <><Typography variant="subtitle1">操作・結果履歴（最新20件）</Typography>{events.map(event => <Typography key={event.id} variant="body2">{event.createdAt instanceof Timestamp ? event.createdAt.toDate().toLocaleString('ja-JP') : '記録中'} ／ 版 {event.revision} ／ {actionLabels[event.action] ?? event.action}{event.operation ? `（${event.operation === 'update' ? '上書き更新' : '新規作成'}）` : ''} ／ 操作者：{event.userId}{event.result && ` ／ freee見積書ID：${event.result.id} ／ 番号：${event.result.number || '—'}`}{event.previousResult && ` ／ 改訂元freee見積書ID：${event.previousResult.id}`}{event.message ? ` ／ ${event.message}` : ''}</Typography>)}</>}
  </Stack><Dialog open={!!version} fullWidth maxWidth="lg" onClose={() => setVersion(null)}><DialogTitle>保存版 {version?.revision}</DialogTitle><DialogContent>{version && <Preview preview={version.preview} memo={version.payload?.memo ?? version.marker} />}</DialogContent><DialogActions><Button onClick={() => setVersion(null)}>閉じる</Button></DialogActions></Dialog></Paper>
}
