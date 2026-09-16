import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseSupplierQuotePdfText, type SupplierQuotePdfRow } from './supplierQuotePdfParser'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()

export async function extractSupplierQuotePdfRows(file: File, password: string): Promise<SupplierQuotePdfRow[]> {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('PDFファイルを選択してください。')
  if (!password) throw new Error('PDFのパスワードを入力してください。')
  try {
    const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise
    const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      const content = await (await document.getPage(index + 1)).getTextContent()
      return content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('')
    }))
    const rows = parseSupplierQuotePdfText(pages.join('\n'))
    if (rows.length === 0) throw new Error('品番と仕切単価を抽出できませんでした。帳票形式またはパスワードを確認してください。')
    return rows
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('抽出できませんでした')) throw cause
    throw new Error('PDFを開けませんでした。パスワードまたはPDFファイルを確認してください。')
  }
}
