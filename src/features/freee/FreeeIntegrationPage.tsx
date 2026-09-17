import { useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'

interface BeginFreeeOAuthResult { authorizationUrl: string }
interface FreeeConnectionStatus { connected: boolean }

export function FreeeIntegrationPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  useEffect(() => {
    const status = httpsCallable<unknown, FreeeConnectionStatus>(firebaseFunctions, 'getFreeeConnectionStatus')
    void status().then(({ data }) => setConnected(data.connected)).catch(() => setConnected(false))
  }, [])
  async function startAuthorization() {
    setLoading(true); setError(null)
    try {
      const begin = httpsCallable<unknown, BeginFreeeOAuthResult>(firebaseFunctions, 'beginFreeeOAuth')
      const { data } = await begin()
      window.location.assign(data.authorizationUrl)
    } catch {
      setError('freee連携を開始できませんでした。Secret設定とデプロイ状況を確認してください。')
      setLoading(false)
    }
  }
  return <Box sx={{ p: 3, maxWidth: 760 }}><Stack spacing={2}>
    <Typography variant="h5">freee連携</Typography>
    {connected === null
      ? <Alert severity="info">連携状態を確認中です…</Alert>
      : <Alert severity={connected ? 'success' : 'warning'}>{connected ? '連携中：freeeへの接続情報が設定されています。' : '未連携：freeeへの接続情報が設定されていません。'}</Alert>}
    <Typography>freeeで対象事業所を選択して連携を許可します。認可コードとトークンはブラウザやFirestoreには保存しません。</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    <Box><Button variant="contained" onClick={startAuthorization} disabled={loading} startIcon={loading ? <CircularProgress size={18} /> : undefined}>freeeで連携を許可する</Button></Box>
    <Alert severity="info">この操作では見積書の作成・送付は行いません。</Alert>
  </Stack></Box>
}
