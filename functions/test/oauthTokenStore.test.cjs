const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readOAuthTokenPayload, storeOAuthTokenPayload } = require('../lib/oauthTokenStore.js')

const parent = 'projects/dummy-project/secrets/FREEE_OAUTH_TOKENS'
const version = number => `${parent}/versions/${number}`
const payload = JSON.stringify({ accessToken: 'dummy-access-token', refreshToken: 'dummy-refresh-token' })
const response = value => [{ payload: { data: Buffer.from(value) } }]

function managerFixture(overrides = {}) {
  const calls = { added: [], accessed: [], listed: [], destroyed: [] }
  return {
    calls,
    manager: {
      addSecretVersion: async request => { calls.added.push(request); return [{ name: version(5) }] },
      accessSecretVersion: async request => { calls.accessed.push(request.name); return response(payload) },
      listSecretVersions: async request => { calls.listed.push(request); return [[]] },
      destroySecretVersion: async request => { calls.destroyed.push(request.name); return [{}] },
      ...overrides,
    },
  }
}

function metadataFixture(initial = null, overrides = {}) {
  let pointer = initial
  const advanced = []
  return {
    advanced,
    metadata: {
      read: async () => pointer,
      advance: async name => { advanced.push(name); pointer = name; return true },
      ...overrides,
    },
    pointer: () => pointer,
  }
}

async function assertSafeFailure(promise) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof Error)
    assert.equal(error.cause, undefined)
    for (const secret of ['dummy-access-token', 'dummy-refresh-token', 'dummy-upstream-secret']) {
      assert.ok(!error.message.includes(secret))
      assert.ok(!String(error.stack).includes(secret))
      assert.ok(!JSON.stringify(error).includes(secret))
    }
    return true
  })
}

test('reads latest only before the numeric metadata pointer has been migrated', async () => {
  const { manager, calls } = managerFixture()
  const { metadata } = metadataFixture()
  assert.equal(await readOAuthTokenPayload(manager, parent, metadata), payload)
  assert.deepEqual(calls.accessed, [`${parent}/versions/latest`])
  const pinned = metadataFixture(version(4))
  assert.equal(await readOAuthTokenPayload(manager, parent, pinned.metadata), payload)
  assert.deepEqual(calls.accessed, [`${parent}/versions/latest`, version(4)])
})

test('retries a failed old access after a concurrent authorization advances the pointer', async () => {
  let pointer = version(4)
  const attempted = []
  const { manager } = managerFixture({ accessSecretVersion: async ({ name }) => {
    attempted.push(name)
    if (name === version(4)) { pointer = version(5); throw new Error('dummy-upstream-secret') }
    return response(payload)
  } })
  const metadata = { read: async () => pointer, advance: async () => true }
  assert.equal(await readOAuthTokenPayload(manager, parent, metadata), payload)
  assert.deepEqual(attempted, [version(4), version(5)])
})

test('does not retry the same failing pointer or expose upstream errors', async () => {
  const { manager } = managerFixture({ accessSecretVersion: async () => { throw new Error('dummy-upstream-secret') } })
  const { metadata } = metadataFixture(version(4))
  await assertSafeFailure(readOAuthTokenPayload(manager, parent, metadata))
  const invalid = metadataFixture('projects/other/secrets/TOKENS/versions/4')
  await assertSafeFailure(readOAuthTokenPayload(manager, parent, invalid.metadata))
  const numericProject = metadataFixture('projects/1234567890/secrets/FREEE_OAUTH_TOKENS/versions/4')
  const untouched = managerFixture()
  await assertSafeFailure(readOAuthTokenPayload(untouched.manager, parent, numericProject.metadata))
  assert.deepEqual(untouched.calls.accessed, [])
  const badMetadata = metadataFixture(null, { read: async () => { throw new Error('dummy-upstream-secret') } })
  await assertSafeFailure(readOAuthTokenPayload(manager, parent, badMetadata.metadata))
})

