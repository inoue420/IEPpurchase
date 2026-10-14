import { HttpsError } from 'firebase-functions/v2/https'

export interface FreeeAppCredentials { clientId: string; clientSecret: string }
export interface RakutenCredentials { applicationId: string; accessKey: string }

function parseCredentialRecord(value: string, message: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new HttpsError('failed-precondition', message) }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpsError('failed-precondition', message)
  return parsed as Record<string, unknown>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseFreeeAppCredentials(value: string): FreeeAppCredentials {
  const message = 'freeeの認証設定を確認してください。'
  const credentials = parseCredentialRecord(value, message)
  if (!nonEmptyString(credentials.clientId) || !nonEmptyString(credentials.clientSecret)) throw new HttpsError('failed-precondition', message)
  return { clientId: credentials.clientId, clientSecret: credentials.clientSecret }
}

export function parseRakutenCredentials(value: string): RakutenCredentials {
  const message = '楽天の認証設定を確認してください。'
  const credentials = parseCredentialRecord(value, message)
  if (!nonEmptyString(credentials.applicationId) || !nonEmptyString(credentials.accessKey)) throw new HttpsError('failed-precondition', message)
  return { applicationId: credentials.applicationId, accessKey: credentials.accessKey }
}
