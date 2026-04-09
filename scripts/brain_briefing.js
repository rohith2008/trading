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

// ── Account status ──────────────────────────────────────────────────────────
const s = perf?.summary || {};
const startCap = journal?.account?.starting_capital || 10000;
const curCap = s.current_capital_inr || startCap;
const targetCap = journal?.account?.target || 20000;
const daysLeft = Math.max(0, Math.ceil((new Date(journal?.account?.target_date) - new Date()) / 86400000));
const progress = ((curCap - startCap) / startCap * 100).toFixed(1);

console.log('\n📊 ACCOUNT STATUS');
console.log(divider);
console.log(`  Starting Capital : ₹${startCap.toLocaleString('en-IN')}`);
console.log(`  Current Capital  : ₹${curCap.toLocaleString('en-IN')}  (${progress >= 0 ? '+' : ''}${progress}%)`);
console.log(`  Target           : ₹${targetCap.toLocaleString('en-IN')} (2x)`);
console.log(`  Days Remaining   : ${daysLeft}`);
console.log(`  Win Rate         : ${s.win_rate_pct != null ? s.win_rate_pct + '%' : 'N/A (no closed trades yet)'}`);
console.log(`  Record           : ${s.wins || 0}W / ${s.losses || 0}L`);
if (s.avg_win_pct) console.log(`  Avg Win          : +${s.avg_win_pct}%`);
if (s.avg_loss_pct) console.log(`  Avg Loss         : ${s.avg_loss_pct}%`);
if (s.best_trade) console.log(`  Best Trade       : ${s.best_trade}`);
if (s.worst_trade) console.log(`  Worst Trade      : ${s.worst_trade}`);

// ── Open trades ─────────────────────────────────────────────────────────────
const openTrades = journal?.trades?.filter(t => t.status === 'OPEN') || [];
console.log('\n📈 OPEN TRADES');
console.log(divider);
if (openTrades.length === 0) {
  console.log('  No open trades. Ready to deploy capital.');
} else {
  for (const t of openTrades) {
    console.log(`  #${t.id} ${t.symbol} | ${t.action} ${t.shares} shares @ ₹${t.entry}`);
    console.log(`     Capital: ₹${t.capital_used.toFixed(0)} | Stop: ₹${t.stop_loss} | Target: ₹${t.target} | R:R ${t.rr_ratio}`);
    console.log(`     Thesis: ${t.thesis.slice(0, 120)}${t.thesis.length > 120 ? '...' : ''}`);
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
    console.log(`  [${m.severity?.toUpperCase() || 'MEDIUM'}] ${m.rule}`);
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
    console.log(`  ${icon} [${l.date}] ${l.lesson.slice(0, 150)}${l.lesson.length > 150 ? '...' : ''}`);
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
    console.log(`  ${p.name.padEnd(25)} ${String(p.win_rate_pct||0).padStart(3)}% ${bar}  (${p.trades} trades, avg ${p.avg_pnl_pct > 0 ? '+' : ''}${p.avg_pnl_pct}%)`);
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
const rules = buildRules(allMistakes, allPatterns, s);
rules.forEach(r => console.log(`  • ${r}`));

console.log('\n' + '═'.repeat(60));
console.log('  Brain briefing complete. Ready to trade.');
console.log('═'.repeat(60) + '\n');

// ── Helper: build dynamic rules from brain ───────────────────────────────────
function buildRules(mistakes, patterns, stats) {
  const rules = [
    'Always check brain_briefing before entering any new trade.',
    'Stop loss is non-negotiable — exit immediately if price hits stop.',
    'Max capital per trade: 95% (keep 5% buffer).',
    'Only enter trades with R:R >= 1.5:1.',
    'After 2 consecutive losses, reduce size by 50% for next trade.',
  ];

  // Add pattern-based rules
  const badPatterns = patterns.filter(p => p.trades >= 2 && p.win_rate_pct < 40);
  badPatterns.forEach(p => {
    rules.push(`AVOID "${p.name}" setups — only ${p.win_rate_pct}% win rate over ${p.trades} trades.`);
  });

  const goodPatterns = patterns.filter(p => p.trades >= 2 && p.win_rate_pct >= 70);
  goodPatterns.forEach(p => {
    rules.push(`PREFER "${p.name}" setups — ${p.win_rate_pct}% win rate, avg +${p.avg_pnl_pct}%.`);
  });

  // Drawdown protection
  if (stats.current_capital_inr && stats.peak_capital_inr) {
    const dd = ((stats.peak_capital_inr - stats.current_capital_inr) / stats.peak_capital_inr * 100);
    if (dd > 15) rules.push(`⚠️  DRAWDOWN ALERT: Down ${dd.toFixed(1)}% from peak. Trade with 50% normal size until recovery.`);
    if (dd > 25) rules.push(`🛑  SEVERE DRAWDOWN: Down ${dd.toFixed(1)}%. STOP trading and review all mistakes before next trade.`);
  }

  return rules;
}
