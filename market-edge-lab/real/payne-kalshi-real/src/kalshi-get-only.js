const KALSHI_ORIGIN = 'https://external-api.kalshi.com';
const ALLOWED_METHOD = 'GET';

function pemToArrayBuffer(pem) {
  const body = String(pem || '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export async function kalshiGetOnlyHeaders(env, method, path) {
  if (String(method || '').toUpperCase() !== ALLOWED_METHOD) throw new Error('PAYNE_KALSHI_GET_ONLY_METHOD_REQUIRED');
  if (!env?.KALSHI_EXECUTION_KEY_ID || !env?.KALSHI_EXECUTION_PRIVATE_KEY) throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');
  const keyData = pemToArrayBuffer(env.KALSHI_EXECUTION_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const ts = String(Date.now());
  const signPath = String(path).split('?')[0];
  const payload = new TextEncoder().encode(ts + ALLOWED_METHOD + signPath);
  const signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, payload);
  let binary = '';
  for (const b of new Uint8Array(signature)) binary += String.fromCharCode(b);
  return {
    accept: 'application/json',
    'KALSHI-ACCESS-KEY': String(env.KALSHI_EXECUTION_KEY_ID).trim(),
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': btoa(binary),
  };
}

export async function kalshiGetOnly(env, path, fetchImpl = fetch) {
  if (!String(path || '').startsWith('/trade-api/')) throw new Error('PAYNE_KALSHI_GET_ONLY_PATH_REJECTED');
  const headers = await kalshiGetOnlyHeaders(env, ALLOWED_METHOD, path);
  return fetchImpl(KALSHI_ORIGIN + path, { method: ALLOWED_METHOD, headers });
}

export function classifyIndex3(balanceBody) {
  const rows = Array.isArray(balanceBody?.balance_breakdown) ? balanceBody.balance_breakdown : null;
  if (!rows) return 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT';
  return rows.some(row => Number(row?.exchange_index) === 3)
    ? 'READ-PROVEN AVAILABLE'
    : 'READ-PROVEN UNAVAILABLE';
}

export async function kalshiReadOnlyProof(env, fetchImpl = fetch) {
  const path = '/trade-api/v2/portfolio/balance';
  try {
    const response = await kalshiGetOnly(env, path, fetchImpl);
    const body = await response.json().catch(() => ({}));
    const rows = Array.isArray(body?.balance_breakdown) ? body.balance_breakdown : null;
    return {
      ok: response.ok,
      mode: 'GET_ONLY',
      authentication: response.ok ? 'PROVEN' : 'NOT_PROVEN',
      authenticatedGet: response.ok ? 'PROVEN' : 'NOT_PROVEN',
      httpStatus: response.status,
      balanceBreakdownPresent: Array.isArray(rows),
      balanceRecordCount: Array.isArray(rows) ? rows.length : null,
      index3: classifyIndex3(body),
      secretsExposed: false,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'GET_ONLY',
      authentication: 'NOT_PROVEN',
      authenticatedGet: 'NOT_PROVEN',
      errorType: error?.name || 'Error',
      message: 'Authenticated Kalshi GET proof failed. Secret values suppressed.',
      index3: 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT',
      secretsExposed: false,
    };
  }
}
