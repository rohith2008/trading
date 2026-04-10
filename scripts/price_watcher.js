#!/usr/bin/env node
/**
 * Persistent price watcher.
 * Keeps a single CDP connection open and updates Excel every POLL_INTERVAL_MS.
 * Reads all watchlist prices in one DOM call — never switches the active chart.
 * Run via auto_update.bat. Stop with Ctrl+C.
 */
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildExcel } from './update_excel.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = resolve(__dirname, '..');
const JOURNAL_PATH = resolve(ROOT, 'trade-journal.json');
const OUT_DIR      = resolve(ROOT, 'trades');
const OUT_FILE     = resolve(OUT_DIR, 'trade-journal.xlsx');

const POLL_INTERVAL_MS = 30_000;  // update every 30 seconds

// ── CDP (reuses keepalive connection from connection.js) ──────────────────────
const { evaluate, disconnect } = await import('../src/connection.js');

// ── Price readers ─────────────────────────────────────────────────────────────
/**
 * Read ALL watchlist prices in a single CDP call — no chart switching.
 * Returns { "NSE:RELIANCE": 2950.5, "NSE:TCS": 3800.0, ... }
 */
async function getAllWatchlistPrices() {
  const result = await evaluate(`
    (function () {
      var prices    = {};
      var container = document.querySelector('[class*="layout__area--right"]');
      if (!container) return prices;

      var rows = container.querySelectorAll('[data-symbol-full]');
      for (var i = 0; i < rows.length; i++) {
        var sym = rows[i].getAttribute('data-symbol-full');
        if (!sym) continue;

        var row = rows[i].closest('[class*="row"]') || rows[i].parentElement;
        if (!row) continue;

        var cells = row.querySelectorAll('[class*="cell"],[class*="column"],[class*="price"],[class*="last"]');
        for (var j = 0; j < cells.length; j++) {
          var txt = cells[j].textContent.trim().replace(/[,\\s]/g, '');
          var p   = parseFloat(txt);
          if (!isNaN(p) && p > 0) { prices[sym] = p; break; }
        }
      }
      return prices;
    })()
  `);
  return result || {};
}

/**
 * Fallback: read the price of the symbol currently shown on the active chart.
 * Only used when a symbol is not in the watchlist.
 */
async function getChartPrice() {
  try {
    return await evaluate(`
      (function () {
        var b = window.TradingViewApi._activeChartWidgetWV.value()
                  ._chartWidget.model().mainSeries().bars();
        if (!b || typeof b.lastIndex !== 'function') return null;
        var bar = b.valueAt(b.lastIndex());
        if (!bar) return null;
        return {
          sym:   window.TradingViewApi._activeChartWidgetWV.value().symbol(),
          price: bar[4],
        };
      })()`);
  } catch {
    return null;
  }
}

// ── Excel writer ──────────────────────────────────────────────────────────────
async function writeExcel(journal, livePrices) {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const wb = await buildExcel(journal, livePrices);
  try {
    await wb.xlsx.writeFile(OUT_FILE);
  } catch (err) {
    if (err.code === 'EBUSY' || err.message.includes('busy') || err.message.includes('locked')) {
      await wb.xlsx.writeFile(OUT_FILE.replace('.xlsx', '_latest.xlsx'));
      return '(file locked — saved as _latest.xlsx)';
    }
    throw err;
  }
  const totalPnL = journal.trades.reduce((sum, t) => {
    const sym   = t.symbol.replace(/^(NSE|BSE):/, '');
    const price = livePrices[t.symbol] ?? livePrices[sym] ?? t.exit ?? t.entry;
    return sum + (price - t.entry) * t.shares * (t.action === 'SELL' ? -1 : 1);
  }, 0);
  return `Total P&L: ₹${totalPnL.toFixed(2)}`;
}

// ── Poll ──────────────────────────────────────────────────────────────────────
async function poll() {
  if (!existsSync(JOURNAL_PATH)) {
    console.error('trade-journal.json not found:', JOURNAL_PATH);
    process.exit(1);
  }

  const journal     = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
  const openSymbols = journal.trades.filter((t) => t.status === 'OPEN').map((t) => t.symbol);
  const now         = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

  if (!openSymbols.length) {
    console.log(`[${now}] No open trades — skipping price fetch`);
    await writeExcel(journal, {});
    return;
  }

  const watchlistPrices = await getAllWatchlistPrices().catch(() => ({}));
  const livePrices      = {};

  for (const sym of openSymbols) {
    const bare  = sym.replace(/^(NSE|BSE):/, '');
    const price = watchlistPrices[sym] ?? watchlistPrices[bare] ?? null;

    if (price) {
      livePrices[sym] = price;
      console.log(`  ${bare} → ₹${price}  (watchlist)`);
    } else {
      // Fallback: check if the currently-open chart matches
      const chart = await getChartPrice().catch(() => null);
      if (chart && (chart.sym === sym || chart.sym === bare) && chart.price > 0) {
        livePrices[sym] = chart.price;
        console.log(`  ${bare} → ₹${chart.price}  (chart fallback)`);
      } else {
        console.warn(`  ${bare} — not in watchlist; add it to TradingView watchlist for live prices`);
      }
    }
  }

  const summary = await writeExcel(journal, livePrices);
  console.log(`[${now}] Excel updated — ${summary}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
console.log(`\n📊 Price Watcher started — polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`   Ctrl+C to stop\n`);

await poll().catch((e) => console.error('Poll error:', e.message));
setInterval(() => poll().catch((e) => console.error('Poll error:', e.message)), POLL_INTERVAL_MS);

process.on('SIGINT', async () => {
  console.log('\nStopping watcher...');
  await disconnect().catch(() => {});
  process.exit(0);
});
