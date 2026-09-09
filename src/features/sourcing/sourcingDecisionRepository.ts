import { Timestamp, collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'

export interface SourcingDecision {
  id: string
  sourceType: string
  supplierName: string
  selectedQuantity: number
  unitCost: number
  shippingCost: number
  reason: string
  status: 'active' | 'cancelled'
  selectedBy: string
  selectedAt: Timestamp | null
  cancelledBy: string | null
  cancelledAt: Timestamp | null
}
export interface SourcingState { selectedQuantityMillis: number }
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const text = (value: unknown) => typeof value === 'string' ? value : ''
const timestamp = (value: unknown) => value instanceof Timestamp ? value : null

export function subscribeSourcingDecisions(rfqId: string, itemId: string, changed: (value: SourcingDecision[]) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(firestore, 'rfqs', rfqId, 'items', itemId, 'sourcingDecisions'), snapshot => changed(snapshot.docs.map(row => {
    const data = row.data()
    return { id: row.id, sourceType: text(data.sourceType), supplierName: text(data.supplierName), selectedQuantity: number(data.selectedQuantity), unitCost: number(data.unitCost), shippingCost: number(data.shippingCost), reason: text(data.reason), status: text(data.status) as SourcingDecision['status'], selectedBy: text(data.selectedBy), selectedAt: timestamp(data.selectedAt), cancelledBy: text(data.cancelledBy) || null, cancelledAt: timestamp(data.cancelledAt) }
  }).sort((left, right) => (right.selectedAt?.toMillis() ?? 0) - (left.selectedAt?.toMillis() ?? 0))), failed)
}

export function subscribeSourcingState(rfqId: string, itemId: string, changed: (value: SourcingState) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(firestore, 'rfqs', rfqId, 'sourcingStates', itemId), row => changed({ selectedQuantityMillis: row.exists() ? number(row.data().selectedQuantityMillis) : 0 }), failed)
}
