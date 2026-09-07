import { Timestamp, addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'
import { supplierSchema } from './supplierSchema'

export interface SupplierInput {
  name: string
  contactName: string
  email: string
  phone: string
  postalCode: string
  address: string
  notes: string
}

export interface SupplierDocument extends SupplierInput {
  active: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  archivedAt: Timestamp | null
}

export interface Supplier extends SupplierDocument { id: string }

const suppliersCollection = collection(firestore, 'suppliers')
const asText = (value: unknown): string => typeof value === 'string' ? value : ''
const asTimestamp = (value: unknown): Timestamp | null => value instanceof Timestamp ? value : null

function readSupplier(id: string, data: Record<string, unknown>): Supplier {
  return {
    id, name: asText(data.name), contactName: asText(data.contactName),
    email: asText(data.email), phone: asText(data.phone), postalCode: asText(data.postalCode),
    address: asText(data.address), notes: asText(data.notes), active: data.active !== false,
    createdAt: asTimestamp(data.createdAt), updatedAt: asTimestamp(data.updatedAt),
    archivedAt: asTimestamp(data.archivedAt),
  }
}

export function subscribeSuppliers(onChange: (suppliers: Supplier[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(suppliersCollection, orderBy('name')), snapshot => {
    onChange(snapshot.docs.map(item => readSupplier(item.id, item.data())))
  }, onError)
}

export async function createSupplier(input: SupplierInput): Promise<void> {
  await addDoc(suppliersCollection, { ...supplierSchema.parse(input), active: true, archivedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}

export async function updateSupplier(id: string, input: SupplierInput): Promise<void> {
  await updateDoc(doc(firestore, 'suppliers', id), { ...supplierSchema.parse(input), updatedAt: serverTimestamp() })
}

export async function setSupplierActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(firestore, 'suppliers', id), { active, archivedAt: active ? null : serverTimestamp(), updatedAt: serverTimestamp() })
}
