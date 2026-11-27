import { FirebaseError } from 'firebase/app'
import type { RfqItem } from '../rfqs/rfqItemRepository'
import type { SalesQuoteTranslationItem } from './salesQuoteTranslationRepository'

export function isImportableRfqItem(item: Pick<RfqItem, 'archivedAt' | 'status'>): boolean {
  return item.archivedAt === null && item.status !== 'cancelled'
}

export function salesQuoteLineLabel(item: Pick<RfqItem, 'lineNo' | 'partNumber'>): string {
  return item.partNumber.trim() ? `明細 No. ${item.lineNo}（品番 ${item.partNumber}）` : `明細 No. ${item.lineNo}`
}

export function getMissingQuoteOutputs<T extends Pick<SalesQuoteTranslationItem, 'outputDescription'>>(items: T[]): T[] {
  return items.filter(item => !item.outputDescription.trim())
}

export function salesQuoteWriteError(cause: unknown, action: '取り込み' | '明細の確定' | '編集の再開'): string {
  if (cause instanceof FirebaseError) {
    switch (cause.code.replace(/^functions\//, '')) {
      case 'unauthenticated': return `${action}にはログインが必要です。再ログインしてお試しください。`
      case 'permission-denied': return `${action}の保存が拒否されました。ページを再読み込みし、RFQ品目や見積の状態を確認してから再試行してください。同じエラーが続く場合は、案件番号とこのメッセージを管理者へお知らせください。`
      case 'unavailable':
      case 'deadline-exceeded': return `${action}中に通信できませんでした。接続を確認してから再試行してください。`
      case 'aborted':
      case 'not-found':
      case 'invalid-argument':
      case 'failed-precondition': return cause.code.startsWith('functions/') && cause.message
        ? cause.message
        : `${action}を完了できませんでした。ページを再読み込みして最新の状態で再試行してください。`
      default: return `${action}を完了できませんでした。再試行しても解決しない場合は、案件番号とエラーコード（${cause.code}）を管理者へお知らせください。`
    }
  }
  return cause instanceof Error ? cause.message : `${action}を完了できませんでした。再試行してください。`
}
