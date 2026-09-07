import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { BrowserRouter } from 'react-router-dom'
import App from './app/App'

const theme = createTheme({
  palette: { primary: { main: '#155e75' }, background: { default: '#f7f9fc' } },
  typography: { fontFamily: '"Noto Sans JP", "Yu Gothic", sans-serif' },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter><App /></BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
