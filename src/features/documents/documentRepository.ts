import { Timestamp, collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where, type Unsubscribe } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { firebaseAuth, firebaseStorage, firestore } from '../../firebase/firebase'

import { validateAttachmentFile } from './documentValidation'

export { attachmentAccept, MAX_ATTACHMENT_SIZE, validateAttachmentFile } from './documentValidation'

export interface DocumentRecord {
  id: string
  fileName: string
  storagePath: string
  mimeType: string
  fileSize: number
  documentType: 'supplier_quote'
  entityType: 'supplierQuote'
  entityId: string
  rfqId: string
  uploadedBy: string
  createdAt: Timestamp | null
}

const text = (value: unknown) => typeof value === 'string' ? value : ''
const timestamp = (value: unknown) => value instanceof Timestamp ? value : null
const currentUserId = () => {
  const uid = firebaseAuth.currentUser?.uid
  if (!uid) throw new Error('ログイン状態を確認できません。')
  return uid
}

function read(id: string, value: Record<string, unknown>): DocumentRecord {
  return {
    id, fileName: text(value.fileName), storagePath: text(value.storagePath), mimeType: text(value.mimeType), fileSize: typeof value.fileSize === 'number' ? value.fileSize : 0,
    documentType: 'supplier_quote', entityType: 'supplierQuote', entityId: text(value.entityId), rfqId: text(value.rfqId), uploadedBy: text(value.uploadedBy), createdAt: timestamp(value.createdAt),
  }
}

export function subscribeSupplierQuoteDocument(quoteId: string, changed: (document: DocumentRecord | null) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(firestore, 'documents'), where('entityId', '==', quoteId)), snapshot => {
    const record = snapshot.docs.map(item => read(item.id, item.data())).find(item => item.entityType === 'supplierQuote' && item.documentType === 'supplier_quote') ?? null
    changed(record)
  }, failed)
}

async function linkSupplierQuoteDocument(rfqId: string, quoteId: string, documentId: string, uid: string): Promise<void> {
  const quoteRef = doc(firestore, 'supplierQuotes', quoteId)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(quoteRef)
    if (!current.exists() || current.data().rfqId !== rfqId || current.data().archivedAt != null) throw new Error('見積が見つからないか、無効です。再読込してください。')
    const old = current.data()
    const revision = typeof old.revision === 'number' ? old.revision + 1 : 0
    if (!Number.isSafeInteger(revision) || revision < 2) throw new Error('見積の版数が不正です。')
    const next = { ...old, documentId, revision, updatedAt: serverTimestamp(), updatedBy: uid }
    transaction.set(quoteRef, next)
    transaction.set(doc(quoteRef, 'revisions', String(revision)), { revision, snapshot: next, previousSnapshot: old, createdAt: serverTimestamp(), createdBy: uid })
  })
}

async function saveDocumentMetadata(documentId: string, record: Omit<DocumentRecord, 'id' | 'createdAt'>): Promise<void> {
  const documentRef = doc(firestore, 'documents', documentId)
  try {
    await setDoc(documentRef, { ...record, createdAt: serverTimestamp() })
  } catch {
    await setDoc(documentRef, { ...record, createdAt: serverTimestamp() })
  }
}
export async function uploadSupplierQuoteDocument(rfqId: string, quoteId: string, file: File): Promise<DocumentRecord> {
  const uid = currentUserId()
  validateAttachmentFile(file)
  const quote = await getDoc(doc(firestore, 'supplierQuotes', quoteId))
  if (!quote.exists() || quote.data().rfqId !== rfqId) throw new Error('見積が見つかりません。再読込してください。')
  const document = doc(collection(firestore, 'documents'))
  const storagePath = `rfqs/${rfqId}/${document.id}`
  await uploadBytes(ref(firebaseStorage, storagePath), file, { contentType: file.type })
  const record = { fileName: file.name, storagePath, mimeType: file.type, fileSize: file.size, documentType: 'supplier_quote' as const, entityType: 'supplierQuote' as const, entityId: quoteId, rfqId, uploadedBy: uid }
  await saveDocumentMetadata(document.id, record)
  await linkSupplierQuoteDocument(rfqId, quoteId, document.id, uid)
  return { id: document.id, ...record, createdAt: null }
}

export async function retrySupplierQuoteDocumentLink(documentId: string): Promise<void> {
  const uid = currentUserId()
  const snapshot = await getDoc(doc(firestore, 'documents', documentId))
  if (!snapshot.exists()) throw new Error('再試行できる添付情報が見つかりません。')
  const record = read(snapshot.id, snapshot.data())
  await linkSupplierQuoteDocument(record.rfqId, record.entityId, record.id, uid)
}

export async function downloadDocument(record: DocumentRecord): Promise<string> {
  return getDownloadURL(ref(firebaseStorage, record.storagePath))
}
