import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button, Stack, Typography } from '@mui/material'
import { AuthGate } from '../features/auth/AuthGate'
import { CustomersPage } from '../features/customers/CustomersPage'
import { SuppliersPage } from '../features/suppliers/SuppliersPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { DeliveryLocationsPage } from '../features/deliveryLocations/DeliveryLocationsPage'
import { RfqDetailPage } from '../features/rfqs/RfqDetailPage'
import { RfqEditorPage } from '../features/rfqs/RfqEditorPage'
import { RfqsPage } from '../features/rfqs/RfqsPage'
import { FreeeIntegrationPage } from '../features/freee/FreeeIntegrationPage'
import { useFreeeConnectionStatus } from '../features/freee/useFreeeConnectionStatus'

const connectionLabels = { checking: '確認中', connected: '連携中', disconnected: '未連携・期限切れ', unavailable: '確認できません' }

function AuthenticatedApp() {
  const { pathname } = useLocation()
  const freeeStatus = useFreeeConnectionStatus()
  return <>
    <Stack component="nav" aria-label="メインナビゲーション" direction="row" spacing={1} sx={{ px: 3, flexWrap: 'wrap' }}>
      <Button component={Link} to="/rfqs" variant={pathname.startsWith('/rfqs') ? 'contained' : 'text'}>RFQ案件</Button>
      <Button component={Link} to="/customers" variant={pathname === '/customers' ? 'contained' : 'text'}>顧客</Button>
      <Button component={Link} to="/suppliers" variant={pathname === '/suppliers' ? 'contained' : 'text'}>仕入先</Button>
      <Button component={Link} to="/products" variant={pathname === '/products' ? 'contained' : 'text'}>商品</Button>
      <Button component={Link} to="/delivery-locations" variant={pathname === '/delivery-locations' ? 'contained' : 'text'}>納品場所</Button>
      <Stack spacing={0} alignItems="center" sx={{ py: 0.25 }}>
        <Typography variant="caption" color={freeeStatus === 'connected' ? 'success.main' : 'warning.main'}>{connectionLabels[freeeStatus]}</Typography>
        <Button component={Link} to="/integrations/freee" variant={pathname === '/integrations/freee' ? 'contained' : 'text'}>freee連携</Button>
      </Stack>
    </Stack>
    <Routes>
      <Route path="/" element={<Navigate to="/rfqs" replace />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/suppliers" element={<SuppliersPage />} />
      <Route path="/products" element={<ProductsPage />} />
      <Route path="/delivery-locations" element={<DeliveryLocationsPage />} />
      <Route path="/integrations/freee" element={<FreeeIntegrationPage />} />
      <Route path="/rfqs" element={<RfqsPage />} />
      <Route path="/rfqs/new" element={<RfqEditorPage mode="create" />} />
      <Route path="/rfqs/:rfqId/edit" element={<RfqEditorPage mode="edit" />} />
      <Route path="/rfqs/:rfqId" element={<RfqDetailPage freeeStatus={freeeStatus} />} />
      <Route path="*" element={<Navigate to="/rfqs" replace />} />
    </Routes>
  </>
}

export default function App() {
  return <AuthGate><AuthenticatedApp /></AuthGate>
}
