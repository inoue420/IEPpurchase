import { Navigate, Route, Routes } from 'react-router-dom'
import { Box, Paper, Typography } from '@mui/material'

function PreparationPage() {
  return (
    <Box sx={{ display: 'grid', minHeight: '100vh', placeItems: 'center', p: 3 }}>
      <Paper sx={{ maxWidth: 640, p: 4 }}>
        <Typography component="h1" variant="h4" gutterBottom>IEPpurchase</Typography>
        <Typography color="text.secondary">資材調達管理システムの基盤を準備しています。</Typography>
      </Paper>
    </Box>
  )
}

export default function App() {
  return <Routes><Route path="/" element={<PreparationPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>
}
