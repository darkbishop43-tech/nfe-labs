const KALSHI_ORIGIN = 'https://external-api.kalshi.com';
const ALLOWED_METHOD = 'GET';

function derLength(n) {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derWrap(tag, content) {
  const len = derLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

function pkcs1ToPkcs8(pkcs1) {
  const version = new Uint8Array([0x02,0x01,0x00]);
  const rsaAlgId = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  const octet = derWrap(0x04, pkcs1);
  const inner = new Uint8Array(version.length + rsaAlgId.length + octet.length);
  inner.set(version, 0);
  inner.set(rsaAlgId, version.length);
  inner.set(octet, version.length + rsaAlgId.length);
  return derWrap(0x30, inner);
}

function privateKeyEnvelope(pem) {
  const text = String(pem || '').trim();
  if (/-----BEGIN RSA PRIVATE KEY-----/.test(text)) return 'PKCS1';
  if (/-----BEGIN PRIVATE KEY-----/.test(text)) return 'PKCS8';
  return 'UNKNOWN';
}

function decodePem(pem) {
  const text = String(pem || '').trim();
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(text);
  const body = text
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return isPkcs1 ? pkcs1ToPkcs8(bytes).buffer : bytes.buffer;
}

function setDiagnostic(diagnostic, values) {
  if (diagnostic && typeof diagnostic === 'object') Object.assign(diagnostic, values);
}

export async function kalshiGetOnlyHeaders(env, method, path, diagnostic = null) {
  if (String(method || '').toUpperCase() !== ALLOWED_METHOD) throw new Error('PAYNE_KALSHI_GET_ONLY_METHOD_REQUIRED');

  const credentialsPresent = Boolean(env?.KALSHI_EXECUTION_KEY_ID && env?.KALSHI_EXECUTION_PRIVATE_KEY);
  setDiagnostic(diagnostic, {
    credentialsPresent,
    privateKeyEnvelope: privateKeyEnvelope(env?.KALSHI_EXECUTION_PRIVATE_KEY),
    failureStage: 'CREDENTIAL_CHECK',
    errorClass: null,
  });
  if (!credentialsPresent) throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');

  let keyData;
  try {
    setDiagnostic(diagnostic, { failureStage:'PEM_DECODE' });
    keyData = decodePem(env.KALSHI_EXECUTION_PRIVATE_KEY);
  } catch (error) {
    setDiagnostic(diagnostic, { errorClass:error?.name || 'Error' });
    throw error;
  }

  let key;
  try {
    setDiagnostic(diagnostic, { failureStage:'KEY_IMPORT' });
    key = await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (error) {
    setDiagnostic(diagnostic, { errorClass:error?.name || 'Error' });
    throw error;
  }

  const ts = String(Date.now());
  const signPath = String(path).split('?')[0];
  const payload = new TextEncoder().encode(ts + ALLOWED_METHOD + signPath);
  let signature;
  try {
    setDiagnostic(diagnostic, { failureStage:'SIGN' });
    signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, payload);
  } catch (error) {
    setDiagnostic(diagnostic, { errorClass:error?.name || 'Error' });
    throw error;
  }

  let binary = '';
  for (const b of new Uint8Array(signature)) binary += String.fromCharCode(b);
  setDiagnostic(diagnostic, { failureStage:'NONE', errorClass:null });
  return {
    accept: 'application/json',
    'KALSHI-ACCESS-KEY': String(env.KALSHI_EXECUTION_KEY_ID).trim(),
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': btoa(binary),
  };
}

export async function kalshiGetOnly(env, path, fetchImpl = fetch, diagnostic = null) {
  if (!String(path || '').startsWith('/trade-api/')) throw new Error('PAYNE_KALSHI_GET_ONLY_PATH_REJECTED');
  const headers = await kalshiGetOnlyHeaders(env, ALLOWED_METHOD, path, diagnostic);
  let response;
  try {
    setDiagnostic(diagnostic, { failureStage:'FETCH' });
    response = await fetchImpl(KALSHI_ORIGIN + path, { method: ALLOWED_METHOD, headers });
  } catch (error) {
    setDiagnostic(diagnostic, { errorClass:error?.name || 'Error' });
    throw error;
  }
  if (!response || typeof response.ok !== 'boolean') {
    setDiagnostic(diagnostic, { failureStage:'RESPONSE', errorClass:'Error' });
    throw new Error('PAYNE_KALSHI_INVALID_RESPONSE');
  }
  setDiagnostic(diagnostic, { failureStage:response.ok ? 'NONE' : 'RESPONSE', errorClass:null });
  return response;
}

export function classifyIndex3(balanceBody) {
  const rows = Array.isArray(balanceBody?.balance_breakdown) ? balanceBody.balance_breakdown : null;
  if (!rows) return 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT';
  return rows.some(row => Number(row?.exchange_index) === 3)
    ? 'READ-PROVEN AVAILABLE'
    : 'READ-PROVEN UNAVAILABLE';
}

async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}

function safeProviderString(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, 160);
  if (!text) return null;
  return text.replace(/[A-Za-z0-9_\-]{20,}/g, '[REDACTED]');
}

