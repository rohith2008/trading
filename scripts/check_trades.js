#!/usr/bin/env node
/**
 * check_trades.js — Hard rules enforced on every open trade.
 * Run automatically by auto_update.bat every 10 min.
 *
 * Rules enforced:
 *   1. INTRADAY CURFEW  — Any INTRADAY trade still open after 15:15 IST → ALERT
 *   2. STOP LOSS BREACH — Any open trade where current price <= stop_loss → ALERT
 *   3. POSITION SIZE    — Any trade where capital_used > 40% of starting capital → ALERT
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readJSON(f) { return JSON.parse(readFileSync(resolve(ROOT, f), 'utf-8')); }
function writeJSON(f, d) { writeFileSync(resolve(ROOT, f), JSON.stringify(d, null, 2)); }

const journal = readJSON('trade-journal.json');
const openTrades = journal.trades.filter(t => t.status === 'OPEN');

if (!openTrades.length) {
  console.log('✅ No open trades. All clear.');
  process.exit(0);
}

// ── Fetch live prices ──────────────────────────────────────────────────────────
async function getLivePrices(symbols) {
  const prices = {};
  let disconnect;
  try {
    const mod = await import('../src/connection.js');
    const evaluate = mod.evaluate;
    disconnect = mod.disconnect;
    const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
    const BARS_PATH = 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()';
    for (const sym of symbols) {
      try {
        // Wait for setSymbol callback before reading bars
        await evaluate(
          `new Promise(function(resolve) { ${CHART_API}.setSymbol('${sym}', function(){ setTimeout(resolve, 800); }); })`,
          { awaitPromise: true }
        );
        const data = await evaluate(`(function() {
          var bars = ${BARS_PATH};
          if (bars && typeof bars.lastIndex === 'function') {
            var last = bars.valueAt(bars.lastIndex());
            if (last) return { last: last[4] };
          }
          return {};
        })()`);
        if (data?.last && data.last > 0) {
          prices[sym] = data.last;
        } else {
          console.warn(`  [warn] No price for ${sym} — bars may not have loaded`);
        }
      } catch (err) {
        console.warn(`  [warn] Failed to fetch price for ${sym}: ${err.message}`);
      }
    }
    await disconnect();
  } catch (err) {
    console.warn(`  [warn] CDP unavailable — live prices skipped: ${err.message}`);
    if (disconnect) await disconnect().catch(() => {});
  }
  return prices;
}

// ── Time check (IST = UTC+5:30) ────────────────────────────────────────────────
function getISTHourMinute() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return { hour: ist.getUTCHours(), minute: ist.getUTCMinutes() };
}

async function main() {
  const symbols = openTrades.map(t => t.symbol);
  console.log(`\n🔍 Checking ${openTrades.length} open trade(s)...`);
  const livePrices = await getLivePrices(symbols);

  const { hour, minute } = getISTHourMinute();
  const istMinutes = hour * 60 + minute;
  const CURFEW = 15 * 60 + 15; // 15:15 IST
  const MARKET_OPEN = 9 * 60 + 15; // 09:15 IST

  const alerts = [];
  const warnings = [];

  for (const trade of openTrades) {
    const ltp = livePrices[trade.symbol] || null;
    const ltpStr = ltp ? `₹${ltp}` : '(price unavailable)';

    // ── RULE 1: Intraday curfew ──────────────────────────────────────────────
    if (trade.trade_type === 'INTRADAY' && istMinutes >= CURFEW) {
      alerts.push({
        rule: 'INTRADAY_CURFEW',
        trade_id: trade.id,
        symbol: trade.symbol,
        message: `⛔ INTRADAY CURFEW: Trade #${trade.id} ${trade.symbol} is INTRADAY but still OPEN past 15:15 IST. MUST EXIT NOW. Current: ${ltpStr}. Entry: ₹${trade.entry}.`,
        action: `node scripts/close_trade.js ${trade.id} <EXIT_PRICE> loss "Intraday curfew — forced exit at EOD"`,
      });
    }

    // ── RULE 2: Stop loss breach ─────────────────────────────────────────────
    if (ltp && ltp <= trade.stop_loss) {
      alerts.push({
        rule: 'STOP_LOSS_BREACH',
        trade_id: trade.id,
        symbol: trade.symbol,
        message: `🛑 STOP LOSS HIT: Trade #${trade.id} ${trade.symbol} @ ${ltpStr} is AT or BELOW stop ₹${trade.stop_loss}. Exit immediately — no holding below stop.`,
        action: `node scripts/close_trade.js ${trade.id} ${ltp} loss "Stop loss hit at ${ltp}"`,
      });
    }

    // ── RULE 3: Trailing warning (within 2% of stop) ─────────────────────────
    if (ltp && ltp > trade.stop_loss) {
      const distancePct = ((ltp - trade.stop_loss) / trade.stop_loss) * 100;
      if (distancePct <= 2) {
        warnings.push({
          rule: 'NEAR_STOP',
          trade_id: trade.id,
          symbol: trade.symbol,
          message: `⚠️  NEAR STOP: Trade #${trade.id} ${trade.symbol} @ ${ltpStr} is within 2% of stop ₹${trade.stop_loss}. Be ready to exit.`,
        });
      }
    }

    // ── RULE 4: Position size check ──────────────────────────────────────────
    const maxAllowed = journal.account.starting_capital * 0.55; // 55% max per trade
    if (trade.capital_used > maxAllowed) {
      warnings.push({
        rule: 'OVERSIZED_POSITION',
        trade_id: trade.id,
        symbol: trade.symbol,
        message: `⚠️  OVERSIZED: Trade #${trade.id} ${trade.symbol} uses ₹${trade.capital_used} (${((trade.capital_used / journal.account.starting_capital)*100).toFixed(0)}% of capital). Max recommended is 55% (₹${maxAllowed.toFixed(0)}).`,
      });
    }
  }

  // ── Print results ──────────────────────────────────────────────────────────
  if (!alerts.length && !warnings.length) {
    console.log('\n✅ All trades healthy. No rule violations.\n');
    for (const trade of openTrades) {
      const ltp = livePrices[trade.symbol];
      if (ltp) {
        const pnl = (ltp - trade.entry) * trade.shares;
        const pnlPct = ((ltp - trade.entry) / trade.entry * 100).toFixed(2);
        const sign = pnl >= 0 ? '+' : '';
        console.log(`   ${trade.symbol} | Entry ₹${trade.entry} | LTP ₹${ltp} | P&L: ${sign}₹${pnl.toFixed(2)} (${sign}${pnlPct}%) | Stop ₹${trade.stop_loss} | Target ₹${trade.target}`);
      }
    }
  } else {
    if (alerts.length) {
      console.log('\n🚨 ALERTS — ACTION REQUIRED:\n');
      for (const a of alerts) {
        console.log(a.message);
        console.log(`   → Run: ${a.action}\n`);
      }
    }
    if (warnings.length) {
      console.log('\n⚠️  WARNINGS:\n');
      for (const w of warnings) {
        console.log(w.message);
      }
    }

    // Save alerts to brain/alerts.json for history
    const alertsFile = resolve(ROOT, 'brain/alerts.json');
    let alertHistory = { alerts: [] };
    try { alertHistory = JSON.parse(readFileSync(alertsFile, 'utf-8')); } catch {}
    const timestamp = new Date().toISOString();
    for (const a of [...alerts, ...warnings]) {
      alertHistory.alerts.push({ timestamp, ...a });
    }
    // Keep last 50 alerts only
    alertHistory.alerts = alertHistory.alerts.slice(-50);
    writeFileSync(alertsFile, JSON.stringify(alertHistory, null, 2));
  }

  console.log(`\n🕐 Checked at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
