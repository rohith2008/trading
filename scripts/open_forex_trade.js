#!/usr/bin/env node
/**
 * open_forex_trade.js — Log a new forex trade into the brain system.
 *
 * Usage:
 *   node scripts/open_forex_trade.js <pair> <buy|sell> <lot_size> <entry> <stop> <target> <leverage> "thesis"
 *
 * Examples:
 *   node scripts/open_forex_trade.js EUR/USD buy 0.1 1.0850 1.0800 1.0950 30 "Dollar weakness + ECB dovish pivot"
 *   node scripts/open_forex_trade.js XAU/USD buy 0.01 3250 3200 3350 20 "Gold safe-haven demand, geopolitical risk"
 *   node scripts/open_forex_trade.js USD/JPY sell 0.05 149.50 150.50 147.50 30 "BOJ rate hike expectations"
 *
 * Pip sizes by pair:
 *   Most pairs (EUR/USD, GBP/USD, AUD/USD): 0.0001
 *   JPY pairs (USD/JPY, EUR/JPY):           0.01
 *   XAU/USD (Gold):                         0.1
 *
 * Lot sizes:
 *   Standard lot = 100,000 units → 1 pip ≈ $10
 *   Mini lot     =  10,000 units → 1 pip ≈ $1
 *   Micro lot    =   1,000 units → 1 pip ≈ $0.10
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readJSON(file) {
  return JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
}
function writeJSON(file, data) {
  writeFileSync(resolve(ROOT, file), JSON.stringify(data, null, 2));
}

const [,, pairArg, directionArg, lotArg, entryArg, stopArg, targetArg, leverageArg, ...thesisParts] = process.argv;

if (!pairArg || !directionArg || !lotArg || !entryArg || !stopArg || !targetArg) {
  console.error('Usage: node open_forex_trade.js <pair> <buy|sell> <lot_size> <entry> <stop> <target> [leverage] "thesis"');
  console.error('Example: node open_forex_trade.js EUR/USD buy 0.1 1.0850 1.0800 1.0950 30 "Dollar weakness"');
  process.exit(1);
}

const pair      = pairArg.toUpperCase();
const action    = directionArg.toUpperCase(); // BUY or SELL
const lotSize   = parseFloat(lotArg);
const entry     = parseFloat(entryArg);
const stop      = parseFloat(stopArg);
const target    = parseFloat(targetArg);
const leverage  = parseFloat(leverageArg) || 30;
const thesis    = thesisParts.join(' ') || 'No thesis provided';

if (!['BUY', 'SELL'].includes(action)) {
  console.error('Direction must be "buy" or "sell"');
  process.exit(1);
}

const journal = readJSON('trade-journal.json');
const perf    = readJSON('brain/performance.json');

// ── Determine pip size ───────────────────────────────────────────────────────
function getPipSize(pair) {
  if (pair.includes('JPY')) return 0.01;
  if (pair.startsWith('XAU') || pair.startsWith('GOLD')) return 0.1;
  return 0.0001;
}
const pipSize = getPipSize(pair);
const units   = Math.round(lotSize * 100000);

// ── Calculate pip distances and R:R ─────────────────────────────────────────
const direction = action === 'BUY' ? 1 : -1;
const riskPips   = Math.abs(entry - stop) / pipSize;
const rewardPips = Math.abs(target - entry) / pipSize;
const rrRatio    = Math.round((rewardPips / riskPips) * 100) / 100;

// ── Pip value in INR ─────────────────────────────────────────────────────────
// For USD-quoted pairs (EUR/USD, GBP/USD, XAU/USD): pip_value_usd = pip_size × units
// For USD-base pairs (USD/JPY): pip_value_usd = (pip_size / current_rate) × units — approximate
const usdInr = journal.forex_account?.usd_inr_rate || 93.2;
let pipValueUsd;
if (pair.startsWith('USD/')) {
  pipValueUsd = (pipSize / entry) * units; // approximate for USD/JPY type
} else {
  pipValueUsd = pipSize * units;
}
const pipValueInr = Math.round(pipValueUsd * usdInr * 100) / 100;

// ── Margin calculation ───────────────────────────────────────────────────────
// Margin (in base currency) = (units × entry) / leverage  — simplified
// For EUR/USD: margin_USD = (units × 1) / leverage, then convert to INR
// For USD/JPY: margin_USD = units / leverage
const marginUsd = (units / leverage);
const marginInr = Math.round(marginUsd * usdInr * 100) / 100;

// ── Max risk in INR ──────────────────────────────────────────────────────────
const maxRiskInr = Math.round(riskPips * pipValueInr * 100) / 100;
const maxRewardInr = Math.round(rewardPips * pipValueInr * 100) / 100;

// ── Validate R:R ─────────────────────────────────────────────────────────────
if (rrRatio < 1.5) {
  console.warn(`⚠️  Warning: R:R is ${rrRatio}:1 — below the recommended 1.5:1 minimum.`);
}

// ── Validate risk per trade (max 2% of forex pool = ₹200) ────────────────────
const forexCap = perf.forex_summary?.current_capital_inr || 10000;
const maxAllowedRisk = forexCap * 0.02;
if (maxRiskInr > maxAllowedRisk) {
  console.warn(`⚠️  Warning: Risk ₹${maxRiskInr} exceeds 2% rule (₹${maxAllowedRisk.toFixed(0)}). Reduce lot size.`);
}

// ── Assign trade ID ──────────────────────────────────────────────────────────
const maxId = Math.max(0, ...journal.trades.map(t => t.id || 0));
const newId = maxId + 1;

// ── Build trade record ───────────────────────────────────────────────────────
const trade = {
  id: newId,
  date: new Date().toISOString().split('T')[0],
  market: 'FOREX',
  pair,
  action,
  status: 'OPEN',
  entry,
  lot_size: lotSize,
  units,
  leverage,
  stop_loss: stop,
  target,
  pip_size: pipSize,
  pip_value_inr: pipValueInr,
  risk_pips: Math.round(riskPips),
  reward_pips: Math.round(rewardPips),
  rr_ratio: rrRatio,
  margin_used: marginInr,
  max_risk_inr: maxRiskInr,
  max_reward_inr: maxRewardInr,
  thesis,
  exit: null,
  pnl: null,
  pnl_pct: null,
};

journal.trades.unshift(trade);

// Update forex account open trades count
perf.forex_summary.open_trades = (perf.forex_summary.open_trades || 0) + 1;

journal.log.push({
  date: trade.date,
  note: `OPENED Trade #${newId} ${pair} [FOREX] | ${action} ${lotSize} lots @ ${entry} | Stop: ${stop} (${Math.round(riskPips)} pips) | Target: ${target} (${Math.round(rewardPips)} pips) | R:R ${rrRatio} | Margin: ₹${marginInr} | Risk: ₹${maxRiskInr}`,
});

writeJSON('trade-journal.json', journal);
writeJSON('brain/performance.json', perf);

console.log(`\n✅ Forex Trade #${newId} opened.`);
console.log(`   ${pair} | ${action} ${lotSize} lots @ ${entry}`);
console.log(`   Stop: ${stop} (${Math.round(riskPips)} pips risk)`);
console.log(`   Target: ${target} (${Math.round(rewardPips)} pips reward)`);
console.log(`   R:R: ${rrRatio}:1`);
console.log(`   Pip Value: ₹${pipValueInr} per pip`);
console.log(`   Margin Used: ₹${marginInr}  |  Max Risk: ₹${maxRiskInr}  |  Max Reward: ₹${maxRewardInr}`);
console.log(`\n   Forex Pool: ₹${forexCap.toLocaleString('en-IN')} | 2% risk rule = max ₹${maxAllowedRisk.toFixed(0)} per trade`);
console.log(`\n   To close: node scripts/close_trade.js ${newId} <exit_price> <win|loss|breakeven> "reason"`);
