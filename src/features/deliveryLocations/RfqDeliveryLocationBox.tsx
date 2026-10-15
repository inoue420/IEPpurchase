import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { normalizeDeliveryLocation } from '../../../functions/src/deliveryLocationModel'
import { subscribeRfq, updateRfqDeliveryLocation, type Rfq } from '../rfqs/rfqRepository'
import { DeliveryLocationField } from './DeliveryLocationField'
import { useDeliveryLocations } from './useDeliveryLocations'
import { extractDeliveryLocationCandidates } from './deliveryLocationExtraction'

// Extraction only preselects a candidate; saving is always an explicit user action.
export function RfqDeliveryLocationBox({ rfqId, extractedText }: { rfqId: string; extractedText?: string }) {
  const candidates = extractDeliveryLocationCandidates(extractedText ?? '')
  if (extractedText !== undefined && !candidates.length) return null
  return <DeliveryLocationEditor key={candidates.join('\u0000')} rfqId={rfqId} extractedText={extractedText} />
}
function DeliveryLocationEditor({ rfqId, extractedText }: { rfqId: string; extractedText?: string }) {
  const [rfq, setRfq] = useState<Rfq | null>(null), [value, setValue] = useState(''), [edited, setEdited] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [base, setBase] = useState({ deliveryLocationId: '', deliveryLocationName: '' })
  const saving = useRef(false)
  const { locations } = useDeliveryLocations()
  const candidates = extractDeliveryLocationCandidates(extractedText ?? '')
  const candidate = candidates.length === 1 ? candidates[0] : ''
  const match = candidate ? locations.filter(item => item.active && normalizeDeliveryLocation(item.name) === normalizeDeliveryLocation(candidate)) : []
  const inactiveMatch = candidate && locations.some(item => !item.active && normalizeDeliveryLocation(item.name) === normalizeDeliveryLocation(candidate))
  const suggested = match.length === 1 ? match[0].name : candidate
  useEffect(() => subscribeRfq(rfqId, setRfq, () => setError('RFQの納品場所を取得できませんでした。再読み込みしてください。')), [rfqId])
  useEffect(() => {
    if (!rfq || edited) return
    setBase({ deliveryLocationId: rfq.deliveryLocationId ?? '', deliveryLocationName: rfq.deliveryLocationName ?? '' })
    setValue(extractedText !== undefined ? suggested : rfq.deliveryLocationName ?? '')
  }, [rfq, edited, suggested, extractedText])
  const stale = !!rfq && ((rfq.deliveryLocationId ?? '') !== base.deliveryLocationId || (rfq.deliveryLocationName ?? '') !== base.deliveryLocationName)
  async function save() {
    if (!rfq || saving.current) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try { await updateRfqDeliveryLocation(rfqId, value, base); setEdited(false); setNotice('納品場所を保存しました。販売見積には次の保存時に反映されます。') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '納品場所を保存できませんでした。') }
    finally { saving.current = false; setBusy(false) }
  }
  if (extractedText !== undefined && !candidates.length) return null
  return <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}><Stack spacing={1.5}>
    <Typography component="h3" variant="subtitle1">{extractedText === undefined ? '納品場所' : '取込で見つかった納品場所'}</Typography>
    {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {extractedText !== undefined && <Alert severity={inactiveMatch ? 'warning' : 'info'}>{candidates.length > 1 ? '複数の納品場所があります。候補を確認して選択してください。' : match.length === 1 ? '既存マスタと一致した納品場所を自動選択しました。' : inactiveMatch ? '一致した納品場所は無効です。マスタで有効に戻すか、別の場所を選択してください。' : '未登録の納品場所を新規候補として表示しています。'} 保存するとRFQに反映されます。品目の登録とは別に保存してください。</Alert>}
    <Typography variant="body2">現在の保存値：{rfq?.deliveryLocationName || '未指定'}</Typography>
    {candidates.length > 1 && <TextField select label="抽出候補" value={candidates.includes(value) ? value : ''} disabled={busy} onChange={event => { setValue(event.target.value); setEdited(true) }}>{candidates.map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>}
    <DeliveryLocationField value={value} disabled={busy || !rfq} onChange={next => { setValue(next); setEdited(true); setNotice('') }} />
    {stale && <Alert severity="warning" action={<Button disabled={busy} onClick={() => setEdited(false)}>読み直す</Button>}>別の操作で納品場所が変更されました。読み直してから保存してください。</Alert>}
    <Button variant="outlined" sx={{ alignSelf: 'flex-start' }} disabled={busy || !rfq || stale || (extractedText !== undefined && !value.trim()) || value.trim() === (rfq.deliveryLocationName ?? '')} onClick={() => void save()}>{busy ? '保存中…' : '納品場所を保存'}</Button>
  </Stack></Box>
}
