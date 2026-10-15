import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseSupplierQuotePdfText, type SupplierQuotePdfRow } from './supplierQuotePdfParser'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()

export async function extractSupplierQuotePdf(file: File, password: string): Promise<{ rows: SupplierQuotePdfRow[]; text: string }> {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('PDFファイルを選択してください。')
  if (!password) throw new Error('PDFのパスワードを入力してください。')
  try {
    const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise
    const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      const content = await (await document.getPage(index + 1)).getTextContent()
      return content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('')
    }))
    const text = pages.join('\n'), rows = parseSupplierQuotePdfText(text)
    await document.destroy()
    return { rows, text }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('抽出できませんでした')) throw cause
    throw new Error('PDFを開けませんでした。パスワードまたはPDFファイルを確認してください。')
  }
}