function classifyProviderResponse(status) {
  const s = Number(status);
  if (s === 401) return 'AUTHENTICATION';
  if (s === 403) return 'PERMISSION_OR_AUTHORIZATION';
  if (s === 404) return 'REQUEST_PATH_OR_ENDPOINT';
  if (s === 405) return 'HTTP_METHOD';
  if (s === 429) return 'RATE_LIMIT';
  if (s >= 500) return 'PROVIDER_SERVER_ERROR';
  if (s >= 400) return 'MALFORMED_OR_REJECTED_REQUEST';
  if (s >= 200 && s < 300) return 'SUCCESS';
  return 'OTHER';
}

function setResponseDiagnostic(diagnostic, response, body, path) {
  const providerError = body?.error;
  const providerErrorCode = safeProviderString(
    typeof providerError === 'object' ? providerError?.code : body?.code
  );
  const providerErrorMessage = safeProviderString(
    typeof providerError === 'object'
      ? (providerError?.message ?? body?.message)
      : (typeof providerError === 'string' ? providerError : body?.message)
  );
  let responseContentType = null;
  try {
    responseContentType = safeProviderString(response?.headers?.get?.('content-type') ?? null);
  } catch {}
  setDiagnostic(diagnostic, {
    requestedPath: path,
    requestMethod: ALLOWED_METHOD,
    httpStatus: Number.isFinite(Number(response?.status)) ? Number(response.status) : null,
    responseContentType,
    providerResponseCategory: classifyProviderResponse(response?.status),
    providerErrorCode,
    providerErrorMessage,
  });
}

export async function kalshiReadOnlyProof(env, fetchImpl = fetch) {
  let providerGets = 0;
  const diagnostic = {
    credentialsPresent: Boolean(env?.KALSHI_EXECUTION_KEY_ID && env?.KALSHI_EXECUTION_PRIVATE_KEY),
    privateKeyEnvelope: privateKeyEnvelope(env?.KALSHI_EXECUTION_PRIVATE_KEY),
    failureStage: 'CREDENTIAL_CHECK',
    errorClass: null,
  };

  try {
    const get = async path => {
      providerGets += 1;
      const response = await kalshiGetOnly(env, path, fetchImpl, diagnostic);
      const body = await safeJson(response);
      setResponseDiagnostic(diagnostic, response, body, path);
      return { response, body };
    };

    const balance = await get('/trade-api/v2/portfolio/balance');
    const rows = Array.isArray(balance.body?.balance_breakdown) ? balance.body.balance_breakdown : null;

    if (!balance.response.ok) {
      return {
        ok:false,
        mode:'GET_ONLY',
        authentication:'NOT_PROVEN',
        authenticatedGet:'NOT_PROVEN',
        providerGets,
        accountBalanceGet:'NOT_PROVEN',
        liveMarketGet:'NOT_TESTED_AUTH_FAILED',
        freshLockGet:'NOT_TESTED_AUTH_FAILED',
        preSubmitGet:'NOT_TESTED_AUTH_FAILED',
        index3:classifyIndex3(balance.body),
        providerWrites:0,
        secretsExposed:false,
        ...diagnostic,
      };
    }

    const markets = await get('/trade-api/v2/markets?limit=1');
    const firstMarket = Array.isArray(markets.body?.markets) ? markets.body.markets[0] : null;
    const ticker = firstMarket?.ticker || firstMarket?.market_ticker || null;

    let freshLock = null;
    let preSubmit = null;
    if (ticker) {
      freshLock = await get('/trade-api/v2/markets/' + encodeURIComponent(ticker));
      preSubmit = await get('/trade-api/v2/markets/' + encodeURIComponent(ticker));
    }

    const authenticated = balance.response.ok;
    return {
      ok: authenticated,
      mode: 'GET_ONLY',
      authentication: authenticated ? 'PROVEN' : 'NOT_PROVEN',
      authenticatedGet: authenticated ? 'PROVEN' : 'NOT_PROVEN',
      providerGets,
      accountBalanceGet: balance.response.ok ? 'PROVEN' : 'NOT_PROVEN',
      balanceBreakdownPresent: Array.isArray(rows),
      balanceRecordCount: Array.isArray(rows) ? rows.length : null,
      liveMarketGet: markets.response.ok ? 'PROVEN' : 'NOT_PROVEN',
      liveTickerObserved: Boolean(ticker),
      freshLockGet: freshLock ? (freshLock.response.ok ? 'PROVEN' : 'NOT_PROVEN') : 'NOT_TESTED_NO_TICKER',
      preSubmitGet: preSubmit ? (preSubmit.response.ok ? 'PROVEN' : 'NOT_PROVEN') : 'NOT_TESTED_NO_TICKER',
      index3: classifyIndex3(balance.body),
      providerWrites: 0,
      secretsExposed: false,
      ...diagnostic,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'GET_ONLY',
      authentication: 'NOT_PROVEN',
      authenticatedGet: 'NOT_PROVEN',
      providerGets,
      accountBalanceGet: 'NOT_PROVEN',
      liveMarketGet: 'NOT_PROVEN',
      freshLockGet: 'NOT_PROVEN',
      preSubmitGet: 'NOT_PROVEN',
      message: 'Authenticated Kalshi GET proof failed. Secret values suppressed.',
      index3: 'UNKNOWN / PROVIDER EVIDENCE INSUFFICIENT',
      providerWrites: 0,
      secretsExposed: false,
      credentialsPresent: diagnostic.credentialsPresent,
      privateKeyEnvelope: diagnostic.privateKeyEnvelope,
      failureStage: diagnostic.failureStage,
      errorClass: diagnostic.errorClass || error?.name || 'Error',
    };
  }
}
