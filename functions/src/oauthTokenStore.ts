import type { SecretManagerServiceClient } from '@google-cloud/secret-manager'

export type OAuthTokenSecretManager = Pick<SecretManagerServiceClient, 'addSecretVersion' | 'accessSecretVersion' | 'listSecretVersions' | 'destroySecretVersion'>
export interface OAuthTokenMetadataStore {
  read(): Promise<string | null>
  advance(versionName: string): Promise<boolean>
}

const READ_ERROR = 'freeeの接続情報を読み取れませんでした。'
const STORE_ERROR = 'freeeの接続情報を安全に保存できませんでした。'
const CLEANUP_WARNING = 'freeeの旧接続情報の整理に失敗しました。'

function versionNumber(parent: string, name: string | null | undefined): bigint | null {
  const prefix = `${parent}/versions/`
  if (typeof name !== 'string' || !name.startsWith(prefix)) return null
  const suffix = name.slice(prefix.length)
  return /^[1-9]\d*$/.test(suffix) ? BigInt(suffix) : null
}

function apiVersionName(parent: string, name: string | null | undefined): string | null {
  const requested = /^projects\/([^/]+)\/secrets\/([^/]+)$/.exec(parent)
  const returned = typeof name === 'string' ? /^projects\/([^/]+)\/secrets\/([^/]+)\/versions\/([1-9]\d*)$/.exec(name) : null
  if (!requested || !returned || requested[2] !== returned[2]) return null
  // Secret Manager canonicalizes project IDs to numeric project numbers in its
  // responses. Accept that form only at the trusted API response boundary;
  // stored metadata must still use the exact requested project and secret.
  if (returned[1] !== requested[1] && !/^\d+$/.test(returned[1])) return null
  return `${parent}/versions/${returned[3]}`
}

function decodePayload(data: Uint8Array | string | null | undefined): string {
  if (typeof data === 'string') return Buffer.from(data, 'base64').toString('utf8')
  if (data instanceof Uint8Array) return Buffer.from(data).toString('utf8')
  throw new Error(READ_ERROR)
}

export async function readOAuthTokenPayload(manager: OAuthTokenSecretManager, parent: string, metadata: OAuthTokenMetadataStore): Promise<string> {
  try {
    let pointer = await metadata.read()
    for (let attempt = 0; attempt < 4; attempt++) {
      if (pointer !== null && versionNumber(parent, pointer) === null) throw new Error(READ_ERROR)
      try {
        const [version] = await manager.accessSecretVersion({ name: pointer ?? `${parent}/versions/latest` })
        return decodePayload(version.payload?.data)
      } catch {
        const nextPointer = await metadata.read()
        if (nextPointer === pointer) throw new Error(READ_ERROR)
        pointer = nextPointer
      }
    }
  } catch {
    throw new Error(READ_ERROR)
  }
  throw new Error(READ_ERROR)
}

async function pruneOlderVersions(manager: OAuthTokenSecretManager, parent: string, newVersion: bigint): Promise<void> {
  try {
    const [versions] = await manager.listSecretVersions({ parent })
    let failed = false
    // Numeric version names are immutable. Never delete the new version or a
    // higher version that another concurrent authorization may have created.
    for (const version of versions) {
      const name = apiVersionName(parent, version.name)
      const number = versionNumber(parent, name)
      if (number === null || number >= newVersion || ![1, 2, 'ENABLED', 'DISABLED'].includes(version.state ?? 0)) continue
      try { await manager.destroySecretVersion({ name }) } catch { failed = true }
    }
    if (failed) console.warn(CLEANUP_WARNING)
  } catch {
    console.warn(CLEANUP_WARNING)
  }
}

export async function storeOAuthTokenPayload(manager: OAuthTokenSecretManager, parent: string, payload: string, metadata: OAuthTokenMetadataStore, prune: boolean): Promise<void> {
  let newVersion: bigint
  try {
    const [added] = await manager.addSecretVersion({ parent, payload: { data: Buffer.from(payload, 'utf8') } })
    const name = apiVersionName(parent, added.name)
    const parsedVersion = versionNumber(parent, name)
    if (parsedVersion === null || !name) throw new Error(STORE_ERROR)
    newVersion = parsedVersion
    let readBack: string
    try {
      const [stored] = await manager.accessSecretVersion({ name })
      readBack = decodePayload(stored.payload?.data)
    } catch {
      const currentVersion = versionNumber(parent, await metadata.read())
      // A concurrent newer authorization may already have verified its token,
      // advanced the pointer and destroyed this now-obsolete version.
      if (currentVersion !== null && currentVersion > newVersion) return
      throw new Error(STORE_ERROR)
    }
    if (readBack !== payload) throw new Error(STORE_ERROR)
    if (!await metadata.advance(name)) {
      const currentVersion = versionNumber(parent, await metadata.read())
      if (currentVersion === null || currentVersion < newVersion) throw new Error(STORE_ERROR)
    }
  } catch {
    throw new Error(STORE_ERROR)
  }
  if (prune) await pruneOlderVersions(manager, parent, newVersion)
}
