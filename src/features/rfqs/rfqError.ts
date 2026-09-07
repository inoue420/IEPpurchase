import { FirebaseError } from 'firebase/app'
export function rfqError(error: unknown): string { if (error instanceof FirebaseError && error.code === 'permission-denied') return 'RFQ案件へのアクセス権限がありません。管理者にお問い合わせください。'; if (error instanceof FirebaseError && error.code === 'unavailable') return '通信できません。ネットワーク接続を確認して再度お試しください。'; return 'RFQ案件の処理に失敗しました。再度お試しください。' }
