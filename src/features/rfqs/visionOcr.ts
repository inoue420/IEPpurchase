import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'

export interface VisionOcrResult { text: string; confidence: number | null; pageCount: number }
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon', 'application/pdf'])

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('ファイルを読み取れませんでした。'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') { reject(new Error('ファイルを読み取れませんでした。')); return }
      const comma = reader.result.indexOf(',')
      if (comma < 0) { reject(new Error('ファイルを読み取れませんでした。')); return }
      resolve(reader.result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

export async function extractVisionOcrText(file: File): Promise<VisionOcrResult> {
  if (!allowedTypes.has(file.type)) throw new Error('JPEG、PNG、GIF、WebP、BMP、ICO、PDFのいずれかを選択してください。')
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('ファイルは10MB以下にしてください。')
  const contentBase64 = await fileBase64(file)
  return (await httpsCallable<{ mimeType: string; contentBase64: string }, VisionOcrResult>(firebaseFunctions, 'extractVisionOcrText')({ mimeType: file.type, contentBase64 })).data
}
