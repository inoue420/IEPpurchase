import { useRef, useState } from 'react'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'

interface Result { translatedText: string; detectedSourceLanguage: string | null }
const translateGoogle = httpsCallable<{ text: string }, Result>(firebaseFunctions, 'translateGoogleText', { timeout: 30000 })

export function TranslationComparison({ text, disabled, onApply }: { text: string; disabled: boolean; onApply: (text: string) => void }) {
  const [result, setResult] = useState<(Result & { source: string; milliseconds: number }) | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const running = useRef(false)
  async function run() {
    if (running.current) return
    running.current = true
    setLoading(true)
    setError('')
    const source = text.trim()
    const started = performance.now()
    try {
      const { data } = await translateGoogle({ text: source })
      setResult({ ...data, source, milliseconds: performance.now() - started })
    } catch {
      setError('Google翻訳を実行できませんでした。認証設定・利用上限を確認してください。')
    } finally { running.current = false; setLoading(false) }
  }
  return <Stack spacing={2}>
    <Typography variant="subtitle2">Google Translationで英語へ翻訳</Typography>
    <Typography variant="body2">実行すると原文をGoogle Translationへ送信します。原文言語は自動判定します。結果を確認して英訳欄へ反映してください。</Typography>
    <Button type="button" variant="outlined" disabled={disabled || loading || !text.trim() || text.trim().length > 5000} onClick={() => void run()}>{loading ? '翻訳中…' : 'Googleで翻訳'}</Button>
    {error && <Alert severity="error">{error}</Alert>}
    {result && <>
      <TextField label="Google Translation" value={result.translatedText} multiline minRows={2} slotProps={{ input: { readOnly: true } }} />
      <Typography variant="caption">検出言語: {result.detectedSourceLanguage ?? '不明'} ／ 応答時間: {(result.milliseconds / 1000).toFixed(2)}秒（通信時間を含む）</Typography>
      {result.source !== text.trim() && <Alert severity="info">原文が変更されています。再翻訳してください。</Alert>}
      {result.translatedText.length > 5000 && <Alert severity="warning">訳文が保存上限の5000文字を超えています。原文を短くして再翻訳してください。</Alert>}
      <Button type="button" disabled={disabled || loading || result.source !== text.trim() || result.translatedText.length > 5000} onClick={() => onApply(result.translatedText)}>この英訳を翻訳欄へ反映</Button>
    </>}
    <Typography variant="caption">反映後に内容を確認し、品目の「保存」を押してください。比較機能はAzureの接続後に追加します。</Typography>
  </Stack>
}
