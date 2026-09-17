import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { AuthGate } from '../features/auth/AuthGate'
import { CustomersPage } from '../features/customers/CustomersPage'
import { SuppliersPage } from '../features/suppliers/SuppliersPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { RfqDetailPage } from '../features/rfqs/RfqDetailPage'
import { RfqEditorPage } from '../features/rfqs/RfqEditorPage'
import { RfqsPage } from '../features/rfqs/RfqsPage'
import { FreeeIntegrationPage } from '../features/freee/FreeeIntegrationPage'
import { firebaseFunctions } from '../firebase/firebase'

interface FreeeConnectionStatus { connected: boolean }

export default function App() {
  const { pathname } = useLocation()
  const [freeeConnected, setFreeeConnected] = useState<boolean | null>(null)
  useEffect(() => {
    const status = httpsCallable<unknown, FreeeConnectionStatus>(firebaseFunctions, 'getFreeeConnectionStatus')
    void status().then(({ data }) => setFreeeConnected(data.connected)).catch(() => setFreeeConnected(false))
  }, [])
  return <AuthGate>
    <Stack component="nav" aria-label="メインナビゲーション" direction="row" spacing={1} sx={{ px: 3, flexWrap: 'wrap' }}>
      <Button component={Link} to="/rfqs" variant={pathname.startsWith('/rfqs') ? 'contained' : 'text'}>RFQ案件</Button>
      <Button component={Link} to="/customers" variant={pathname === '/customers' ? 'contained' : 'text'}>顧客</Button>
      <Button component={Link} to="/suppliers" variant={pathname === '/suppliers' ? 'contained' : 'text'}>仕入先</Button>
      <Button component={Link} to="/products" variant={pathname === '/products' ? 'contained' : 'text'}>商品</Button>
      <Stack spacing={0} alignItems="center" sx={{ py: 0.25 }}>
        <Typography variant="caption" color={freeeConnected ? 'success.main' : 'warning.main'}>{freeeConnected ? '連携中' : freeeConnected === false ? '未連携' : '確認中'}</Typography>
        <Button component={Link} to="/integrations/freee" variant={pathname === '/integrations/freee' ? 'contained' : 'text'}>freee連携</Button>
      </Stack>
    </Stack>
    <Routes>
      <Route path="/" element={<Navigate to="/rfqs" replace />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/suppliers" element={<SuppliersPage />} />
      <Route path="/products" element={<ProductsPage />} />
      <Route path="/integrations/freee" element={<FreeeIntegrationPage />} />
      <Route path="/rfqs" element={<RfqsPage />} />
      <Route path="/rfqs/new" element={<RfqEditorPage mode="create" />} />
      <Route path="/rfqs/:rfqId/edit" element={<RfqEditorPage mode="edit" />} />
      <Route path="/rfqs/:rfqId" element={<RfqDetailPage />} />
      <Route path="*" element={<Navigate to="/rfqs" replace />} />
    </Routes>
  </AuthGate>
}
