import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button, Stack } from '@mui/material'
import { AuthGate } from '../features/auth/AuthGate'
import { CustomersPage } from '../features/customers/CustomersPage'
import { SuppliersPage } from '../features/suppliers/SuppliersPage'

export default function App() {
  const { pathname } = useLocation()
  return <AuthGate>
    <Stack component="nav" aria-label="マスター管理" direction="row" spacing={1} sx={{ px: 3 }}>
      <Button component={Link} to="/customers" variant={pathname === '/customers' ? 'contained' : 'text'}>顧客</Button>
      <Button component={Link} to="/suppliers" variant={pathname === '/suppliers' ? 'contained' : 'text'}>仕入先</Button>
    </Stack>
    <Routes>
      <Route path="/" element={<Navigate to="/customers" replace />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/suppliers" element={<SuppliersPage />} />
      <Route path="*" element={<Navigate to="/customers" replace />} />
    </Routes>
  </AuthGate>
}
