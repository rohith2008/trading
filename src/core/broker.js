/**
 * AngelOne SmartAPI broker integration.
 * Handles auth (with TOTP), order placement, positions, holdings, funds.
 * Credentials loaded from .env: ANGELONE_API_KEY, ANGELONE_CLIENT_ID,
 *   ANGELONE_PASSWORD, ANGELONE_TOTP_SECRET
 */
import { createHmac } from 'crypto';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const BASE = 'https://apiconnect.angelbroking.com';

// In-memory session cache
let _session = null; // { jwt, refreshToken, feedToken, expiresAt }

// ─── TOTP ──────────────────────────────────────────────────────────────────

function base32Decode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const output = [];
  str = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  for (const char of str) {
    const idx = chars.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTOTP(secret) {
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(timeStep));
  const key = base32Decode(secret);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function baseHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-API-KEY': apiKey,
  };
}

async function request(method, path, body, jwt) {
  const apiKey = process.env.ANGELONE_API_KEY;
  if (!apiKey) throw new Error('ANGELONE_API_KEY not set in .env');

  const headers = baseHeaders(apiKey);
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }

  if (!res.ok || json.status === false || json.errorcode) {
    const msg = json.message || json.msg || JSON.stringify(json);
    throw new Error(`AngelOne API error (${res.status}): ${msg}`);
  }
  return json;
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export async function login({ totp } = {}) {
  const clientcode = process.env.ANGELONE_CLIENT_ID;
  const password = process.env.ANGELONE_PASSWORD;
  const totpSecret = process.env.ANGELONE_TOTP_SECRET;

  if (!clientcode) throw new Error('ANGELONE_CLIENT_ID not set in .env');
  if (!password) throw new Error('ANGELONE_PASSWORD not set in .env');

  const totpCode = totp || (totpSecret ? generateTOTP(totpSecret) : null);
  if (!totpCode) throw new Error('Provide TOTP code via --totp flag or set ANGELONE_TOTP_SECRET in .env for auto-generation');

  const json = await request('POST', '/rest/auth/angelbroking/user/v1/loginByPassword', {
    clientcode,
    password,
    totp: totpCode,
  });

  const data = json.data;
  _session = {
    jwt: data.jwtToken,
    refreshToken: data.refreshToken,
    feedToken: data.feedToken,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8h
  };

  return {
    success: true,
    client: clientcode,
    jwt_expires_in: '8h',
    feed_token: data.feedToken,
  };
}

async function getJwt() {
  if (_session && _session.expiresAt > Date.now() + 60_000) return _session.jwt;
  // Try auto-login if credentials available
  await login();
  return _session.jwt;
}

export function logout() {
  _session = null;
  return { success: true, message: 'Session cleared' };
}

export function sessionStatus() {
  if (!_session) return { success: true, logged_in: false };
  const msLeft = _session.expiresAt - Date.now();
  return {
    success: true,
    logged_in: msLeft > 0,
    expires_in_minutes: Math.round(msLeft / 60_000),
  };
}

// ─── Symbol search ────────────────────────────────────────────────────────

export async function searchSymbol({ exchange, symbol }) {
  const jwt = await getJwt();
  const exch = (exchange || 'NSE').toUpperCase();
  const json = await request('GET', `/rest/secure/angelbroking/order/v1/searchScrip?exchange=${exch}&searchscrip=${encodeURIComponent(symbol)}`, null, jwt);
  const scrips = json.data || [];
  return {
    success: true,
    results: scrips.map(s => ({
      symbol: s.tradingsymbol,
      token: s.symboltoken,
      exchange: s.exchange,
      name: s.name || s.tradingsymbol,
    })),
  };
}

// ─── Market data ──────────────────────────────────────────────────────────

export async function getLTP({ exchange, symbol, token }) {
  const jwt = await getJwt();
  const json = await request('POST', '/rest/secure/angelbroking/market/v1/quote/', {
    mode: 'LTP',
    exchangeTokens: { [exchange || 'NSE']: [token] },
  }, jwt);
  const fetched = json.data?.fetched?.[0];
  if (!fetched) throw new Error(`No LTP data returned for ${symbol || token}`);
  return {
    success: true,
    symbol: fetched.tradingSymbol,
    exchange: fetched.exchange,
    ltp: fetched.ltp,
    token,
  };
}

// ─── Orders ───────────────────────────────────────────────────────────────

