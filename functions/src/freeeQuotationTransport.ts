import { record, type FreeeQuotePayload } from './salesQuoteModel'

export interface FreeeResult {
  id: number; number: string; reportUrl: string; total: number | null; tax: number | null
  verification: 'matched' | 'needs_review'
}
export class FreeeRequestError extends Error {
  constructor(public readonly retryable: boolean, message: string) { super(message) }
}
async function rejectionDetails(response: Response, token: string): Promise<string> {
  try {
    const raw = await response.text()
    if (raw.length > 32_768) return ''
    const body = record(JSON.parse(raw))
    if (!Array.isArray(body.errors)) return ''
    const messages: string[] = []
    for (const value of body.errors.slice(0, 10)) {
      if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) continue
      for (const message of value.messages.slice(0, 5)) {
        if (typeof message !== 'string') continue
        // Only documented messages; no raw response or headers.
        const safe = (token ? message.split(token).join('[非表示]') : message)
          .replace(/Bearer\s+\S+/gi, 'Bearer [非表示]')
          .replace(/\p{Cc}/gu, ' ').trim().slice(0, 300)
        if (safe && !messages.includes(safe)) messages.push(safe)
        if (messages.length === 5) break
      }
      if (messages.length === 5) break
    }
    return messages.length ? ' freeeの詳細：' + messages.join(' ／ ') : ''
  } catch { return '' }
}

export function freeeResult(value: unknown, payload: FreeeQuotePayload, expectedTotal: number, expectedTax: number): FreeeResult {
  const q = record(record(value).quotation)
  if (!Number.isSafeInteger(q.id) || Number(q.id) <= 0 || q.company_id !== payload.company_id) throw new Error('freeeの作成結果を特定できません。')
  let reportUrl = ''
  if (typeof q.report_url === 'string') {
    try { const url = new URL(q.report_url); if (url.protocol === 'https:' && (url.hostname === 'freee.co.jp' || url.hostname.endsWith('.freee.co.jp')) && !url.username && !url.password) reportUrl = url.toString() } catch { /* Do not expose an untrusted link. */ }
  }
  const lines = Array.isArray(q.lines) ? q.lines : []
  const matched = q.partner_id === payload.partner_id && q.total_amount === expectedTotal && q.amount_tax === expectedTax
    && lines.length === payload.lines.length && lines.every((value, i) => {
      const line = record(value), expected = payload.lines[i]
      return line.description === expected.description && line.quantity === expected.quantity && line.unit === expected.unit
        && Number(line.unit_price) === Number(expected.unit_price) && line.tax_rate === expected.tax_rate
        && line.reduced_tax_rate === expected.reduced_tax_rate && line.withholding === false
    })
  return { id: Number(q.id), number: typeof q.quotation_number === 'string' ? q.quotation_number : '', reportUrl,
    total: typeof q.total_amount === 'number' ? q.total_amount : null, tax: typeof q.amount_tax === 'number' ? q.amount_tax : null,
    verification: matched ? 'matched' : 'needs_review' }
}
export async function createFreeeQuotation(payload: FreeeQuotePayload, token: string, total: number, tax: number, fetcher: typeof fetch = fetch): Promise<FreeeResult> {
  let response: Response
  try {
    response = await fetcher('https://api.freee.co.jp/iv/quotations', {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(25_000),
    })
  } catch { throw new FreeeRequestError(false, '通信が中断されました。freeeで作成結果を確認し、作成済み見積書IDを照合してください。再作成は停止しています。') }
  if (!response.ok) {
    const retryable = [400, 401, 403, 404, 422, 429].includes(response.status)
    const details = retryable ? await rejectionDetails(response, token) : ''
    const guidance = response.status === 401 ? '「freee連携」で再認可してください。'
      : response.status === 403 ? 'freeeアプリの見積書作成権限を確認してください。'
      : '入力内容とfreee側の設定を確認してください。'
    throw new FreeeRequestError(retryable, retryable
      ? `freeeが登録を拒否しました（HTTP ${response.status}）。${guidance}${details}`
      : `freeeの登録結果が不明です（HTTP ${response.status}）。freeeで作成結果を確認してください。再作成は停止しています。`)
  }
  try { return freeeResult(await response.json(), payload, total, tax) }
  catch { throw new FreeeRequestError(false, 'freeeの応答を確認できません。作成済みの可能性があるため、見積書IDを照合してください。') }
}
