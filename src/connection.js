import CDP from 'chrome-remote-interface';

// ── Config ───────────────────────────────────────────────────────────────────
const CDP_HOST            = 'localhost';
const CDP_PORT            = 9222;
const MAX_RETRIES         = 5;
const BASE_DELAY_MS       = 500;
const KEEPALIVE_INTERVAL  = 3 * 60 * 1000;  // ping every 3 min to prevent idle disconnect

// ── State ────────────────────────────────────────────────────────────────────
let client         = null;
let targetInfo     = null;
let keepaliveTimer = null;

// ── Known TradingView API paths (discovered via live probing) ─────────────────
export const KNOWN_PATHS = {
  chartApi:             'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection:'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar:      'window.TradingView.bottomWidgetBar',
  replayApi:            'window.TradingViewApi._replayApi',
  alertService:         'window.TradingViewApi._alertService',
  chartApiInstance:     'window.ChartApiInstance',
  mainSeriesBars:       'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  strategyStudy:        'chart._chartWidget.model().model().dataSources()',
  layoutManager:        'window.TradingViewApi.getSavedCharts',
  symbolSearchApi:      'window.TradingViewApi.searchSymbols',
  pineFacadeApi:        'https://pine-facade.tradingview.com/pine-facade',
};

// ── Connection ───────────────────────────────────────────────────────────────
export async function getClient() {
  if (client) {
    try {
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      targetInfo = target;
      client     = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      startKeepalive();
      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  const targets = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`).then((r) => r.json());
  return (
    targets.find((t) => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))   ||
    targets.find((t) => t.type === 'page' && /tradingview/i.test(t.url))               ||
    targets.find((t) => t.type === 'page' && /tradingview/i.test(t.title || ''))       ||
    targets.find((t) => t.type === 'page')                                              ||
    null
  );
}

// ── Keepalive ─────────────────────────────────────────────────────────────────
function startKeepalive() {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = setInterval(async () => {
    if (!client) { clearInterval(keepaliveTimer); keepaliveTimer = null; return; }
    try {
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
    } catch {
      // Connection dropped — clear so getClient() reconnects on next call
      client = null; targetInfo = null;
      clearInterval(keepaliveTimer); keepaliveTimer = null;
    }
  }, KEEPALIVE_INTERVAL);
  keepaliveTimer.unref?.();  // don't block process exit
}

// ── Evaluate ──────────────────────────────────────────────────────────────────
export async function evaluate(expression, opts = {}) {
  const c      = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue:  true,
    awaitPromise:   opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

// ── Disconnect ────────────────────────────────────────────────────────────────
export async function disconnect() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  if (client) {
    try { await client.close(); } catch {}
    client = null; targetInfo = null;
  }
}

// ── Convenience path helpers ──────────────────────────────────────────────────
export async function getTargetInfo() {
  if (!targetInfo) await getClient();
  return targetInfo;
}

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) throw new Error(`${name} not available at ${path}`);
  return path;
}

export const getChartApi        = () => verifyAndReturn(KNOWN_PATHS.chartApi,           'Chart API');
export const getChartCollection = () => verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
export const getBottomBar       = () => verifyAndReturn(KNOWN_PATHS.bottomWidgetBar,    'Bottom Widget Bar');
export const getReplayApi       = () => verifyAndReturn(KNOWN_PATHS.replayApi,          'Replay API');
export const getMainSeriesBars  = () => verifyAndReturn(KNOWN_PATHS.mainSeriesBars,     'Main Series Bars');
