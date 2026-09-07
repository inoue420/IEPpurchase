import { Timestamp, addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'
import { normalizePartNumber, productSchema } from './productSchema'

export interface ProductInput { manufacturerName: string; partNumber: string; name: string; janCode: string; category: string; unit: string; notes: string }
export interface ProductDocument extends ProductInput { manufacturerId: string; normalizedPartNumber: string; active: boolean; createdAt: Timestamp | null; updatedAt: Timestamp | null; archivedAt: Timestamp | null }
export interface Product extends ProductDocument { id: string }
const productsCollection = collection(firestore, 'products')
const asText = (value: unknown): string => typeof value === 'string' ? value : ''
const asTimestamp = (value: unknown): Timestamp | null => value instanceof Timestamp ? value : null
function readProduct(id: string, data: Record<string, unknown>): Product { return { id, manufacturerId: asText(data.manufacturerId), manufacturerName: asText(data.manufacturerName), partNumber: asText(data.partNumber), normalizedPartNumber: asText(data.normalizedPartNumber), name: asText(data.name), janCode: asText(data.janCode), category: asText(data.category), unit: asText(data.unit), notes: asText(data.notes), active: data.active !== false, createdAt: asTimestamp(data.createdAt), updatedAt: asTimestamp(data.updatedAt), archivedAt: asTimestamp(data.archivedAt) } }
function toDocument(input: ProductInput) { const parsed = productSchema.parse(input); return { ...parsed, manufacturerId: '', normalizedPartNumber: normalizePartNumber(parsed.partNumber) } }
export function subscribeProducts(onChange: (products: Product[]) => void, onError: (error: Error) => void): Unsubscribe { return onSnapshot(query(productsCollection, orderBy('manufacturerName')), snapshot => onChange(snapshot.docs.map(item => readProduct(item.id, item.data()))), onError) }
export async function createProduct(input: ProductInput): Promise<void> { await addDoc(productsCollection, { ...toDocument(input), active: true, archivedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }) }
export async function updateProduct(id: string, input: ProductInput): Promise<void> { const parsed = productSchema.parse(input); await updateDoc(doc(firestore, 'products', id), { ...parsed, normalizedPartNumber: normalizePartNumber(parsed.partNumber), updatedAt: serverTimestamp() }) }
export async function setProductActive(id: string, active: boolean): Promise<void> { await updateDoc(doc(firestore, 'products', id), { active, archivedAt: active ? null : serverTimestamp(), updatedAt: serverTimestamp() }) }