export async function placeOrder({
  symbol, token, exchange,
  action, quantity, order_type,
  product, price, trigger_price,
}) {
  const jwt = await getJwt();

  if (!symbol) throw new Error('symbol is required (e.g. "SBIN-EQ")');
  if (!token) throw new Error('token is required — use broker_search_symbol to find it');
  if (!action) throw new Error('action must be BUY or SELL');
  if (!quantity) throw new Error('quantity is required');

  const orderType = (order_type || 'MARKET').toUpperCase();
  if (orderType === 'LIMIT' && !price) throw new Error('price is required for LIMIT orders');
  if ((orderType === 'STOPLOSS_LIMIT' || orderType === 'STOPLOSS_MARKET') && !trigger_price) {
    throw new Error('trigger_price is required for stoploss orders');
  }

  const body = {
    variety: 'NORMAL',
    tradingsymbol: symbol.toUpperCase(),
    symboltoken: String(token),
    transactiontype: action.toUpperCase(),
    exchange: (exchange || 'NSE').toUpperCase(),
    ordertype: orderType,
    producttype: (product || 'INTRADAY').toUpperCase(),
    duration: 'DAY',
    price: String(price || 0),
    triggerprice: String(trigger_price || 0),
    quantity: String(quantity),
    squareoff: '0',
    stoploss: '0',
  };

  const json = await request('POST', '/rest/secure/angelbroking/order/v1/placeOrder', body, jwt);

  return {
    success: true,
    order_id: json.data?.orderid,
    symbol: symbol.toUpperCase(),
    action: action.toUpperCase(),
    quantity,
    order_type: orderType,
    price: price || 'MARKET',
    product: body.producttype,
    exchange: body.exchange,
  };
}

export async function cancelOrder({ order_id, variety }) {
  const jwt = await getJwt();
  if (!order_id) throw new Error('order_id is required');
  const json = await request('POST', '/rest/secure/angelbroking/order/v1/cancelOrder', {
    variety: variety || 'NORMAL',
    orderid: String(order_id),
  }, jwt);
  return { success: true, order_id: json.data?.orderid || order_id, cancelled: true };
}

export async function modifyOrder({ order_id, variety, symbol, token, exchange, order_type, product, price, trigger_price, quantity }) {
  const jwt = await getJwt();
  if (!order_id) throw new Error('order_id is required');
  const json = await request('POST', '/rest/secure/angelbroking/order/v1/modifyOrder', {
    variety: variety || 'NORMAL',
    orderid: String(order_id),
    tradingsymbol: symbol,
    symboltoken: String(token),
    exchange: (exchange || 'NSE').toUpperCase(),
    ordertype: (order_type || 'LIMIT').toUpperCase(),
    producttype: (product || 'INTRADAY').toUpperCase(),
    duration: 'DAY',
    price: String(price || 0),
    triggerprice: String(trigger_price || 0),
    quantity: String(quantity),
  }, jwt);
  return { success: true, order_id: json.data?.orderid || order_id, modified: true };
}

// ─── Order book & positions ───────────────────────────────────────────────

export async function getOrderBook() {
  const jwt = await getJwt();
  const json = await request('GET', '/rest/secure/angelbroking/order/v1/list', null, jwt);
  const orders = json.data || [];
  return {
    success: true,
    count: orders.length,
    orders: orders.map(o => ({
      order_id: o.orderid,
      symbol: o.tradingsymbol,
      exchange: o.exchange,
      action: o.transactiontype,
      qty: o.quantity,
      price: o.price,
      type: o.ordertype,
      status: o.status,
      filled_qty: o.filledshares,
      avg_price: o.averageprice,
      time: o.ordertime,
    })),
  };
}

export async function getPositions() {
  const jwt = await getJwt();
  const json = await request('GET', '/rest/secure/angelbroking/order/v1/getPosition', null, jwt);
  const positions = json.data || [];
  return {
    success: true,
    count: positions.length,
    positions: positions.map(p => ({
      symbol: p.tradingsymbol,
      exchange: p.exchange,
      product: p.producttype,
      qty: p.netqty,
      avg_price: p.averageprice,
      ltp: p.ltp,
      pnl: p.unrealisedpnl,
      day_pnl: p.pnl,
    })),
  };
}

export async function getHoldings() {
  const jwt = await getJwt();
  const json = await request('GET', '/rest/secure/angelbroking/portfolio/v1/getAllHolding', null, jwt);
  const holdings = json.data?.holdings || [];
  return {
    success: true,
    count: holdings.length,
    total_value: json.data?.totalholding?.totalholdingvalue,
    total_pnl: json.data?.totalholding?.totalprofitandloss,
    holdings: holdings.map(h => ({
      symbol: h.tradingsymbol,
      exchange: h.exchange,
      qty: h.quantity,
      avg_price: h.averageprice,
      ltp: h.ltp,
      current_value: h.holdingvalue,
      pnl: h.profitandloss,
      pnl_pct: h.pnlpercentage,
    })),
  };
}

export async function getFunds() {
  const jwt = await getJwt();
  const json = await request('GET', '/rest/secure/angelbroking/user/v1/getRMS', null, jwt);
  const d = json.data || {};
  return {
    success: true,
    available_cash: d.availablecash,
    used_margin: d.utiliseddebits,
    net: d.net,
    available_margin: d.availablemargin,
    collateral: d.collateral,
  };
}