test('bounds retries when the pointer keeps changing', async () => {
  let pointer = 1
  let accesses = 0
  const { manager } = managerFixture({ accessSecretVersion: async () => { accesses++; pointer++; throw new Error('dummy-upstream-secret') } })
  const metadata = { read: async () => version(pointer), advance: async () => true }
  await assertSafeFailure(readOAuthTokenPayload(manager, parent, metadata))
  assert.equal(accesses, 4)
})

test('verifies the exact numeric version before advancing metadata and gated cleanup', async () => {
  const { manager, calls } = managerFixture()
  const { metadata, advanced, pointer } = metadataFixture(version(4))
  await storeOAuthTokenPayload(manager, parent, payload, metadata, false)
  assert.equal(calls.added[0].parent, parent)
  assert.equal(calls.added[0].payload.data.toString('utf8'), payload)
  assert.deepEqual(calls.accessed, [version(5)])
  assert.deepEqual(advanced, [version(5)])
  assert.equal(pointer(), version(5))
  assert.deepEqual(calls.listed, [])
  assert.deepEqual(calls.destroyed, [])
})

test('only destroys lower enabled or disabled versions of the same secret sequentially', async () => {
  const destroyed = []
  let active = 0
  let maximum = 0
  const { manager } = managerFixture({
    listSecretVersions: async () => [[
      { name: version(1), state: 'ENABLED' },
      { name: version(2), state: 'DISABLED' },
      { name: version(3), state: 1 },
      { name: version(4), state: 2 },
      { name: version(5), state: 'ENABLED' },
      { name: version(6), state: 'ENABLED' },
      { name: version(99), state: 'DISABLED' },
      { name: version(0), state: 'ENABLED' },
      { name: `${parent}/versions/latest`, state: 'ENABLED' },
      { name: 'projects/other/secrets/FREEE_OAUTH_TOKENS/versions/1', state: 'ENABLED' },
      { name: 'projects/dummy-project/secrets/OTHER/versions/1', state: 'ENABLED' },
      { name: version(1), state: 'DESTROYED' },
      { name: version(2), state: 3 },
    ]],
    destroySecretVersion: async ({ name }) => {
      active++; maximum = Math.max(maximum, active)
      await Promise.resolve()
      destroyed.push(name); active--
      return [{}]
    },
  })
  await storeOAuthTokenPayload(manager, parent, payload, metadataFixture(version(4)).metadata, true)
  assert.deepEqual(destroyed, [version(1), version(2), version(3), version(4)])
  assert.equal(maximum, 1)
})

test('normalizes numeric project names returned by add and list APIs to the requested project', async () => {
  const numericName = number => `projects/1234567890/secrets/FREEE_OAUTH_TOKENS/versions/${number}`
  const { manager, calls } = managerFixture({
    addSecretVersion: async () => [{ name: numericName(5) }],
    listSecretVersions: async () => [[
      { name: numericName(4), state: 'ENABLED' },
      { name: numericName(5), state: 'ENABLED' },
      { name: numericName(6), state: 'ENABLED' },
      { name: 'projects/different-project/secrets/FREEE_OAUTH_TOKENS/versions/3', state: 'ENABLED' },
      { name: 'projects/1234567890/secrets/OTHER/versions/2', state: 'ENABLED' },
      { name: 'projects/1234567890/secrets/FREEE_OAUTH_TOKENS/versions/latest', state: 'ENABLED' },
    ]],
  })
  const { metadata, advanced } = metadataFixture(version(4))
  await storeOAuthTokenPayload(manager, parent, payload, metadata, true)
  assert.deepEqual(calls.accessed, [version(5)])
  assert.deepEqual(advanced, [version(5)])
  assert.deepEqual(calls.destroyed, [version(4)])
})

