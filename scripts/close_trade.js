#!/usr/bin/env node
/**
 * close_trade.js — Mark a trade as closed and extract learnings.
 * Usage: node scripts/close_trade.js <trade_id> <exit_price> <win|loss|breakeven> "reason"
 * Example: node scripts/close_trade.js 1 365.5 win "Hit target, strong volume confirmation"
 */
import { readFileSync, writeFileSync } from 'fs';
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

const [,, tradeIdArg, exitPriceArg, outcomeArg, ...reasonParts] = process.argv;
const tradeId = parseInt(tradeIdArg);
const exitPrice = parseFloat(exitPriceArg);
const outcome = (outcomeArg || '').toLowerCase(); // win | loss | breakeven
const reason = reasonParts.join(' ') || 'No reason provided';

if (!tradeId || isNaN(exitPrice) || !['win','loss','breakeven'].includes(outcome)) {
  console.error('Usage: node close_trade.js <trade_id> <exit_price> <win|loss|breakeven> "reason"');
  process.exit(1);
}

// ── Load all brain files ────────────────────────────────────────────────────
const journal    = readJSON('trade-journal.json');
const lessons    = readJSON('brain/lessons.json');
const mistakes   = readJSON('brain/mistakes.json');
const patterns   = readJSON('brain/patterns.json');
const marketNotes = readJSON('brain/market_notes.json');
const perf       = readJSON('brain/performance.json');

// ── Find the trade ──────────────────────────────────────────────────────────
const trade = journal.trades.find(t => t.id === tradeId);
if (!trade) { console.error(`Trade #${tradeId} not found.`); process.exit(1); }
if (trade.status !== 'OPEN') { console.error(`Trade #${tradeId} is already closed (${trade.status}).`); process.exit(1); }

// ── Calculate P&L ──────────────────────────────────────────────────────────
const direction = trade.action === 'BUY' ? 1 : -1;
const pnl = (exitPrice - trade.entry) * trade.shares * direction;
const pnlPct = ((exitPrice - trade.entry) / trade.entry * 100 * direction);
const status = outcome === 'win' ? 'WIN' : outcome === 'loss' ? 'LOSS' : 'BREAKEVEN';
const hitTarget = exitPrice >= trade.target && trade.action === 'BUY';
const hitStop = exitPrice <= trade.stop_loss && trade.action === 'BUY';

// ── Update trade record ─────────────────────────────────────────────────────
trade.status = status;
trade.exit = exitPrice;
trade.exit_date = new Date().toISOString().split('T')[0];
trade.exit_reason = reason;
trade.pnl = Math.round(pnl * 100) / 100;
trade.pnl_pct = Math.round(pnlPct * 100) / 100;

// ── Extract lesson ──────────────────────────────────────────────────────────
const holdDays = Math.max(1, Math.ceil(
  (new Date(trade.exit_date) - new Date(trade.date)) / 86400000
));

let lessonText = '';
if (status === 'WIN') {
  if (hitTarget) {
    lessonText = `WINNER — ${trade.symbol} +${pnlPct.toFixed(1)}% in ${holdDays}d. Thesis confirmed: ${trade.thesis}. Exit reason: ${reason}.`;
  } else {
    lessonText = `WINNER (early exit) — ${trade.symbol} +${pnlPct.toFixed(1)}% in ${holdDays}d. Did not reach full target (${trade.target}). Early exit: ${reason}. Consider holding longer for target.`;
  }
} else if (status === 'LOSS') {
  if (hitStop) {
    lessonText = `STOPPED OUT — ${trade.symbol} ${pnlPct.toFixed(1)}% in ${holdDays}d. Stop loss hit at ${exitPrice}. Thesis was: ${trade.thesis}. What failed: ${reason}.`;
  } else {
    lessonText = `LOSS (manual exit) — ${trade.symbol} ${pnlPct.toFixed(1)}% in ${holdDays}d. Exited early before stop. Reason: ${reason}. Thesis was: ${trade.thesis}.`;
  }
} else {
  lessonText = `BREAKEVEN — ${trade.symbol} ${pnlPct.toFixed(1)}% in ${holdDays}d. ${reason}.`;
}

const newLesson = {
  id: lessons.lessons.length + 1,
  date: trade.exit_date,
  trade_id: tradeId,
  symbol: trade.symbol,
  outcome: status,
  pnl_pct: trade.pnl_pct,
  hold_days: holdDays,
  lesson: lessonText,
  tags: [
    trade.action.toLowerCase(),
    status.toLowerCase(),
    holdDays <= 1 ? 'intraday' : holdDays <= 3 ? 'short-swing' : 'swing',
  ],
};
lessons.lessons.push(newLesson);

// ── Record mistake if loss ──────────────────────────────────────────────────
if (status === 'LOSS') {
  const mistakeText = generateMistakeRule(trade, exitPrice, pnlPct, reason);
  mistakes.mistakes.push({
    id: mistakes.mistakes.length + 1,
    date: trade.exit_date,
    trade_id: tradeId,
    symbol: trade.symbol,
    rule: mistakeText,
    severity: Math.abs(pnlPct) > 5 ? 'high' : 'medium',
  });
}

