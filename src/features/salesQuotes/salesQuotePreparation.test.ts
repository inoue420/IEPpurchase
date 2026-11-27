import { FirebaseError } from 'firebase/app'
import { describe, expect, it } from 'vitest'
import { getMissingQuoteOutputs, salesQuoteLineLabel, salesQuoteWriteError } from './salesQuotePreparation'

const item = { lineNo: 4, partNumber: 'A-12', translatedDescription: '', archivedAt: null, status: 'pending' as const }

describe('販売見積明細の取込・確定案内', () => {
  it('出力文を手入力した明細は英訳が空欄でも確定案内から外す', () => {
    const rows = [{ ...item, outputDescription: '  ' }, { ...item, lineNo: 6, outputDescription: 'Manually entered' }]
    expect(getMissingQuoteOutputs(rows).map(salesQuoteLineLabel)).toEqual(['明細 No. 4（品番 A-12）'])
  })

  it('保存拒否と通信失敗を入力不足へ置き換えない', () => {
    expect(salesQuoteWriteError(new FirebaseError('permission-denied', 'Missing permissions'), '取り込み')).toContain('保存が拒否')
    expect(salesQuoteWriteError(new FirebaseError('unavailable', 'Offline'), '取り込み')).toContain('通信')
    expect(salesQuoteWriteError(new Error('個別の入力案内'), '明細の確定')).toBe('個別の入力案内')
  })

  it('サーバーが返した明細番号と入力欄をそのまま案内する', () => {
    const message = '明細 No. 4（品番 A-12）：品目説明（原文）を入力してください。'
    expect(salesQuoteWriteError(new FirebaseError('functions/failed-precondition', message), '取り込み')).toBe(message)
    expect(salesQuoteWriteError(new FirebaseError('functions/permission-denied', 'permission denied'), '取り込み')).toContain('保存が拒否')
  })
})
