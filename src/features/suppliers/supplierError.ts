import { FirebaseError } from 'firebase/app'

export function supplierError(error: unknown): string {
  if (error instanceof FirebaseError && error.code === 'permission-denied') {
    return '仕入先情報へのアクセス権限がありません。管理者にお問い合わせください。'
  }
  return '仕入先情報の処理に失敗しました。通信状況を確認して再度お試しください。'
}
