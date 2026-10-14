// Operator-only migration. Secret values stay in memory and are never logged or saved.
// prepare is additive/reversible. finalize requires an explicitly reviewed plan.
const fs = require('node:fs');
const path = require('node:path');
const auth = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
const PROJECT = 'ieppurchase';
const ROOT = `projects/${PROJECT}`;
const TOKEN = 'FREEE_OAUTH_TOKENS';
const META = `${ROOT}/databases/(default)/documents/integrationSecrets/freeeOAuthTokens`;
const OUTPUT = path.join(__dirname, '../tmp/secret-credentials-migration');
const OLD = ['FREEE_CLIENT_ID', 'FREEE_CLIENT_SECRET', 'RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'];
const KEEP = ['FREEE_APP_CREDENTIALS', 'RAKUTEN_CREDENTIALS', TOKEN, 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'GOOGLE_CLOUD_VISION_API_KEY'];
const FUNCTIONS = ['beginFreeeOAuth', 'freeeOAuthCallback', 'getFreeeConnectionStatus', 'searchFreeePartners', 'saveSalesQuotePricing', 'sendFreeeQuotation', 'reconcileFreeeQuotation', 'searchRakutenItems'];
const sm = new Client({ urlPrefix: 'https://secretmanager.googleapis.com', apiVersion: 'v1' });
const cf = new Client({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2' });
const cf1 = new Client({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v1' });
const run = new Client({ urlPrefix: 'https://run.googleapis.com', apiVersion: 'v2' });
const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const request = Client.prototype.request;
Client.prototype.request = async function(options) {
  try { return await request.call(this, { ...options, timeout: 25000, skipLog: { body: true, resBody: true, queryParams: true } }); }
  catch (error) {
    console.error(JSON.stringify({ apiRequestFailed: { method: options.method, path: options.path, status: error.status } }));
    throw error;
  }
};
const fail = message => { throw new Error(message); };
const number = name => { const match = /\/versions\/([1-9]\d*)$/.exec(name ?? ''); if (!match) fail('Numeric version is required'); return BigInt(match[1]); };
const parent = secret => `${ROOT}/secrets/${secret}`;
const active = version => ['ENABLED', 'DISABLED'].includes(version.state);
function canonicalSecretName(name) {
  if (typeof name !== 'string') return name;
  const match = /^projects\/([^/]+)\/secrets\/([^/]+)(\/versions\/[1-9]\d*)?$/.exec(name);
  if (!match || (match[1] !== PROJECT && !/^\d+$/.test(match[1]))) fail('Unexpected Secret resource returned by the API');
  return `${ROOT}/secrets/${match[2]}${match[3] ?? ''}`;
}
function canonicalBody(client, body) {
  if (client !== sm) return body;
  if (body.name) body.name = canonicalSecretName(body.name);
  for (const key of ['secrets', 'versions']) for (const item of body[key] ?? []) item.name = canonicalSecretName(item.name);
  return body;
}
async function get(client, name) { return canonicalBody(client, (await client.get(name)).body); }
async function list(client, name, field, queryParams = {}) {
  const items = []; let pageToken;
  do { const body = await getWithQuery(client, name, { ...queryParams, ...(pageToken ? { pageToken } : {}) }); if (body.unreachable?.length) fail('A region is unreachable; cleanup is unsafe'); items.push(...(body[field] ?? [])); pageToken = body.nextPageToken; } while (pageToken);
  return items;
}
async function getWithQuery(client, name, queryParams) { return canonicalBody(client, (await client.get(name, { queryParams })).body); }
async function payload(name) {
  const body = await get(sm, `${name}:access`);
  if (typeof body.payload?.data !== 'string') fail('Secret payload is unavailable');
  return Buffer.from(body.payload.data, 'base64').toString('utf8');
}
function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Credential structure is invalid'); return value; }
function credential(value) { if (typeof value !== 'string' || !value.trim()) fail('Credential field is invalid'); return value; }
function decode(value) { try { return record(JSON.parse(value)); } catch { fail('Credential JSON is invalid'); } }
async function snapshot() {
  const secrets = await list(sm, `${ROOT}/secrets`, 'secrets');
  const secretMetadata = [];
  for (const secret of secrets) {
    const versions = await list(sm, `${secret.name}/versions`, 'versions');
    secretMetadata.push({ name: secret.name, labels: secret.labels ?? {}, versions: versions.map(v => ({ name: v.name, state: v.state, createTime: v.createTime })) });
  }
  const functions = await list(cf, `${ROOT}/locations/-/functions`, 'functions', { filter: 'environment="GEN_2"' });
  const firstGeneration = await list(cf1, `${ROOT}/locations/-/functions`, 'functions');
  const targets = functions.filter(fn => FUNCTIONS.includes(fn.name.split('/').at(-1)));
  if (targets.length !== FUNCTIONS.length) fail('Expected migration functions are missing');
  const services = [];
  for (const fn of targets) {
    const service = await get(run, fn.serviceConfig.service);
    const traffic = service.trafficStatuses ?? service.traffic ?? [];
    const servingReferences = [];
    for (const revision of [...new Set(traffic.map(target => target.revision).filter(Boolean))]) {
      const name = revision.includes('/') ? revision : `${service.name}/revisions/${revision}`;
      const serving = await get(run, name);
      servingReferences.push({ revision: name, secretReferences: (serving.containers ?? []).flatMap(c => (c.env ?? []).filter(e => e.valueSource?.secretKeyRef).map(e => ({ key: e.name, ...e.valueSource.secretKeyRef }))) });
    }
    services.push({ name: service.name, traffic, servingReferences,
      secretReferences: (service.template?.containers ?? []).flatMap(c => (c.env ?? []).filter(e => e.valueSource?.secretKeyRef).map(e => ({ key: e.name, ...e.valueSource.secretKeyRef }))) });
  }
  return { checkedAt: new Date().toISOString(), secrets: secretMetadata,
    allFunctionReferences: [...functions, ...firstGeneration].flatMap(fn => (fn.serviceConfig?.secretEnvironmentVariables ?? fn.secretEnvironmentVariables ?? []).map(ref => ({ function: fn.name, ...ref }))),
    functions: targets.map(fn => ({ name: fn.name, state: fn.state, service: fn.serviceConfig.service, serviceAccount: fn.serviceConfig.serviceAccountEmail,
      secretReferences: fn.serviceConfig.secretEnvironmentVariables ?? [], revision: fn.serviceConfig.revision, pruneEnabled: fn.serviceConfig.environmentVariables?.FREEE_OAUTH_PRUNE_OLD_VERSIONS === 'true', siteUrl: fn.serviceConfig.environmentVariables?.RAKUTEN_SITE_URL })), services };
}
function save(name, value) { fs.mkdirSync(OUTPUT, { recursive: true }); fs.writeFileSync(path.join(OUTPUT, name), JSON.stringify(value, null, 2)); }
async function ensureBundle(secret, values) {
  let exists;
  try { exists = await get(sm, parent(secret)); } catch (error) { if (error.status !== 404) throw error; }
  if (!exists) await sm.post(`${ROOT}/secrets`, { replication: { automatic: {} }, labels: { 'firebase-managed': 'true' } }, { queryParams: { secretId: secret } });
  const versions = await list(sm, `${parent(secret)}/versions`, 'versions');
  if (!versions.length) {
    const created = canonicalBody(sm, (await sm.post(`${parent(secret)}:addVersion`, { payload: { data: Buffer.from(JSON.stringify(values)).toString('base64') } })).body);
    const copied = decode(await payload(created.name));
    if (Object.entries(values).some(([key, value]) => copied[key] !== value)) fail('Credential copy verification failed');
    return created.name;
  }
  const latest = await get(sm, `${parent(secret)}/versions/latest`);
  if (latest.state !== 'ENABLED') fail('Bundle latest version is unavailable');
  const copied = decode(await payload(latest.name));
  if (Object.entries(values).some(([key, value]) => copied[key] !== value)) fail('Existing bundle differs from deployed credentials');
  return latest.name;
}
async function grant(secret, role, accounts) {
  const policy = await getWithQuery(sm, `${parent(secret)}:getIamPolicy`, { 'options.requestedPolicyVersion': 3 });
  const bindings = policy.bindings ?? [];
  let binding = bindings.find(b => b.role === role && !b.condition);
  if (!binding) { binding = { role, members: [] }; bindings.push(binding); }
  let changed = false;
  for (const account of accounts) { const member = `serviceAccount:${account}`; if (!binding.members.includes(member)) { binding.members.push(member); changed = true; } }
  if (changed) await sm.post(`${parent(secret)}:setIamPolicy`, { policy: { ...policy, bindings }, updateMask: 'bindings' });
}
async function protectLabels(secret) {
  const metadata = await get(sm, parent(secret));
  const labels = { ...(metadata.labels ?? {}), 'iep-managed': 'migration-held' };
  delete labels['firebase-managed'];
  await sm.patch(parent(secret), { labels, etag: metadata.etag }, { queryParams: { updateMask: 'labels' } });
}
async function prepare() {
  const latest = await snapshot(); save('prepare-attempt.json', latest);
  const beforePath = path.join(OUTPUT, 'before.json');
  if (!fs.existsSync(beforePath)) save('before.json', latest);
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const find = id => before.functions.find(fn => fn.name.endsWith(`/${id}`));
  const bound = (fn, secret) => {
    const reference = fn.secretReferences.find(ref => ref.secret === secret);
    if (!reference || !/^[1-9]\d*$/.test(reference.version)) fail('Existing source binding is missing');
    return `${parent(secret)}/versions/${reference.version}`;
  };
  const begin = find('beginFreeeOAuth'), callback = find('freeeOAuthCallback'), rakuten = find('searchRakutenItems');
  if (bound(begin, 'FREEE_CLIENT_ID') !== bound(callback, 'FREEE_CLIENT_ID')) fail('freee start/callback source versions differ');
  const freeeValues = { clientId: credential(await payload(bound(callback, 'FREEE_CLIENT_ID'))), clientSecret: credential(await payload(bound(callback, 'FREEE_CLIENT_SECRET'))) };
  const rakutenValues = { applicationId: credential(await payload(bound(rakuten, 'RAKUTEN_APPLICATION_ID'))), accessKey: credential(await payload(bound(rakuten, 'RAKUTEN_ACCESS_KEY'))) };
  const freeeBundle = await ensureBundle('FREEE_APP_CREDENTIALS', freeeValues);
  const rakutenBundle = await ensureBundle('RAKUTEN_CREDENTIALS', rakutenValues);
  const tokenReaders = before.functions.filter(fn => fn.secretReferences.some(ref => ref.secret === TOKEN)).map(fn => fn.serviceAccount);
  if (tokenReaders.some(a => !a) || !callback.serviceAccount) fail('Service account metadata is missing');
  await grant(TOKEN, 'roles/secretmanager.secretAccessor', [...new Set([...tokenReaders, callback.serviceAccount])]);
  // Pruning remains off until the final reviewed cleanup step.
  await grant(TOKEN, 'roles/secretmanager.secretVersionManager', [callback.serviceAccount]);
  await grant('FREEE_APP_CREDENTIALS', 'roles/secretmanager.secretAccessor', [...new Set([begin.serviceAccount, callback.serviceAccount])]);
  await grant('RAKUTEN_CREDENTIALS', 'roles/secretmanager.secretAccessor', [rakuten.serviceAccount]);
  for (const secret of [...OLD, TOKEN]) await protectLabels(secret);
  const prepared = { preparedAt: new Date().toISOString(), bundles: [freeeBundle, rakutenBundle], credentialsCopiedExactly: true,
    protectedFromFirebasePrune: [...OLD, TOKEN], next: 'Deploy the eight migration functions with pruning disabled' };
  save('prepared.json', prepared); console.log(JSON.stringify(prepared, null, 2));
}
async function metadataDocument() { try { return await get(firestore, META); } catch (error) { if (error.status === 404) return null; throw error; } }
async function initializePointer() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const version = await get(sm, `${parent(TOKEN)}/versions/latest`);
    if (version.state !== 'ENABLED') fail('Current token version is unavailable');
    const tokens = decode(await payload(version.name));
    if (typeof tokens.accessToken !== 'string' || typeof tokens.refreshToken !== 'string') fail('Current token data is invalid');
    const document = await metadataDocument();
    const current = document?.fields?.currentVersion?.stringValue;
    if (current && !current.startsWith(`${parent(TOKEN)}/versions/`)) fail('Existing token metadata points to another Secret');
    if (current && number(current) > number(version.name)) { console.log(JSON.stringify({ tokenPointer: current, status: 'newer-pointer-preserved' })); return; }
    if (current === version.name) { console.log(JSON.stringify({ tokenPointer: current, status: 'pointer-already-current' })); return; }
    try {
      await firestore.post(`${ROOT}/databases/(default)/documents:commit`, { writes: [{ update: { name: META, fields: { currentVersion: { stringValue: version.name } } }, updateMask: { fieldPaths: ['currentVersion'] }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: document ? { updateTime: document.updateTime } : { exists: false } }] });
      console.log(JSON.stringify({ tokenPointer: version.name, status: 'pointer-initialized' })); return;
    } catch (error) { if (![409, 412].includes(error.status)) throw error; }
  }
  fail('Token metadata changed repeatedly; no older version was removed');
}
function assertDeployment(current) {
  if (current.allFunctionReferences.some(ref => [...OLD, TOKEN].includes(ref.secret))) fail('An old fixed reference remains in a deployed function');
  for (const fn of current.functions) {
    if (fn.state !== 'ACTIVE') fail('A migrated function is not ACTIVE');
    if (fn.secretReferences.some(ref => [...OLD, TOKEN].includes(ref.secret))) fail('An old fixed Secret reference is still deployed');
    const service = current.services.find(s => s.name === fn.service);
    if (!service || service.traffic.length !== 1 || service.traffic[0].percent !== 100) fail('Traffic is split; cleanup is unsafe');
    if (!service.traffic[0].revision?.endsWith(fn.revision) || service.servingReferences.length !== 1) fail('Serving revision does not match the deployed function');
    if (service.secretReferences.some(ref => [...OLD, TOKEN].some(old => ref.secret === old || ref.secret === parent(old)))) fail('Cloud Run still references an old Secret');
    if (service.servingReferences.some(revision => revision.secretReferences.some(ref => [...OLD, TOKEN].some(old => ref.secret === old || ref.secret === parent(old))))) fail('A serving revision still references an old Secret');
  }
}
async function verify() {
  const current = await snapshot(); save('after.json', current);
  assertDeployment(current);
  const previous = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'before.json'), 'utf8'));
  const proofPath = path.join(OUTPUT, 'credential-copy-proof.json');
  const priorProof = fs.existsSync(proofPath) ? JSON.parse(fs.readFileSync(proofPath, 'utf8')) : [];
  const comparisons = [];
  for (const [secret, oldSecret, field, id] of [['FREEE_APP_CREDENTIALS', 'FREEE_CLIENT_ID', 'clientId', 'freeeOAuthCallback'], ['FREEE_APP_CREDENTIALS', 'FREEE_CLIENT_SECRET', 'clientSecret', 'freeeOAuthCallback'], ['RAKUTEN_CREDENTIALS', 'RAKUTEN_APPLICATION_ID', 'applicationId', 'searchRakutenItems'], ['RAKUTEN_CREDENTIALS', 'RAKUTEN_ACCESS_KEY', 'accessKey', 'searchRakutenItems']]) {
    const source = previous.functions.find(fn => fn.name.endsWith(`/${id}`)).secretReferences.find(ref => ref.secret === oldSecret);
    const target = current.functions.find(fn => fn.name.endsWith(`/${id}`)).secretReferences.find(ref => ref.secret === secret);
    if (!target) fail('New credential binding is missing');
    const targetName = `${parent(secret)}/versions/${target.version}`;
    const sourceName = `${parent(oldSecret)}/versions/${source.version}`;
    const original = current.secrets.flatMap(s => s.versions).find(v => v.name === sourceName);
    if (original?.state === 'DESTROYED') {
      // Version payloads are immutable. A prior exact comparison remains valid
      // for the same source/target versions after the reviewed destruction.
      if (!priorProof.some(p => p.source === sourceName && p.target === targetName && p.field === field)) fail('Original comparison proof is missing');
    } else if (decode(await payload(targetName))[field] !== await payload(sourceName)) fail('Deployed credentials changed');
    comparisons.push({ source: sourceName, target: targetName, field });
  }
  save('credential-copy-proof.json', comparisons);
  const meta = await metadataDocument();
  const versionName = meta?.fields?.currentVersion?.stringValue;
  if (!versionName || !versionName.startsWith(`${parent(TOKEN)}/versions/`)) fail('Numeric token metadata is missing');
  number(versionName);
  const token = decode(await payload(versionName));
  const expiresAt = Date.parse(token.authorizedAt) + Number(token.expiresIn) * 1000;
  const tokenPolicy = await getWithQuery(sm, `${parent(TOKEN)}:getIamPolicy`, { 'options.requestedPolicyVersion': 3 });
  const readers = current.functions.filter(fn => ['getFreeeConnectionStatus', 'searchFreeePartners', 'saveSalesQuotePricing', 'sendFreeeQuotation', 'reconcileFreeeQuotation', 'freeeOAuthCallback'].some(id => fn.name.endsWith(`/${id}`)));
  const runtimeTokenAccessorConfigured = readers.every(fn => tokenPolicy.bindings?.some(binding => binding.role === 'roles/secretmanager.secretAccessor' && !binding.condition && binding.members.includes(`serviceAccount:${fn.serviceAccount}`)));
  if (!runtimeTokenAccessorConfigured) fail('An expected runtime token accessor binding is missing');
  const callback = current.functions.find(fn => fn.name.endsWith('/freeeOAuthCallback'));
  const runtimeTokenVersionManagerConfigured = tokenPolicy.bindings?.some(binding => binding.role === 'roles/secretmanager.secretVersionManager' && !binding.condition && binding.members.includes(`serviceAccount:${callback.serviceAccount}`)) ?? false;
  if (callback.pruneEnabled && !runtimeTokenVersionManagerConfigured) fail('The runtime token version manager binding is missing');
  const result = { verifiedAt: new Date().toISOString(), activeFunctions: current.functions.length, singleRevisionTraffic: true, oldBindingsRemoved: true, credentialsCopiedExactly: true,
    activeSecretVersions: current.secrets.flatMap(secret => secret.versions).filter(active).length,
    tokenPointer: versionName, tokenNotExpired: Number.isFinite(expiresAt) && expiresAt > Date.now(), runtimeTokenAccessorConfigured, runtimeTokenVersionManagerConfigured, pruneEnabled: callback.pruneEnabled };
  save('verified.json', result); console.log(JSON.stringify(result, null, 2)); return current;
}
async function cleanupPlan() {
  const current = await verify();
  const meta = await metadataDocument(); const tokenVersion = meta.fields.currentVersion.stringValue;
  const keep = [];
  for (const secret of KEEP) {
    if (secret === TOKEN) { keep.push(tokenVersion); continue; }
    const version = await get(sm, `${parent(secret)}/versions/latest`);
    if (version.state !== 'ENABLED') fail('A kept Secret version is unavailable'); keep.push(version.name);
  }
  const candidates = current.secrets.flatMap(secret => secret.versions.filter(active).map(v => v.name)).filter(name => !keep.includes(name));
  if (candidates.some(name => ![...OLD, ...KEEP].some(secret => name.startsWith(`${parent(secret)}/versions/`)))) fail('An unexpected Secret exists; cleanup needs a new review');
  const plan = { createdAt: new Date().toISOString(), project: PROJECT, keep, destroy: candidates, retainedVersions: keep.length,
    note: 'Irreversible. Old Cloud Run revisions cannot be restarted after their Secret versions are destroyed. Restore old static names from the bundles and redeploy old source if needed.' };
  save('cleanup-plan.json', plan); console.log(JSON.stringify(plan, null, 2));
}
async function smoke() {
  const current = await verify();
  const result = { checkedAt: new Date().toISOString() };
  const call = await fetch(`https://asia-northeast1-${PROJECT}.cloudfunctions.net/searchRakutenItems`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { keyword: 'ボルト' } }), signal: AbortSignal.timeout(30000) });
  result.unauthenticatedCallableStatus = call.status;
  if (call.status !== 401) fail('The deployed callable authentication check failed');
  const callback = await fetch(`https://asia-northeast1-${PROJECT}.cloudfunctions.net/freeeOAuthCallback`, { signal: AbortSignal.timeout(30000) });
  result.callbackWithoutStateStatus = callback.status;
  if (callback.status !== 400) fail('The deployed OAuth callback rejected an invalid request unexpectedly');
  const rakuten = current.functions.find(fn => fn.name.endsWith('/searchRakutenItems'));
  const binding = rakuten.secretReferences.find(ref => ref.secret === 'RAKUTEN_CREDENTIALS');
  const credentials = decode(await payload(`${parent('RAKUTEN_CREDENTIALS')}/versions/${binding.version}`));
  const { fetchRakutenItems } = require('../functions/lib/rakuten.js');
  const items = await fetchRakutenItems('ボルト', credentials.applicationId, credentials.accessKey, fetch, rakuten.siteUrl);
  result.liveRakutenSearch = { success: true, returnedItems: items.items.length };
  try {
    const iam = new Client({ urlPrefix: 'https://iamcredentials.googleapis.com', apiVersion: 'v1' });
    const account = current.functions.find(fn => fn.name.endsWith('/getFreeeConnectionStatus')).serviceAccount;
    const minted = (await iam.post(`projects/-/serviceAccounts/${account}:generateAccessToken`, { scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '300s' })).body;
    if (typeof minted.accessToken !== 'string') fail('Runtime credential check is unavailable');
    const meta = await metadataDocument(); const versionName = meta.fields.currentVersion.stringValue;
    const headers = { authorization: `Bearer ${minted.accessToken}` };
    const secretResponse = await fetch(`https://secretmanager.googleapis.com/v1/${versionName}:access`, { headers, signal: AbortSignal.timeout(20000) });
    const metadataResponse = await fetch(`https://firestore.googleapis.com/v1/${META}`, { headers, signal: AbortSignal.timeout(20000) });
    if (!secretResponse.ok || !metadataResponse.ok) fail('Runtime token or metadata read permission failed');
    // Do not retain or print either response body or the generated access token.
    result.runtimeTokenAndMetadataRead = { success: true, secretStatus: secretResponse.status, metadataStatus: metadataResponse.status };
  } catch (error) {
    result.runtimeTokenAndMetadataRead = { success: false, status: error.status ?? null, reason: 'Service account impersonation or its read check is unavailable' };
  }
  save('smoke.json', result); console.log(JSON.stringify(result, null, 2));
}
async function finalize() {
  if (process.argv[3] !== '--approved-plan') fail('Use finalize --approved-plan only after human review of cleanup-plan.json');
  const approved = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'cleanup-plan.json'), 'utf8'));
  if (approved.project !== PROJECT || !Array.isArray(approved.keep) || !Array.isArray(approved.destroy) || approved.keep.length !== KEEP.length || new Set(approved.keep).size !== KEEP.length) fail('The approved cleanup plan is invalid');
  if (!KEEP.every(secret => approved.keep.filter(name => typeof name === 'string' && name.startsWith(`${parent(secret)}/versions/`)).length === 1)) fail('The approved keep list does not contain the expected Secrets');
  const current = await snapshot();
  assertDeployment(current);
  const versionMetadata = current.secrets.flatMap(secret => secret.versions);
  if (approved.keep.some(name => versionMetadata.find(version => version.name === name)?.state !== 'ENABLED')) fail('A kept Secret version is not enabled');
  const meta = await metadataDocument();
  if (!approved.keep.includes(meta?.fields?.currentVersion?.stringValue)) fail('Token version changed; review a fresh cleanup plan');
  const references = current.allFunctionReferences.map(ref => `${parent(ref.secret)}/versions/${ref.version}`);
  if (references.some(name => approved.destroy.includes(name))) fail('A deployed function still needs a destruction candidate');
  const activeNames = current.secrets.flatMap(s => s.versions.filter(active).map(v => v.name));
  if (activeNames.some(name => !approved.keep.includes(name) && !approved.destroy.includes(name))) fail('New versions exist; review a fresh cleanup plan');
  for (const name of approved.destroy) {
    if (typeof name !== 'string' || approved.keep.includes(name) || ![...OLD, ...KEEP].some(secret => name.startsWith(`${parent(secret)}/versions/`))) fail('Invalid destruction plan');
    number(name);
    const freshMeta = await metadataDocument();
    if (name === freshMeta?.fields?.currentVersion?.stringValue) fail('Destruction candidate became current');
    const version = await get(sm, name);
    if (active(version)) await sm.post(`${name}:destroy`, {});
  }
  const after = await snapshot();
  const remaining = after.secrets.flatMap(s => s.versions.filter(active).map(v => v.name));
  const result = { finishedAt: new Date().toISOString(), activeVersions: remaining.length, retained: remaining, destroyedCount: approved.destroy.length };
  save('finalized.json', result); console.log(JSON.stringify(result, null, 2));
}
async function auditStorage() {
  // Metadata only: no payload access, mutation, or live external-service calls.
  const secrets = await list(sm, `${ROOT}/secrets`, 'secrets');
  const activeVersions = [];
  for (const secret of secrets) {
    const versions = await list(sm, `${secret.name}/versions`, 'versions');
    activeVersions.push(...versions.filter(active).map(version => ({ name: version.name, state: version.state })));
  }
  const meta = await metadataDocument();
  const callback = await get(cf, `${ROOT}/locations/asia-northeast1/functions/freeeOAuthCallback`);
  const tokenPointer = meta?.fields?.currentVersion?.stringValue;
  const result = { checkedAt: new Date().toISOString(), activeSecretVersions: activeVersions.length,
    tokenPointer, activeTokenVersions: activeVersions.filter(version => version.name.startsWith(`${parent(TOKEN)}/versions/`)),
    currentTokenEnabled: activeVersions.some(version => version.name === tokenPointer && version.state === 'ENABLED'),
    pruneEnabled: callback.serviceConfig?.environmentVariables?.FREEE_OAUTH_PRUNE_OLD_VERSIONS === 'true',
    oldStaticActiveVersions: activeVersions.filter(version => OLD.some(secret => version.name.startsWith(`${parent(secret)}/versions/`))).length };
  save('user-confirmation-audit.json', result); console.log(JSON.stringify(result, null, 2));
}
async function main() {
  const account = auth.getProjectDefaultAccount(path.resolve(__dirname, '..')) ?? auth.getGlobalDefaultAccount();
  if (!account) fail('Firebase CLI login is required');
  await requireAuth({ project: PROJECT, nonInteractive: true, user: account.user, tokens: account.tokens });
  const action = process.argv[2];
  if (action === 'prepare') return prepare();
  if (action === 'initialize-token-pointer') return initializePointer();
  if (action === 'verify') return verify();
  if (action === 'cleanup-plan') return cleanupPlan();
  if (action === 'smoke') return smoke();
  if (action === 'check-cutover') { await initializePointer(); await cleanupPlan(); return smoke(); }
  if (action === 'finalize') return finalize();
  if (action === 'audit-storage') return auditStorage();
  fail('Expected prepare, initialize-token-pointer, verify, smoke, cleanup-plan, or finalize --approved-plan');
}
main().catch(error => { console.error(JSON.stringify({ error: 'Secret migration stopped; no credential values are displayed.', status: error?.status ?? null, reason: error?.status ? 'Cloud API request failed' : error.message })); process.exitCode = 1; });
