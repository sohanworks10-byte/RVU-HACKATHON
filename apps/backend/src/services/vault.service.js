import fs from 'fs';
import path from 'path';

const FILE_STORE_PATH = path.resolve('./tmp/dev-secrets.json');

function ensureFileStore() {
  const dir = path.dirname(FILE_STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE_STORE_PATH)) fs.writeFileSync(FILE_STORE_PATH, JSON.stringify({}), 'utf8');
}

function readFileStore() {
  ensureFileStore();
  try {
    return JSON.parse(fs.readFileSync(FILE_STORE_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeFileStore(data) {
  ensureFileStore();
  fs.writeFileSync(FILE_STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function keyFor(projectId, name) {
  return `${projectId || 'global'}:${name}`;
}

function isVaultConfigured() {
  return !!(process.env.VAULT_ADDR && process.env.VAULT_TOKEN);
}

async function vaultRequest(method, apiPath, body) {
  const base = String(process.env.VAULT_ADDR || '').replace(/\/+$/, '');
  const url = base + apiPath;
  const headers = {
    'Content-Type': 'application/json',
    'X-Vault-Token': String(process.env.VAULT_TOKEN || ''),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vault request failed (${res.status}): ${text || res.statusText}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export function maskSecretsInLog(input, secretValues = []) {
  let out = String(input ?? '');
  for (const v of secretValues || []) {
    if (!v) continue;
    const s = String(v);
    if (!s.trim()) continue;
    out = out.split(s).join('***');
  }
  return out;
}

export async function putSecret(projectId, name, value, { provider = 'auto', vaultPath } = {}) {
  const useVault = provider === 'vault' || (provider === 'auto' && isVaultConfigured());
  if (useVault) {
    const p = vaultPath || `/v1/secret/data/devyntra/${encodeURIComponent(String(projectId || 'global'))}/${encodeURIComponent(String(name))}`;
    await vaultRequest('POST', p, { data: { value: String(value) } });
    return { provider: 'vault', path: p };
  }

  const store = readFileStore();
  store[keyFor(projectId, name)] = String(value);
  writeFileStore(store);
  return { provider: 'file', path: FILE_STORE_PATH };
}

export async function getSecret(projectId, name, { provider = 'auto', vaultPath } = {}) {
  const useVault = provider === 'vault' || (provider === 'auto' && isVaultConfigured());
  if (useVault) {
    const p = vaultPath || `/v1/secret/data/devyntra/${encodeURIComponent(String(projectId || 'global'))}/${encodeURIComponent(String(name))}`;
    const json = await vaultRequest('GET', p);
    const v = json && json.data && json.data.data ? json.data.data.value : null;
    return v == null ? null : String(v);
  }

  const store = readFileStore();
  const v = store[keyFor(projectId, name)];
  return v == null ? null : String(v);
}

export async function deleteSecret(projectId, name, { provider = 'auto', vaultPath } = {}) {
  const useVault = provider === 'vault' || (provider === 'auto' && isVaultConfigured());
  if (useVault) {
    const p = vaultPath || `/v1/secret/metadata/devyntra/${encodeURIComponent(String(projectId || 'global'))}/${encodeURIComponent(String(name))}`;
    await vaultRequest('DELETE', p);
    return true;
  }

  const store = readFileStore();
  delete store[keyFor(projectId, name)];
  writeFileStore(store);
  return true;
}
