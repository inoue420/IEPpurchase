import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button, Stack } from '@mui/material'
import { AuthGate } from '../features/auth/AuthGate'
import { CustomersPage } from '../features/customers/CustomersPage'
import { SuppliersPage } from '../features/suppliers/SuppliersPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { RfqDetailPage } from '../features/rfqs/RfqDetailPage'
import { RfqEditorPage } from '../features/rfqs/RfqEditorPage'
import { RfqsPage } from '../features/rfqs/RfqsPage'
import { FreeeIntegrationPage } from '../features/freee/FreeeIntegrationPage'

export default function App() {
  const { pathname } = useLocation()
  return <AuthGate>
    <Stack component="nav" aria-label="メインナビゲーション" direction="row" spacing={1} sx={{ px: 3, flexWrap: 'wrap' }}>
      <Button component={Link} to="/rfqs" variant={pathname.startsWith('/rfqs') ? 'contained' : 'text'}>RFQ案件</Button>
      <Button component={Link} to="/customers" variant={pathname === '/customers' ? 'contained' : 'text'}>顧客</Button>
      <Button component={Link} to="/suppliers" variant={pathname === '/suppliers' ? 'contained' : 'text'}>仕入先</Button>
      <Button component={Link} to="/products" variant={pathname === '/products' ? 'contained' : 'text'}>商品</Button>
      <Button component={Link} to="/integrations/freee" variant={pathname === '/integrations/freee' ? 'contained' : 'text'}>freee連携</Button>
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