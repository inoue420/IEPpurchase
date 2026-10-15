import { Alert, Autocomplete, Button, Stack, TextField } from '@mui/material'
import { useDeliveryLocations } from './useDeliveryLocations'
export function DeliveryLocationField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { locations, loading, error, retry } = useDeliveryLocations()
  return <Stack spacing={1}>
    {error && <Alert severity="error" action={<Button onClick={retry}>再試行</Button>}>{error}</Alert>}
    <Autocomplete freeSolo forcePopupIcon openOnFocus autoSelect selectOnFocus clearOnBlur={false} options={locations.filter(item => item.active).map(item => item.name)} value={value || null} inputValue={value} loading={loading} disabled={disabled}
      onChange={(_, next) => onChange(next ?? '')} onInputChange={(_, next, reason) => { if (reason === 'input' || reason === 'clear') onChange(next) }}
      noOptionsText="候補がありません。新しい納品場所を入力できます。" loadingText="候補を読み込み中…" openText="候補を表示" closeText="候補を閉じる" clearText="クリア"
      renderInput={params => <TextField {...params} label="納品場所" helperText="候補から選択するか、新しい場所を入力してください。保存時にマスタにも登録されます（255文字以内）。" />} />
  </Stack>
}
