import { salesQuoteSettingsEqual } from './salesQuoteSettingsEqual'
import { useEffect, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Timestamp, collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, firebaseFunctions } from '../../firebase/firebase'
import { freeeDescription, hasUnsupportedFreeeDescription, buildQuotePreview, parseQuoteSettings, type QuotePreview, type QuoteSettings } from '../../../functions/src/salesQuoteModel'
import type { SalesQuoteTranslationItem } from './salesQuoteTranslationRepository'
import { FreeePartnerPicker, type SelectedFreeePartner } from './FreeePartnerPicker'

interface SavedQuote {
  partnerName?: string
  revision: number; digest: string; companyId: number; customerName: string; marker: string
  status: 'draft' | 'sending' | 'failed' | 'uncertain' | 'sent'; preview: QuotePreview; error: string
  result: { id: number; number: string; reportUrl: string; total: number | null; tax: number | null; verification: 'matched' | 'needs_review' } | null
}
interface History { id: string; action: string; revision: number; userId: string; createdAt: Timestamp | null; message: string }
const yen = (value: number) => `${value.toLocaleString('ja-JP')} 円`
const fractionLabels = { omit: '切り捨て', round: '四捨五入', round_up: '切り上げ' }
const statusLabels = { draft: '下書き', sending: '送信中・結果確認待ち', failed: '登録拒否（再試行可能）', uncertain: '結果不明（再作成停止）', sent: '作成済み' }
const actionLabels: Record<string, string> = { saved: '販売見積保存', sending: '送信開始', failed: '登録拒否', uncertain: '結果不明', sent: '作成成功', reconciled: '作成結果を照合' }
function defaults(items: SalesQuoteTranslationItem[]): QuoteSettings {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  return { partnerId: '', quotationDate: today, expirationDate: '', subject: '', quotationNumber: '', partnerTitle: '御中', taxEntryMethod: 'out', taxFraction: 'omit', lineAmountFraction: 'omit', note: '', translationsReviewed: false,
    prices: items.map(item => ({ rfqItemId: item.id, unitPrice: '', taxRate: 10, reducedTaxRate: false })) }
}
function Preview({ preview }: { preview: QuotePreview }) {
  const s = preview.settings
  return <Stack spacing={1}>
    <Typography>件名：{s.subject} ／ 見積日：{s.quotationDate} ／ 有効期限：{s.expirationDate || '指定なし'}</Typography>
    <Typography>freee取引先ID：{s.partnerId} ／ 敬称：{s.partnerTitle} ／ 見積書番号：{s.quotationNumber || 'freeeで自動採番'}</Typography>
    <Typography variant="body2">JPY・{s.taxEntryMethod === 'out' ? '税別' : '税込'}単価 ／ 明細金額：{fractionLabels[s.lineAmountFraction]} ／ 税率ごとの消費税：{fractionLabels[s.taxFraction]}</Typography>
    {preview.warnings.map(warning => <Alert key={warning} severity="warning">{warning} 利用者による確認済みです。</Alert>)}
    <TableContainer><Table size="small"><TableHead><TableRow><TableCell>freee摘要（品番＋確定出力文）</TableCell><TableCell>数量</TableCell><TableCell>販売単価</TableCell><TableCell>税率</TableCell><TableCell>明細金額</TableCell></TableRow></TableHead><TableBody>
      {preview.lines.map(line => <TableRow key={line.rfqItemId}><TableCell sx={{ whiteSpace: 'pre-wrap', minWidth: 240 }}>{line.description}</TableCell><TableCell>{line.quantity} {line.unit}</TableCell><TableCell>{line.unitPrice} 円</TableCell><TableCell>{line.taxRate}%{line.reducedTaxRate ? '（軽減）' : ''}</TableCell><TableCell>{yen(line.amount)}</TableCell></TableRow>)}
    </TableBody></Table></TableContainer>
    <Typography fontWeight="bold">税抜小計：{yen(preview.subtotal)} ／ 消費税：{yen(preview.tax)} ／ 合計：{yen(preview.total)}</Typography>
    {s.note && <Typography sx={{ whiteSpace: 'pre-wrap' }}>備考：{s.note}</Typography>}
  </Stack>
}
function Editor({ rfqId, items, saved }: { rfqId: string; items: SalesQuoteTranslationItem[]; saved: SavedQuote | null }) {
  const [settings, setSettings] = useState<QuoteSettings>(() => saved?.preview.settings ?? defaults(items))
  const [baseRevision, setBaseRevision] = useState(saved?.revision ?? 0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirming, setConfirming] = useState<SavedQuote | null>(null)
  const [quotationId, setQuotationId] = useState('')
  const [partner, setPartner] = useState<SelectedFreeePartner | null>(() => saved?.partnerName ? { id: Number(saved.preview.settings.partnerId), name: saved.partnerName, companyId: saved.companyId } : null)
  // Firestore arrives after the editor has mounted. Start an existing draft from
  // that saved version instead of the empty defaults, so it can be revised.
  useEffect(() => {
    if (!saved || baseRevision !== 0) return
    setSettings(saved.preview.settings)
    setBaseRevision(saved.revision)
    setPartner(saved.partnerName ? { id: Number(saved.preview.settings.partnerId), name: saved.partnerName, companyId: saved.companyId } : null)
  }, [baseRevision, saved])
  const locked = !!saved && !['draft', 'failed'].includes(saved.status)
  const stale = (saved?.revision ?? 0) !== baseRevision
  const needsDescriptionResave = !!saved?.preview.lines.some(line => hasUnsupportedFreeeDescription(line.description))
  const dirty = needsDescriptionResave || !saved || !salesQuoteSettingsEqual(settings, saved.preview.settings) || partner?.name !== saved.partnerName || (!!partner && partner.companyId !== saved.companyId)
  let localPreview: QuotePreview | null = null, validation = ''
  try { localPreview = buildQuotePreview(parseQuoteSettings(settings), items) } catch (cause) { validation = cause instanceof Error ? cause.message : '入力を確認してください。' }
  function update<K extends keyof QuoteSettings>(key: K, value: QuoteSettings[K]) { setSettings(previous => ({ ...previous, [key]: value })) }
  async function save() {
    if (!partner) { setError('freee取引先を名前で選択してください。'); return }
    setBusy(true); setError('')
    try {
      const call = httpsCallable<unknown, SavedQuote>(firebaseFunctions, 'saveSalesQuotePricing')
      const { data } = await call({ rfqId, settings, expectedRevision: baseRevision, partnerCompanyId: partner.companyId })
      setSettings(data.preview.settings); setBaseRevision(data.revision)
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
    {saved?.error && <Alert severity="warning">{saved.error}</Alert>}
    {!locked && <>
      {stale && <Alert severity="warning" action={<Button disabled={busy} onClick={() => { if (saved) { setSettings(saved.preview.settings); setBaseRevision(saved.revision); setPartner(saved.partnerName ? { id: Number(saved.preview.settings.partnerId), name: saved.partnerName, companyId: saved.companyId } : null) } }}>保存済みを読み直す</Button>}>保存版が更新されています。入力内容を確認してから読み直してください。</Alert>}
      <Box component="fieldset" disabled={busy || stale} sx={{ border: 0, p: 0, m: 0 }}><Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <FreeePartnerPicker value={partner} disabled={busy || stale} onChange={selected => { setPartner(selected); update('partnerId', String(selected.id)) }} />
          <TextField required label="件名" value={settings.subject} onChange={e => update('subject', e.target.value)} sx={{ flex: 1 }} />
          <TextField select label="敬称" value={settings.partnerTitle} onChange={e => update('partnerTitle', e.target.value as QuoteSettings['partnerTitle'])}>{['御中', '様', '(空白)'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField required label="見積日" type="date" slotProps={{ inputLabel: { shrink: true } }} value={settings.quotationDate} onChange={e => update('quotationDate', e.target.value)} />
          <TextField label="有効期限" type="date" slotProps={{ inputLabel: { shrink: true } }} value={settings.expirationDate} onChange={e => update('expirationDate', e.target.value)} />
          <TextField label="見積書番号" value={settings.quotationNumber} onChange={e => update('quotationNumber', e.target.value)} helperText="freeeが自動採番なら空欄、手動採番なら必須" />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select label="単価の税区分" value={settings.taxEntryMethod} onChange={e => update('taxEntryMethod', e.target.value as QuoteSettings['taxEntryMethod'])}><MenuItem value="out">税別（外税）</MenuItem><MenuItem value="in">税込（内税）</MenuItem></TextField>
          {(['lineAmountFraction', 'taxFraction'] as const).map(key => <TextField key={key} select label={key === 'taxFraction' ? '消費税の端数処理' : '明細金額の端数処理'} value={settings[key]} onChange={e => update(key, e.target.value as QuoteSettings[typeof key])}>{Object.entries(fractionLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>)}
        </Stack>
        <TableContainer><Table size="small"><TableHead><TableRow><TableCell>確定明細</TableCell><TableCell>数量</TableCell><TableCell>販売単価（円）</TableCell><TableCell>税率</TableCell></TableRow></TableHead><TableBody>{items.map(item => {
          const price = settings.prices.find(p => p.rfqItemId === item.id)
          const changePrice = (change: Partial<QuoteSettings['prices'][number]>) => update('prices', settings.prices.map(p => p.rfqItemId === item.id ? { ...p, ...change } : p))
          return <TableRow key={item.id}><TableCell sx={{ minWidth: 220, whiteSpace: 'pre-wrap' }}>{item.partNumber}<br />{item.outputDescription}<Typography variant="caption" display="block">摘要 {Array.from(freeeDescription(item.partNumber, item.outputDescription)).length}/255文字</Typography>{!item.translatedDescription.trim() && <Typography color="warning.main" variant="caption">登録英訳なし：出力文の確認が必要</Typography>}</TableCell><TableCell>{item.quantity} {item.unit}</TableCell><TableCell><TextField required size="small" value={price?.unitPrice ?? ''} onChange={e => changePrice({ unitPrice: e.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `明細${item.lineNo}の販売単価` } }} /></TableCell><TableCell><TextField select size="small" value={price?.reducedTaxRate ? '8r' : String(price?.taxRate ?? 10)} onChange={e => changePrice({ taxRate: e.target.value === '8r' ? 8 : Number(e.target.value) as 0 | 8 | 10, reducedTaxRate: e.target.value === '8r' })} slotProps={{ htmlInput: { 'aria-label': `明細${item.lineNo}の税率` } }}><MenuItem value="10">10%</MenuItem><MenuItem value="8r">8%（軽減）</MenuItem><MenuItem value="8">8%</MenuItem><MenuItem value="0">0%</MenuItem></TextField></TableCell></TableRow>
        })}</TableBody></Table></TableContainer>
        <TextField label="見積書備考" multiline minRows={2} value={settings.note} onChange={e => update('note', e.target.value)} />
        <FormControlLabel control={<Checkbox checked={settings.translationsReviewed} onChange={e => update('translationsReviewed', e.target.checked)} />} label="登録英訳が未入力、または日本語を含む明細も、出力文が顧客向けとして適切なことを確認しました" />
      </Stack></Box>
      {validation && <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>{validation}</Alert>}
      {localPreview && <><Typography component="h3" variant="subtitle1">入力中のプレビュー</Typography><Preview preview={localPreview} /></>}
      <Button variant="outlined" disabled={busy || stale || !localPreview || !dirty || !partner} onClick={() => void save()}>{busy ? '処理中…' : '販売見積を保存'}</Button>
    </>}
    {saved && <>
      <Typography>freee取引先：{saved.partnerName ?? '未確認：名前で選択して保存し直してください'}</Typography>
      <Typography component="h3" variant="subtitle1">保存済みの送信内容（版 {saved.revision}）</Typography><Preview preview={saved.preview} />
      {!locked && !busy && !stale && (!partner || dirty) && <Alert severity="info">{needsDescriptionResave ? '摘要の改行をスペースに変換します。入力中のプレビューを確認し、「販売見積を保存」で新しい版を作成してください。' : !partner ? 'freee取引先を選択して、販売見積を保存してください。' : '未保存の変更があります。「販売見積を保存」してから登録内容を確認してください。'}</Alert>}
      {!locked && <Button variant="contained" disabled={busy || dirty || stale || !partner} onClick={() => setConfirming(saved)}>freeeへの登録内容を確認</Button>}
      {saved.result && <Alert severity={saved.result.verification === 'matched' ? 'success' : 'warning'}>freee見積書ID：{saved.result.id} ／ 番号：{saved.result.number || '—'} ／ freee合計：{saved.result.total === null ? '未取得' : yen(saved.result.total)}<br />{saved.result.verification === 'matched' ? '明細・金額は送信内容と一致しました。' : 'freeeの応答と送信内容に差異または未取得項目があります。帳票を確認してください。再作成は行いません。'}{saved.result.reportUrl && <><br /><Link href={saved.result.reportUrl} target="_blank" rel="noopener noreferrer">freee見積書を開く</Link></>}</Alert>}
      {['sending', 'uncertain'].includes(saved.status) && <Stack spacing={1}><Alert severity="warning">2分以上経過しても結果が確定しない場合、freeeで見積書を確認してください。社内メモ「{saved.marker}」が一致する見積書のIDで照合します。見つからない場合は管理者による調査が必要です。</Alert><TextField label="作成済みfreee見積書ID" value={quotationId} onChange={e => setQuotationId(e.target.value)} /><Button disabled={busy || !/^[1-9]\d*$/.test(quotationId)} onClick={() => void reconcile()}>freeeの作成結果を照合</Button></Stack>}
    </>}
    <Dialog open={!!confirming} fullWidth maxWidth="lg" onClose={busy ? undefined : () => setConfirming(null)}><DialogTitle>freee見積書を作成します</DialogTitle><DialogContent>{confirming && <Stack spacing={2}><Alert severity="warning">接続事業所ID {confirming.companyId} のfreeeに新規登録します。顧客「{confirming.customerName}」とfreee取引先「{confirming.partnerName}」（ID {confirming.preview.settings.partnerId}） の対応を確認してください。</Alert><Preview preview={confirming.preview} /><Typography>保存版 {confirming.revision} を送信します。顧客へのメール送付は行いません。</Typography></Stack>}</DialogContent><DialogActions><Button disabled={busy} onClick={() => setConfirming(null)}>キャンセル</Button><Button variant="contained" disabled={busy || confirming?.digest !== saved?.digest || locked} onClick={() => void send()}>{busy ? '登録中…' : '確認した内容でfreeeに登録'}</Button></DialogActions></Dialog>
  </Stack>
}

export function FreeeQuotationSection({ rfqId, items }: { rfqId: string; items: SalesQuoteTranslationItem[] }) {
  const [saved, setSaved] = useState<SavedQuote | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState('')
  const [events, setEvents] = useState<History[]>([]), [versions, setVersions] = useState<(SavedQuote & { id: string })[]>([]), [version, setVersion] = useState<SavedQuote | null>(null)
  useEffect(() => {
    const ref = doc(firestore, 'salesQuotes', rfqId, 'freeeExports', 'current')
    const fail = () => setError('販売見積の保存状態・履歴を取得できませんでした。接続とFirestore Rulesを確認して再読込してください。')
    const stop = onSnapshot(ref, snapshot => { setSaved(snapshot.exists() ? snapshot.data() as SavedQuote : null); setLoaded(true) }, fail)
    const stopEvents = onSnapshot(query(collection(ref, 'events'), orderBy('createdAt', 'desc'), limit(20)), snapshot => setEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as History))), fail)
    const stopVersions = onSnapshot(query(collection(ref, 'revisions'), orderBy('revision', 'desc'), limit(20)), snapshot => setVersions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SavedQuote & { id: string }))), fail)
    return () => { stop(); stopEvents(); stopVersions() }
  }, [rfqId])
  return <Paper sx={{ p: 3, mt: 3 }}><Stack spacing={2}>
    <Typography component="h2" variant="h6">販売見積・freee転記</Typography>
    <Typography variant="body2">確定した品番・数量・出力文を使い、販売単価を設定します。JPY、小数3桁までの数量・単価、100明細まで対応します。</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {!loaded ? <Typography>保存状態を読み込み中…</Typography> : !error && <Editor rfqId={rfqId} items={items} saved={saved} />}
    {versions.length > 0 && <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap"><Typography>保存履歴（最新20版）：</Typography>{versions.map(v => <Button key={v.id} size="small" onClick={() => setVersion(v)}>版 {v.revision}</Button>)}</Stack>}
    {events.length > 0 && <><Typography variant="subtitle1">操作・結果履歴（最新20件）</Typography>{events.map(event => <Typography key={event.id} variant="body2">{event.createdAt instanceof Timestamp ? event.createdAt.toDate().toLocaleString('ja-JP') : '記録中'} ／ 版 {event.revision} ／ {actionLabels[event.action] ?? event.action} ／ 操作者：{event.userId}{event.message ? ` ／ ${event.message}` : ''}</Typography>)}</>}
  </Stack><Dialog open={!!version} fullWidth maxWidth="lg" onClose={() => setVersion(null)}><DialogTitle>保存版 {version?.revision}</DialogTitle><DialogContent>{version && <Preview preview={version.preview} />}</DialogContent><DialogActions><Button onClick={() => setVersion(null)}>閉じる</Button></DialogActions></Dialog></Paper>
}
