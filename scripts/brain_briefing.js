#!/usr/bin/env node
/**
 * brain_briefing.js — Print a full intelligence briefing for Claude at session start.
 * Claude reads this output to know: performance history, lessons, mistakes, open trades.
 * Run: node scripts/brain_briefing.js
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readJSON(file) {
  const p = resolve(ROOT, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

const journal    = readJSON('trade-journal.json');
const lessons    = readJSON('brain/lessons.json');
const mistakes   = readJSON('brain/mistakes.json');
const patterns   = readJSON('brain/patterns.json');
const mktNotes   = readJSON('brain/market_notes.json');
const perf       = readJSON('brain/performance.json');

const divider = '─'.repeat(60);

console.log('\n' + '═'.repeat(60));
console.log('  🧠  CLAUDE TRADING BRAIN — SESSION BRIEFING');
console.log('═'.repeat(60));

// ── Combined account status ──────────────────────────────────────────────────
const s  = perf?.summary || {};
const fs = perf?.forex_summary || {};

const nseStart   = journal?.account?.starting_capital || 10000;
const nseCur     = s.current_capital_inr || nseStart;
const forexStart = journal?.forex_account?.starting_capital || 10000;
const forexCur   = fs.current_capital_inr || forexStart;

const totalStart  = nseStart + forexStart;
const totalCur    = nseCur + forexCur;
const targetCap   = journal?.account?.target || 40000;
const daysLeft    = Math.max(0, Math.ceil((new Date(journal?.account?.target_date) - new Date()) / 86400000));
const totalPct    = ((totalCur - totalStart) / totalStart * 100).toFixed(1);
const progressBar = buildBar(totalCur, totalStart, targetCap);

console.log('\n💰 COMBINED ACCOUNT STATUS');
console.log(divider);
console.log(`  Total Capital    : ₹${totalCur.toLocaleString('en-IN', {maximumFractionDigits:2})}  (${totalPct >= 0 ? '+' : ''}${totalPct}%)`);
console.log(`  Target           : ₹${targetCap.toLocaleString('en-IN')} — ${progressBar}`);
console.log(`  Days Remaining   : ${daysLeft} (deadline: ${journal?.account?.target_date})`);
console.log(`  Daily needed     : ₹${((targetCap - totalCur) / Math.max(daysLeft, 1)).toFixed(0)}/day to hit target`);

console.log('\n📊 NSE STOCKS ACCOUNT  [₹10k pool]');
console.log(divider);
const nsePct = ((nseCur - nseStart) / nseStart * 100).toFixed(2);
console.log(`  Capital  : ₹${nseCur.toLocaleString('en-IN', {maximumFractionDigits:2})}  (${nsePct >= 0 ? '+' : ''}${nsePct}%)`);
console.log(`  Record   : ${s.wins || 0}W / ${s.losses || 0}L  |  Win Rate: ${s.win_rate_pct != null ? s.win_rate_pct + '%' : 'N/A'}`);
if (s.avg_win_pct) console.log(`  Avg Win  : +${s.avg_win_pct}%  |  Avg Loss: ${s.avg_loss_pct || 'N/A'}`);
if (s.best_trade)  console.log(`  Best     : ${s.best_trade}`);

console.log('\n💱 FOREX ACCOUNT  [₹10k pool]');
console.log(divider);
const fxPct = ((forexCur - forexStart) / forexStart * 100).toFixed(2);
console.log(`  Capital  : ₹${forexCur.toLocaleString('en-IN', {maximumFractionDigits:2})}  (${fxPct >= 0 ? '+' : ''}${fxPct}%)`);
console.log(`  Record   : ${fs.wins || 0}W / ${fs.losses || 0}L  |  Win Rate: ${fs.win_rate_pct != null ? fs.win_rate_pct + '%' : 'N/A (no closed trades)'}`);
if (fs.avg_win_pct) console.log(`  Avg Win  : +${fs.avg_win_pct}%  |  Avg Loss: ${fs.avg_loss_pct || 'N/A'}`);
if (fs.best_trade)  console.log(`  Best     : ${fs.best_trade}`);
console.log(`  USD/INR  : ₹${journal?.forex_account?.usd_inr_rate || 93.2} (update daily)`);

// ── Open trades ─────────────────────────────────────────────────────────────
const allOpen    = journal?.trades?.filter(t => t.status === 'OPEN') || [];
const nseOpen    = allOpen.filter(t => (t.market || 'NSE') !== 'FOREX');
const forexOpen  = allOpen.filter(t => t.market === 'FOREX');

console.log('\n📈 OPEN NSE TRADES');
console.log(divider);
if (nseOpen.length === 0) {
  console.log('  No open NSE trades. Ready to deploy capital.');
} else {
  for (const t of nseOpen) {
    console.log(`  #${t.id} ${t.symbol} | ${t.action} ${t.shares} shares @ ₹${t.entry}`);
    console.log(`     Capital: ₹${t.capital_used?.toFixed(0)} | Stop: ₹${t.stop_loss} | Target: ₹${t.target} | R:R ${t.rr_ratio}`);
    console.log(`     Thesis: ${t.thesis.slice(0, 120)}${t.thesis.length > 120 ? '...' : ''}`);
  }
}

console.log('\n💱 OPEN FOREX TRADES');
console.log(divider);
if (forexOpen.length === 0) {
  console.log('  No open forex trades.');
} else {
  for (const t of forexOpen) {
    const pip_move = t.action === 'BUY'
      ? `+${((t.target - t.entry) / t.pip_size).toFixed(0)} pips target / -${((t.entry - t.stop_loss) / t.pip_size).toFixed(0)} pips stop`
      : `+${((t.entry - t.target) / t.pip_size).toFixed(0)} pips target / -${((t.stop_loss - t.entry) / t.pip_size).toFixed(0)} pips stop`;
    console.log(`  #${t.id} ${t.pair} | ${t.action} ${t.lot_size} lots @ ${t.entry}`);
    console.log(`     Margin: ₹${t.margin_used?.toFixed(0)} | Stop: ${t.stop_loss} | Target: ${t.target} | R:R ${t.rr_ratio}`);
    console.log(`     ${pip_move}`);
    console.log(`     Thesis: ${t.thesis.slice(0, 100)}${t.thesis.length > 100 ? '...' : ''}`);
  }
}

// ── Mistakes — NEVER repeat these ──────────────────────────────────────────
const allMistakes = mistakes?.mistakes || [];
console.log('\n❌ MISTAKES — NEVER REPEAT');
console.log(divider);
if (allMistakes.length === 0) {
  console.log('  No mistakes recorded yet. (First losses will populate this.)');
} else {
  allMistakes.slice(-5).forEach(m => {
    const mkt = m.market ? `[${m.market}] ` : '';
    console.log(`  [${m.severity?.toUpperCase() || 'MEDIUM'}] ${mkt}${m.rule}`);
  });
}

// ── Top lessons ─────────────────────────────────────────────────────────────
const allLessons = lessons?.lessons || [];
console.log('\n📚 RECENT LESSONS');
console.log(divider);
if (allLessons.length === 0) {
  console.log('  No lessons yet. Lessons are extracted from every closed trade.');
} else {
  allLessons.slice(-5).forEach(l => {
    const icon = l.outcome === 'WIN' ? '✅' : l.outcome === 'LOSS' ? '❌' : '➖';
    const mkt = l.market ? `[${l.market}] ` : '';
    console.log(`  ${icon} [${l.date}] ${mkt}${l.lesson.slice(0, 150)}${l.lesson.length > 150 ? '...' : ''}`);
  });
}

// ── Pattern stats ────────────────────────────────────────────────────────────
const allPatterns = patterns?.patterns || [];
console.log('\n🔁 PATTERN PERFORMANCE');
console.log(divider);
if (allPatterns.length === 0) {
  console.log('  No pattern data yet. Builds after first few trades.');
} else {
  allPatterns.sort((a,b) => (b.win_rate_pct||0) - (a.win_rate_pct||0)).forEach(p => {
    const bar = '█'.repeat(Math.round((p.win_rate_pct||0) / 10));
    const mkt = p.market ? `[${p.market}] ` : '';
    console.log(`  ${mkt}${p.name.padEnd(25)} ${String(p.win_rate_pct||0).padStart(3)}% ${bar}  (${p.trades} trades, avg ${p.avg_pnl_pct > 0 ? '+' : ''}${p.avg_pnl_pct}%)`);
  });
}

// ── Market notes ─────────────────────────────────────────────────────────────
const notes = mktNotes?.notes || [];
console.log('\n🌍 MARKET OBSERVATIONS');
console.log(divider);
if (notes.length === 0) {
  console.log('  No market notes yet.');
} else {
  notes.slice(-3).forEach(n => {
    console.log(`  [${n.date}] ${n.observation.slice(0, 160)}${n.observation.length > 160 ? '...' : ''}`);
  });
}

// ── Decision framework ───────────────────────────────────────────────────────
console.log('\n🎯 DECISION RULES (auto-updated from brain)');
console.log(divider);
const rules = buildRules(allMistakes, allPatterns, s, fs);
rules.forEach(r => console.log(`  • ${r}`));

console.log('\n' + '═'.repeat(60));
console.log('  Brain briefing complete. Ready to trade.');
console.log('═'.repeat(60) + '\n');

// ── Helper: progress bar ─────────────────────────────────────────────────────
function buildBar(cur, start, target) {
  const pct = Math.min(100, Math.max(0, ((cur - start) / (target - start)) * 100));
  const filled = Math.round(pct / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  return `[${bar}] ${pct.toFixed(1)}%`;
}

// ── Helper: build dynamic rules from brain ───────────────────────────────────
function buildRules(mistakes, patterns, stats, fxStats) {
  const rules = [
    'Always check brain_briefing before entering any new trade.',
    'Stop loss is non-negotiable — exit immediately if price hits stop.',
    '[NSE] Max capital per trade: 95% of NSE pool (keep 5% buffer).',
    '[NSE] Only enter trades with R:R >= 1.5:1.',
    '[FOREX] Max risk per trade: 2% of forex pool (₹200 per trade).',
    '[FOREX] Trade micro lots (0.01–0.1) until win rate > 60% over 10+ trades.',
    '[FOREX] Only trade EUR/USD, USD/JPY, XAU/USD — most liquid pairs.',
    'After 2 consecutive losses (either account), reduce size by 50% for next trade.',
  ];

  // Pattern-based rules
  const badPatterns = patterns.filter(p => p.trades >= 2 && p.win_rate_pct < 40);
  badPatterns.forEach(p => {
    const mkt = p.market ? `[${p.market}] ` : '';
    rules.push(`${mkt}AVOID "${p.name}" setups — only ${p.win_rate_pct}% win rate over ${p.trades} trades.`);
  });

  const goodPatterns = patterns.filter(p => p.trades >= 2 && p.win_rate_pct >= 70);
  goodPatterns.forEach(p => {
    const mkt = p.market ? `[${p.market}] ` : '';
    rules.push(`${mkt}PREFER "${p.name}" setups — ${p.win_rate_pct}% win rate, avg +${p.avg_pnl_pct}%.`);
  });

  // NSE drawdown protection
  if (stats.current_capital_inr && stats.peak_capital_inr) {
    const dd = ((stats.peak_capital_inr - stats.current_capital_inr) / stats.peak_capital_inr * 100);
    if (dd > 15) rules.push(`⚠️  [NSE] DRAWDOWN ALERT: Down ${dd.toFixed(1)}% from peak. Trade 50% size.`);
    if (dd > 25) rules.push(`🛑  [NSE] SEVERE DRAWDOWN: Down ${dd.toFixed(1)}%. STOP and review.`);
  }

  // Forex drawdown protection
  if (fxStats.current_capital_inr && fxStats.peak_capital_inr) {
    const dd = ((fxStats.peak_capital_inr - fxStats.current_capital_inr) / fxStats.peak_capital_inr * 100);
    if (dd > 10) rules.push(`⚠️  [FOREX] DRAWDOWN ALERT: Down ${dd.toFixed(1)}% from peak. Trade 50% size.`);
    if (dd > 20) rules.push(`🛑  [FOREX] SEVERE DRAWDOWN: Down ${dd.toFixed(1)}%. STOP forex trading today.`);
  }

  return rules;
}
