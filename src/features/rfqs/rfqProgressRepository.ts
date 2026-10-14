import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'
import { areAllRfqItemsQuoted, type RfqProgress } from './rfqProgress'

export function subscribeRfqProgress(rfqId: string, onChange: (progress: RfqProgress) => void, onError: (error: Error) => void): Unsubscribe {
  let allItemsQuoted: boolean | undefined
  let freeeTransferred: boolean | undefined
  let active = true
  let failed = false
  const publish = () => {
    if (active && !failed && allItemsQuoted !== undefined && freeeTransferred !== undefined) onChange({ allItemsQuoted, freeeTransferred })
  }
  const fail = (error: Error) => {
    if (active && !failed) { failed = true; onError(error) }
  }
  const unsubscribeItems = onSnapshot(collection(firestore, 'rfqs', rfqId, 'items'), snapshot => {
    allItemsQuoted = areAllRfqItemsQuoted(snapshot.docs.map(item => {
      const data = item.data()
      return { status: typeof data.status === 'string' ? data.status : '', archivedAt: data.archivedAt }
    }))
    publish()
  }, fail)
  const unsubscribeExport = onSnapshot(doc(firestore, 'salesQuotes', rfqId, 'freeeExports', 'current'), snapshot => {
    const data = snapshot.data()
    freeeTransferred = data?.status === 'sent' || (typeof data?.lastSentRevision === 'number' && data.lastSentRevision > 0)
    publish()
  }, fail)
  return () => { active = false; unsubscribeItems(); unsubscribeExport() }
}
