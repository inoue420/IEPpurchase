import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate } from '../features/auth/AuthGate'
import { CustomersPage } from '../features/customers/CustomersPage'

export default function App() {
  return <AuthGate><Routes><Route path="/" element={<Navigate to="/customers" replace />} /><Route path="/customers" element={<CustomersPage />} /><Route path="*" element={<Navigate to="/customers" replace />} /></Routes></AuthGate>
}