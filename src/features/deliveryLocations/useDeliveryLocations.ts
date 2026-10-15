import { useEffect, useState } from 'react'
import { subscribeDeliveryLocations, type DeliveryLocation } from './deliveryLocationRepository'

export function useDeliveryLocations() {
  const [locations, setLocations] = useState<DeliveryLocation[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    setLoading(true); setError('')
    return subscribeDeliveryLocations(items => { setLocations(items); setLoading(false) }, () => { setError('納品場所の候補を取得できませんでした。通信と権限を確認してください。'); setLoading(false) })
  }, [retry])
  return { locations, loading, error, retry: () => setRetry(value => value + 1) }
}
