import { useRef, useState, type FormEvent } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { createSupplier, updateSupplier, type Supplier, type SupplierInput } from './supplierRepository'
import { supplierSchema } from './supplierSchema'
import { supplierError } from './supplierError'

const emptyInput: SupplierInput = { name: '', contactName: '', email: '', phone: '', postalCode: '', address: '', notes: '' }
const fields: { key: keyof SupplierInput; label: string; maxLength: number }[] = [
  { key: 'name', label: '仕入先名', maxLength: 200 },
  { key: 'contactName', label: '担当者名', maxLength: 200 },
  { key: 'email', label: 'メールアドレス', maxLength: 254 },
  { key: 'phone', label: '電話番号', maxLength: 50 },
  { key: 'postalCode', label: '郵便番号', maxLength: 20 },
  { key: 'address', label: '住所', maxLength: 1000 },
  { key: 'notes', label: '備考', maxLength: 5000 },
]

export function SupplierDialog({ supplier, onClose, onSaved }: {
  supplier: Supplier | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [input, setInput] = useState<SupplierInput>(supplier ? {
    name: supplier.name, contactName: supplier.contactName, email: supplier.email,
    phone: supplier.phone, postalCode: supplier.postalCode, address: supplier.address, notes: supplier.notes,
  } : emptyInput)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const result = supplierSchema.safeParse(input)
    if (!result.success) { setError(result.error.issues[0].message); return }
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      if (supplier) await updateSupplier(supplier.id, result.data)
      else await createSupplier(result.data)
      onSaved(supplier ? '仕入先情報を更新しました。' : '仕入先を登録しました。')
    } catch (cause: unknown) {
      setError(supplierError(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="supplier-dialog-title">
    <Box component="form" onSubmit={event => void save(event)}>
      <DialogTitle id="supplier-dialog-title">{supplier ? '仕入先を編集' : '仕入先を登録'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {fields.map(({ key, label, maxLength }) => <TextField key={key} label={label}
          required={key === 'name'} autoFocus={key === 'name'} fullWidth
          type={key === 'email' ? 'email' : 'text'}
          multiline={key === 'address' || key === 'notes'} minRows={2}
          slotProps={{ htmlInput: { maxLength } }} value={input[key]} disabled={busy}
          onChange={event => setInput(current => ({ ...current, [key]: event.target.value }))} />)}
      </Stack></DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button type="submit" variant="contained" disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </DialogActions>
    </Box>
  </Dialog>
}
