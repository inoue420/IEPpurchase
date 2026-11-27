import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'

export type FreeeConnectionStatus = 'checking' | 'connected' | 'disconnected' | 'unavailable'

export function useFreeeConnectionStatus(): FreeeConnectionStatus {
  const [status, setStatus] = useState<FreeeConnectionStatus>('checking')
  useEffect(() => {
    let active = true
    const getStatus = httpsCallable<unknown, { connected: boolean }>(firebaseFunctions, 'getFreeeConnectionStatus')
    void getStatus().then(({ data }) => {
      if (active) setStatus(data.connected ? 'connected' : 'disconnected')
    }).catch(() => {
      if (active) setStatus('unavailable')
    })
    return () => { active = false }
  }, [])
  return status
}
