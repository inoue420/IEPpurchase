import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { FirebaseError } from 'firebase/app'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { Navigate, useLocation } from 'react-router-dom'
import { firebaseAuth } from '../../firebase/firebase'

function authError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-email':
        return 'メールアドレスまたはパスワードを確認してください。'
      case 'auth/too-many-requests':
        return '試行回数が多すぎます。しばらく待ってから再度お試しください。'
      case 'auth/network-request-failed':
        return '通信できません。ネットワーク接続を確認してください。'
      case 'auth/user-disabled':
        return 'このアカウントは利用できません。管理者にお問い合わせください。'
    }
  }
  return '認証処理に失敗しました。再度お試しください。解決しない場合は管理者にお問い合わせください。'
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [observerError, setObserverError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const location = useLocation()

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser)
    setPassword('')
    setError(null)
    setLoading(false)
  }, () => {
    setUser(null)
    setObserverError(true)
    setLoading(false)
  }), [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password)
    } catch (cause: unknown) {
      setError(authError(cause))
      setPassword('')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function logout() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await signOut(firebaseAuth)
    } catch (cause: unknown) {
      setError(authError(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (loading) return <Box sx={{ display: 'grid', minHeight: '100vh', placeItems: 'center' }}><CircularProgress aria-label="ログイン状態を確認中" /></Box>
  if (observerError) return <Box sx={{ p: 3 }}><Alert severity="error">ログイン状態を確認できません。ページを再読み込みしてください。</Alert></Box>
  if (!user && location.pathname !== '/login') return <Navigate to="/login" replace />
  if (user && location.pathname === '/login') return <Navigate to="/" replace />

  if (user) return <>
    <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{user.email}</Typography>
      <Button variant="outlined" disabled={busy} onClick={() => void logout()}>{busy ? '処理中…' : 'ログアウト'}</Button>
    </Stack>
    {error && <Alert severity="error" sx={{ mx: 2 }}>{error}</Alert>}
    {children}
  </>

  return <Box sx={{ display: 'grid', minHeight: '100vh', placeItems: 'center', p: 2 }}>
    <Paper component="main" sx={{ maxWidth: 440, width: '100%', p: { xs: 3, sm: 4 } }}>
      <Typography component="h1" variant="h4" gutterBottom>IEPpurchase</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>社内利用者向けログイン</Typography>
      <Stack component="form" spacing={2} onSubmit={login}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="メールアドレス" type="email" autoComplete="username" required fullWidth value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
        <TextField label="パスワード" type="password" autoComplete="current-password" required fullWidth value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        <Button type="submit" variant="contained" disabled={busy || !email.trim() || !password}>{busy ? 'ログイン中…' : 'ログイン'}</Button>
        <Typography variant="body2" color="text.secondary">利用アカウントについては管理者にお問い合わせください。</Typography>
      </Stack>
    </Paper>
  </Box>
}
