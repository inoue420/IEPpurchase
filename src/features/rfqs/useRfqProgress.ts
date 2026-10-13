import { useEffect, useState } from 'react'
import { rfqError } from './rfqError'
import type { RfqProgress } from './rfqProgress'
import { subscribeRfqProgress } from './rfqProgressRepository'

interface ProgressState { progress?: RfqProgress; error?: string }

export function useRfqProgress(rfqIds: readonly string[], retry = 0): Record<string, ProgressState> {
  const idsKey = JSON.stringify([...new Set(rfqIds)].sort())
  const [states, setStates] = useState<Record<string, ProgressState>>({})
  useEffect(() => {
    const ids: string[] = JSON.parse(idsKey)
    setStates({})
    const unsubscribes = ids.map(id => subscribeRfqProgress(id,
      progress => setStates(current => ({ ...current, [id]: { progress } })),
      cause => setStates(current => ({ ...current, [id]: { error: rfqError(cause) } })),
    ))
    return () => unsubscribes.forEach(unsubscribe => unsubscribe())
  }, [idsKey, retry])
  return states
}