test('readback mismatch and readback access failure never advance metadata or destroy old versions', async () => {
  for (const accessSecretVersion of [async () => response('different-token'), async () => { throw new Error('dummy-upstream-secret') }]) {
    const { manager, calls } = managerFixture({ accessSecretVersion })
    const { metadata, advanced } = metadataFixture(version(4))
    await assertSafeFailure(storeOAuthTokenPayload(manager, parent, payload, metadata, true))
    assert.deepEqual(advanced, [])
    assert.deepEqual(calls.listed, [])
    assert.deepEqual(calls.destroyed, [])
  }
})

test('failed metadata update never destroys old versions', async () => {
  for (const advance of [async () => { throw new Error('dummy-upstream-secret') }, async () => false]) {
    const { manager, calls } = managerFixture()
    const { metadata } = metadataFixture(version(4), { advance })
    await assertSafeFailure(storeOAuthTokenPayload(manager, parent, payload, metadata, true))
    assert.deepEqual(calls.listed, [])
    assert.deepEqual(calls.destroyed, [])
  }
})

test('accepts a concurrent newer pointer when its cleanup already destroyed the new readback target', async () => {
  const { manager, calls } = managerFixture({ accessSecretVersion: async () => { throw new Error('dummy-upstream-secret') } })
  const { metadata, advanced } = metadataFixture(version(6))
  await storeOAuthTokenPayload(manager, parent, payload, metadata, true)
  assert.deepEqual(advanced, [])
  assert.deepEqual(calls.listed, [])
  assert.deepEqual(calls.destroyed, [])
})

test('does not roll back an already newer metadata pointer', async () => {
  const { manager, calls } = managerFixture({ listSecretVersions: async () => [[{ name: version(6), state: 1 }, { name: version(4), state: 1 }]] })
  const { metadata } = metadataFixture(version(6), { advance: async () => false })
  await storeOAuthTokenPayload(manager, parent, payload, metadata, true)
  assert.equal(await metadata.read(), version(6))
  assert.deepEqual(calls.destroyed, [version(4)])
})

test('rejects an invalid returned version name and hides add failures', async () => {
  for (const name of [`${parent}/versions/latest`, version(0), `${parent}/versions/05`, 'projects/other/secrets/TOKENS/versions/5', 'projects/other/secrets/FREEE_OAUTH_TOKENS/versions/5', 'projects/1234567890/secrets/OTHER/versions/5', null]) {
    const { manager, calls } = managerFixture({ addSecretVersion: async () => [{ name }] })
    const { metadata, advanced } = metadataFixture(version(4))
    await assertSafeFailure(storeOAuthTokenPayload(manager, parent, payload, metadata, true))
    assert.deepEqual(calls.accessed, [])
    assert.deepEqual(advanced, [])
    assert.deepEqual(calls.destroyed, [])
  }
  const { manager } = managerFixture({ addSecretVersion: async () => { throw new Error('dummy-upstream-secret') } })
  await assertSafeFailure(storeOAuthTokenPayload(manager, parent, payload, metadataFixture().metadata, true))
})

test('cleanup failures preserve OAuth success and warn without secret or upstream details', async t => {
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const { manager } = managerFixture({
    listSecretVersions: async () => [[{ name: version(4), state: 1 }]],
    destroySecretVersion: async () => { throw new Error('dummy-upstream-secret') },
  })
  const metadata = metadataFixture(version(4))
  await storeOAuthTokenPayload(manager, parent, payload, metadata.metadata, true)
  assert.equal(metadata.pointer(), version(5))
  const { manager: listFailure } = managerFixture({ listSecretVersions: async () => { throw new Error('dummy-upstream-secret') } })
  await storeOAuthTokenPayload(listFailure, parent, payload, metadataFixture().metadata, true)
  assert.equal(warnings.length, 2)
  for (const args of warnings) {
    assert.equal(args.length, 1)
    assert.equal(typeof args[0], 'string')
    assert.ok(!args[0].includes('dummy-upstream-secret'))
    assert.ok(!args[0].includes('dummy-access-token'))
    assert.ok(!args[0].includes('dummy-refresh-token'))
  }
})
