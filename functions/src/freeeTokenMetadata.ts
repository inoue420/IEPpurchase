import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { OAuthTokenMetadataStore } from './oauthTokenStore'

// Only a Secret Manager version identifier is stored here, never token values.
export const FREEE_TOKEN_METADATA_PATH = 'integrationSecrets/freeeOAuthTokens'
export function freeeTokenMetadata(parent: string): OAuthTokenMetadataStore {
  const ref = getFirestore().doc(FREEE_TOKEN_METADATA_PATH)
  function number(name: unknown): bigint {
    if (typeof name !== 'string' || !name.startsWith(`${parent}/versions/`)) throw new Error('freee token version metadata is invalid')
    const version = name.slice(`${parent}/versions/`.length)
    if (!/^[1-9]\d*$/.test(version)) throw new Error('freee token version metadata is invalid')
    return BigInt(version)
  }
  return {
    async read() {
      const snapshot = await ref.get()
      if (!snapshot.exists) return null
      const name: unknown = snapshot.get('currentVersion')
      number(name)
      return name as string
    },
    async advance(name) {
      const incoming = number(name)
      return getFirestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (snapshot.exists && number(snapshot.get('currentVersion')) >= incoming) return false
        transaction.set(ref, { currentVersion: name, updatedAt: FieldValue.serverTimestamp() })
        return true
      })
    },
  }
}
