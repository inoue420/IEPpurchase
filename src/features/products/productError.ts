import { FirebaseError } from 'firebase/app'
export function productError(error: unknown): string { return error instanceof FirebaseError && error.code === 'permission-denied' ? '商品情報へのアクセス権限がありません。Firestore Security Rulesを確認してください。' : '商品情報の処理に失敗しました。通信状況を確認して再度お試しください。' }
