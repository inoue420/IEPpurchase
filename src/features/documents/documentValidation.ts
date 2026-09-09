export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const attachmentAccept = 'application/pdf,image/*,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const allowedTypes = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function validateAttachmentFile(file: { size: number; type: string }): void {
  if (file.size <= 0) throw new Error('空のファイルは添付できません。')
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('添付ファイルは10MB以下にしてください。')
  if (!allowedTypes.has(file.type) && !file.type.startsWith('image/')) {
    throw new Error('PDF、画像、Excel（.xls/.xlsx）のみ添付できます。')
  }
}
