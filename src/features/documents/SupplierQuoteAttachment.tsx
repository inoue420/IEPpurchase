import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { attachmentAccept, downloadDocument, retrySupplierQuoteDocumentLink, subscribeSupplierQuoteDocument, uploadSupplierQuoteDocument, type DocumentRecord } from './documentRepository'

export function SupplierQuoteAttachment({ rfqId, quoteId, linkedDocumentId, onLinked }: { rfqId: string; quoteId: string; linkedDocumentId: string | null; onLinked?: () => void }) {
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => subscribeSupplierQuoteDocument(quoteId, setDocument, () => setError('添付情報を取得できませんでした。')), [quoteId])
  async function attach(file: File) {
    setBusy(true); setError(null)
    try { await uploadSupplierQuoteDocument(rfqId, quoteId, file); onLinked?.() } catch (cause) { setError(cause instanceof Error ? cause.message : '添付に失敗しました。') } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  async function open() {
    if (!document) return
    setBusy(true); setError(null)
    try { window.open(await downloadDocument(document), '_blank', 'noopener,noreferrer') } catch { setError('添付ファイルを開けませんでした。') } finally { setBusy(false) }
  }
  async function retryLink() {
    if (!document) return
    setBusy(true); setError(null)
    try { await retrySupplierQuoteDocumentLink(document.id); onLinked?.() } catch { setError('見積への紐付けを再試行できませんでした。') } finally { setBusy(false) }
  }
  return <Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}><Typography variant="body2">添付: {document ? `${document.fileName}（${Math.ceil(document.fileSize / 1024)}KB）` : 'なし'}</Typography>{document ? <><Button size="small" disabled={busy} onClick={() => void open()}>開く</Button>{linkedDocumentId !== document.id && <Button size="small" disabled={busy} onClick={() => void retryLink()}>紐付けを再試行</Button>}</> : <Button size="small" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'アップロード中…' : '添付'}</Button>} {busy && <CircularProgress size={18} />}</Stack><input ref={input} hidden type="file" accept={attachmentAccept} onChange={event => { const file = event.target.files?.[0]; if (file) void attach(file) }} />{error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}<Typography variant="caption" color="text.secondary">PDF、画像、Excel（10MB以下）。添付後に保存処理が失敗した場合は「紐付けを再試行」できます。</Typography></Box>
}
