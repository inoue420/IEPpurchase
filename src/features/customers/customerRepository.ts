import { Timestamp, addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'

export interface Customer { id: string; name: string; contactName: string; email: string; phone: string; postalCode: string; address: string; notes: string; active: boolean; createdAt: Timestamp | null; updatedAt: Timestamp | null; archivedAt: Timestamp | null }
export interface CustomerInput { name: string; contactName: string; email: string; phone: string; postalCode: string; address: string; notes: string }

const customersCollection = collection(firestore, 'customers')
const asText = (value: unknown): string => typeof value === 'string' ? value : ''
const asTimestamp = (value: unknown): Timestamp | null => value instanceof Timestamp ? value : null

function readCustomer(id: string, data: Record<string, unknown>): Customer {
  return { id, name: asText(data.name), contactName: asText(data.contactName), email: asText(data.email), phone: asText(data.phone), postalCode: asText(data.postalCode), address: asText(data.address), notes: asText(data.notes), active: data.active !== false, createdAt: asTimestamp(data.createdAt), updatedAt: asTimestamp(data.updatedAt), archivedAt: asTimestamp(data.archivedAt) }
}

export function subscribeCustomers(onChange: (customers: Customer[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(customersCollection, orderBy('name')), (snapshot) => onChange(snapshot.docs.map((item) => readCustomer(item.id, item.data()))), onError)
}

export async function createCustomer(input: CustomerInput): Promise<void> { await addDoc(customersCollection, { ...input, active: true, archivedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }) }
export async function updateCustomer(id: string, input: CustomerInput): Promise<void> { await updateDoc(doc(firestore, 'customers', id), { ...input, updatedAt: serverTimestamp() }) }
export async function archiveCustomer(id: string): Promise<void> { await updateDoc(doc(firestore, 'customers', id), { active: false, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() }) }
export async function restoreCustomer(id: string): Promise<void> { await updateDoc(doc(firestore, 'customers', id), { active: true, archivedAt: null, updatedAt: serverTimestamp() }) }
