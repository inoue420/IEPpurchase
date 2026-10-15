import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc, type Transaction } from 'firebase/firestore'
import { firebaseAuth, firestore } from '../../firebase/firebase'
import { deliveryLocationName, normalizeDeliveryLocation, type DeliveryLocationSelection } from '../../../functions/src/deliveryLocationModel'

export interface DeliveryLocation { id: string; name: string; normalizedName: string; active: boolean }
export function subscribeDeliveryLocations(change: (items: DeliveryLocation[]) => void, fail: (error: Error) => void) {
  return onSnapshot(query(collection(firestore, 'deliveryLocations'), orderBy('name')), snapshot => change(snapshot.docs.map(item => ({
    id: item.id, name: String(item.data().name), normalizedName: String(item.data().normalizedName), active: item.data().active === true,
  }))), fail)
}
export async function prepareDeliveryLocation(value: string) {
  const name = deliveryLocationName(value), normalizedName = normalizeDeliveryLocation(name)
  if (!name) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedName))
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return { ref: doc(firestore, 'deliveryLocations', id), name, normalizedName }
}
// Call after all other transaction reads. The RFQ and new master are committed together.
export async function selectDeliveryLocation(transaction: Transaction, prepared: Awaited<ReturnType<typeof prepareDeliveryLocation>>): Promise<DeliveryLocationSelection> {
  if (!prepared) return { deliveryLocationId: '', deliveryLocationName: '' }
  const existing = await transaction.get(prepared.ref)
  if (existing.exists()) {
    if (!existing.get('active')) throw new Error('この納品場所は無効です。マスタで有効に戻すか、別の場所を選択してください。')
    if (existing.get('normalizedName') !== prepared.normalizedName) throw new Error('納品場所を照合できませんでした。再読み込みしてください。')
    return { deliveryLocationId: existing.id, deliveryLocationName: existing.get('name') as string }
  }
  const userId = firebaseAuth.currentUser?.uid
  if (!userId) throw new Error('ログインが必要です。')
  transaction.set(prepared.ref, { name: prepared.name, normalizedName: prepared.normalizedName, active: true,
    createdAt: serverTimestamp(), createdBy: userId, updatedAt: serverTimestamp(), updatedBy: userId, archivedAt: null })
  return { deliveryLocationId: prepared.ref.id, deliveryLocationName: prepared.name }
}
export async function createDeliveryLocation(name: string) {
  const prepared = await prepareDeliveryLocation(name)
  if (!prepared) throw new Error('納品場所を入力してください。')
  return runTransaction(firestore, transaction => selectDeliveryLocation(transaction, prepared))
}
export async function setDeliveryLocationActive(id: string, active: boolean) {
  const userId = firebaseAuth.currentUser?.uid
  if (!userId) throw new Error('ログインが必要です。')
  await updateDoc(doc(firestore, 'deliveryLocations', id), { active, archivedAt: active ? null : serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: userId })
}