// ── Update pattern stats ────────────────────────────────────────────────────
const patternTag = inferPattern(trade);
let pattern = patterns.patterns.find(p => p.name === patternTag);
if (!pattern) {
  pattern = { name: patternTag, trades: 0, wins: 0, losses: 0, total_pnl_pct: 0, win_rate_pct: null, avg_pnl_pct: null };
  patterns.patterns.push(pattern);
}
pattern.trades++;
if (status === 'WIN') pattern.wins++;
if (status === 'LOSS') pattern.losses++;
pattern.total_pnl_pct = Math.round((pattern.total_pnl_pct + pnlPct) * 100) / 100;
pattern.win_rate_pct = Math.round((pattern.wins / pattern.trades) * 100);
pattern.avg_pnl_pct = Math.round((pattern.total_pnl_pct / pattern.trades) * 100) / 100;

// ── Update performance stats ────────────────────────────────────────────────
const s = perf.summary;
s.total_trades++;
s.open_trades = Math.max(0, s.open_trades - 1);
if (status === 'WIN') s.wins++;
if (status === 'LOSS') s.losses++;
const closedTrades = journal.trades.filter(t => t.status !== 'OPEN' && t.pnl !== null);
s.win_rate_pct = s.total_trades > 0 ? Math.round((s.wins / s.total_trades) * 100) : null;
const wins = closedTrades.filter(t => t.status === 'WIN');
const losses = closedTrades.filter(t => t.status === 'LOSS');
s.avg_win_pct = wins.length ? Math.round(wins.reduce((a,t) => a + t.pnl_pct, 0) / wins.length * 100) / 100 : null;
s.avg_loss_pct = losses.length ? Math.round(losses.reduce((a,t) => a + t.pnl_pct, 0) / losses.length * 100) / 100 : null;
s.total_pnl_inr = Math.round(closedTrades.reduce((a,t) => a + (t.pnl || 0), 0) * 100) / 100;
s.current_capital_inr = Math.round((journal.account.starting_capital + s.total_pnl_inr) * 100) / 100;
s.peak_capital_inr = Math.max(s.peak_capital_inr, s.current_capital_inr);

// Update by-symbol stats
if (!perf.by_symbol[trade.symbol]) perf.by_symbol[trade.symbol] = { trades: 0, wins: 0, total_pnl_pct: 0 };
perf.by_symbol[trade.symbol].trades++;
if (status === 'WIN') perf.by_symbol[trade.symbol].wins++;
perf.by_symbol[trade.symbol].total_pnl_pct += pnlPct;

s.best_trade = wins.sort((a,b) => b.pnl_pct - a.pnl_pct)[0]?.symbol + ' +' + wins[0]?.pnl_pct + '%' || null;
s.worst_trade = losses.sort((a,b) => a.pnl_pct - b.pnl_pct)[0]?.symbol + ' ' + losses[0]?.pnl_pct + '%' || null;

// ── Add to journal log ──────────────────────────────────────────────────────
journal.account.current_capital = s.current_capital_inr;
journal.log.push({
  date: trade.exit_date,
  note: `CLOSED Trade #${tradeId} ${trade.symbol} @ ₹${exitPrice} | ${status} | P&L: ₹${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | ${reason}`,
});

// ── Save all files ──────────────────────────────────────────────────────────
writeJSON('trade-journal.json', journal);
writeJSON('brain/lessons.json', lessons);
writeJSON('brain/mistakes.json', mistakes);
writeJSON('brain/patterns.json', patterns);
writeJSON('brain/performance.json', perf);

console.log(`\n✅ Trade #${tradeId} closed.`);
console.log(`   ${trade.symbol} | ${status} | ₹${exitPrice} | P&L: ₹${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
console.log(`   Lesson saved to brain/lessons.json`);
if (status === 'LOSS') console.log(`   Mistake rule saved to brain/mistakes.json`);
console.log(`   Pattern "${patternTag}": ${pattern.win_rate_pct}% win rate over ${pattern.trades} trades`);
console.log(`\n📊 Overall: ${s.wins}W / ${s.losses}L | Win Rate: ${s.win_rate_pct}% | Capital: ₹${s.current_capital_inr}`);

// ── Helper functions ────────────────────────────────────────────────────────

function generateMistakeRule(trade, exitPrice, pnlPct, reason) {
  if (exitPrice <= trade.stop_loss) {
    return `Stop loss discipline: When ${trade.symbol}-type stocks show the setup in trade #${trade.id} (${trade.thesis.slice(0,80)}...) and the trade goes against you, do NOT hold below stop. Loss was ${pnlPct.toFixed(1)}%.`;
  }
  if (Math.abs(pnlPct) < 2) {
    return `Avoid small-loss exits without clear reason. Trade #${trade.id} exited at ${pnlPct.toFixed(1)}% with reason: "${reason}". If thesis is intact, hold to stop or target.`;
  }
  return `Trade #${trade.id} loss: ${reason}. Thesis: ${trade.thesis.slice(0,100)}. Avoid this setup when: review market conditions at time of entry.`;
}

function inferPattern(trade) {
  const thesis = (trade.thesis || '').toLowerCase();
  if (thesis.includes('recovery') || thesis.includes('bounce')) return 'post-crash-recovery';
  if (thesis.includes('breakout')) return 'breakout';
  if (thesis.includes('reversal')) return 'reversal';
  if (thesis.includes('momentum')) return 'momentum';
  if (thesis.includes('support')) return 'support-bounce';
  return 'swing-trade';
}
