#!/usr/bin/env node
/**
 * Trade journal Excel updater (one-shot).
 * Reads trade-journal.json, fetches live prices from TradingView via CDP,
 * and writes a fully-styled 3-sheet Excel file: trades/trade-journal.xlsx
 *
 * For continuous live updates, use price_watcher.js (auto_update.bat) instead.
 */
import ExcelJS from 'exceljs';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = resolve(__dirname, '..');
const JOURNAL_PATH = resolve(ROOT, 'trade-journal.json');
const OUT_DIR      = resolve(ROOT, 'trades');
const OUT_FILE     = resolve(OUT_DIR, 'trade-journal.xlsx');

// ── Live price fetch (one-shot, chart-switching) ──────────────────────────────
async function getLivePrices(symbols) {
  if (!symbols.length) return {};
  const prices = {};
  let disconnect;
  try {
    const mod      = await import('../src/connection.js');
    const evaluate = mod.evaluate;
    disconnect     = mod.disconnect;

    const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
    const BARS_PATH = `${CHART_API}._chartWidget.model().mainSeries().bars()`;

    for (const sym of symbols) {
      try {
        await evaluate(
          `new Promise(function(resolve) { ${CHART_API}.setSymbol('${sym}', function(){ setTimeout(resolve, 800); }); })`,
          { awaitPromise: true },
        );
        const data = await evaluate(`
          (function () {
            var bars = ${BARS_PATH};
            if (bars && typeof bars.lastIndex === 'function') {
              var bar = bars.valueAt(bars.lastIndex());
              if (bar) return { last: bar[4] };
            }
            var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
            if (hdr) {
              var p = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, ''));
              if (!isNaN(p) && p > 0) return { last: p };
            }
            return {};
          })()`);
        if (data?.last > 0) prices[sym] = data.last;
        else console.warn(`  [warn] No price for ${sym} — bars may not have loaded`);
      } catch (err) {
        console.warn(`  [warn] Failed to fetch ${sym}: ${err.message}`);
      }
    }
    await disconnect();
  } catch (err) {
    console.warn(`  [warn] CDP unavailable — live prices skipped: ${err.message}`);
    if (disconnect) await disconnect().catch(() => {});
  }
  return prices;
}

// ── Styling helpers ───────────────────────────────────────────────────────────
const COLORS = {
  header:     '1E3A5F',
  headerFont: 'FFFFFF',
  green:      'C6EFCE',
  greenFont:  '276221',
  red:        'FFC7CE',
  redFont:    '9C0006',
  openBg:     'DEEBF7',
  openFont:   '1F497D',
  rowAlt:     'F2F7FC',
  summaryBg:  'FFF2CC',
  summaryFont:'7F6000',
  profit:     '00B050',
  loss:       'FF0000',
};

const THIN_BORDER = { style: 'thin', color: { argb: 'FFB0C4DE' } };

function styleCell(cell, { bold, color, bgColor, align, numFmt, border } = {}) {
  if (bold)    cell.font      = { ...(cell.font || {}), bold: true };
  if (color)   cell.font      = { ...(cell.font || {}), color: { argb: `FF${color}` } };
  if (bgColor) cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgColor}` } };
  if (align)   cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
  if (numFmt)  cell.numFmt    = numFmt;
  if (border)  cell.border    = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
}

// ── Excel builder (exported for use by price_watcher.js) ─────────────────────
export async function buildExcel(journal, livePrices) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'TradingView MCP — Claude';
  wb.created  = new Date();
  wb.modified = new Date();

  // ── Sheet 1: Active Trades ──────────────────────────────────────────────────
  const ws = wb.addWorksheet('📈 Active Trades', {
    pageSetup: { fitToPage: true, orientation: 'landscape' },
    views:     [{ state: 'frozen', ySplit: 3 }],
  });

  // Title row (spans all 14 columns)
  ws.mergeCells('A1:N1');
  const title = ws.getCell('A1');
  title.value = `🤖 Claude Trade Journal  |  Started: ${journal.account.start_date}  |  Target: 2x by ${journal.account.target_date}  |  Last Updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
  styleCell(title, { bold: true, color: 'FFFFFF', bgColor: COLORS.header, align: 'center' });
  ws.getRow(1).height = 28;

  // Column headers
  const headers = [
    { header: '#',         key: 'id',      width: 5  },
    { header: 'Date',      key: 'date',    width: 12 },
    { header: 'Symbol',    key: 'symbol',  width: 16 },
    { header: 'Action',    key: 'action',  width: 8  },
    { header: 'Status',    key: 'status',  width: 10 },
    { header: 'Entry ₹',   key: 'entry',   width: 10 },
    { header: 'LTP ₹',     key: 'ltp',     width: 10 },
    { header: 'Target ₹',  key: 'target',  width: 10 },
    { header: 'Stop ₹',    key: 'stop',    width: 10 },
    { header: 'Shares',    key: 'shares',  width: 8  },
    { header: 'Capital ₹', key: 'capital', width: 12 },
    { header: 'P&L ₹',     key: 'pnl',     width: 12 },
    { header: 'P&L %',     key: 'pnl_pct', width: 10 },
    { header: 'R:R',       key: 'rr',      width: 8  },
  ];

  ws.columns = headers.map((h) => ({ key: h.key, width: h.width }));
  const hdrRow = ws.getRow(2);
  hdrRow.height = 22;
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h.header;
    styleCell(cell, { bold: true, color: COLORS.headerFont, bgColor: COLORS.header, align: 'center', border: true });
  });

  // Data rows
  let totalPnL = 0;
  journal.trades.forEach((trade, idx) => {
    const sym          = trade.symbol.replace(/^(NSE|BSE):/, '');
    const ltp          = livePrices[trade.symbol] || livePrices[sym] || trade.entry;
    const isOpen       = trade.status === 'OPEN';
    const currentPrice = isOpen ? ltp : (trade.exit || trade.entry);
    const dir          = trade.action === 'SELL' ? -1 : 1;
    const pnl          = (currentPrice - trade.entry) * trade.shares * dir;
    const pnlPct       = (currentPrice - trade.entry) / trade.entry * 100 * dir;
    totalPnL += pnl;

    const row   = ws.getRow(idx + 3);
    row.height  = 20;
    const isAlt = idx % 2 === 1;
    const rowBg = isOpen ? COLORS.openBg : (pnl >= 0 ? COLORS.green : COLORS.red);

    [
      trade.id, trade.date, sym, trade.action, trade.status,
      trade.entry, currentPrice, trade.target, trade.stop_loss,
      trade.shares, trade.capital_used, pnl, pnlPct / 100, trade.rr_ratio,
    ].forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val;
      styleCell(cell, {
        bgColor: isAlt && !isOpen ? COLORS.rowAlt : rowBg,
        align:   i === 2 ? 'left' : 'center',
        numFmt:  i === 12 ? '0.00%' : [5,6,7,8,10,11].includes(i) ? '#,##0.00' : undefined,
        border:  true,
        color:   i === 12 ? (pnl >= 0 ? COLORS.profit : COLORS.loss) : undefined,
        bold:    i === 12,
      });
    });

    // Status badge
    const statusCell = row.getCell(5);
    if      (trade.status === 'OPEN') styleCell(statusCell, { bold: true, color: COLORS.openFont,  bgColor: COLORS.openBg });
    else if (trade.status === 'WIN')  styleCell(statusCell, { bold: true, color: COLORS.greenFont, bgColor: COLORS.green  });
    else if (trade.status === 'LOSS') styleCell(statusCell, { bold: true, color: COLORS.redFont,   bgColor: COLORS.red    });
  });

  // Summary row
  const summRow = ws.getRow(journal.trades.length + 3);
  summRow.height = 22;
  ws.mergeCells(`A${summRow.number}:J${summRow.number}`);
  styleCell(summRow.getCell(1), { bold: true, bgColor: COLORS.summaryBg, color: COLORS.summaryFont, align: 'right', border: true });
  summRow.getCell(1).value = 'TOTAL P&L';

  const pnlCell = summRow.getCell(12);
  pnlCell.value = totalPnL;
  styleCell(pnlCell, { bold: true, numFmt: '₹#,##0.00', bgColor: COLORS.summaryBg, color: totalPnL >= 0 ? COLORS.profit : COLORS.loss, align: 'center', border: true });

  const pnlPctTotal = totalPnL / journal.account.starting_capital;
  const pnlPctCell  = summRow.getCell(13);
  pnlPctCell.value  = pnlPctTotal;
  styleCell(pnlPctCell, { bold: true, numFmt: '0.00%', bgColor: COLORS.summaryBg, color: pnlPctTotal >= 0 ? COLORS.profit : COLORS.loss, align: 'center', border: true });

  // ── Account snapshot box (columns P:Q, rows 2–12) — visible without switching sheets ──
  const currentCap   = journal.account.starting_capital + totalPnL;
  const toTarget     = journal.account.target - currentCap;
  const progressPct  = totalPnL / journal.account.starting_capital;
  const openTrades   = journal.trades.filter((t) => t.status === 'OPEN');
  const capitalInUse = openTrades.reduce((s, t) => s + (t.capital_used || 0), 0);
  const freeCapital  = currentCap - capitalInUse;
  const wins         = journal.trades.filter((t) => t.status === 'WIN').length;
  const losses       = journal.trades.filter((t) => t.status === 'LOSS').length;
  const closedCount  = wins + losses;
  const winRate      = closedCount > 0 ? wins / closedCount : 0;

  // Set column widths for P and Q
  ws.getColumn(16).width = 22;
  ws.getColumn(17).width = 16;

  const snapshotRows = [
    { label: '💼 ACCOUNT SNAPSHOT', value: '',           labelBg: COLORS.header,     labelColor: 'FFFFFF', bold: true,  numFmt: undefined },
    { label: '💵 Starting Capital',  value: journal.account.starting_capital, labelBg: COLORS.rowAlt, numFmt: '₹#,##0.00' },
    { label: '📊 Current Capital',   value: currentCap,  labelBg: COLORS.rowAlt,     valueColor: currentCap >= journal.account.starting_capital ? COLORS.profit : COLORS.loss, numFmt: '₹#,##0.00', bold: true },
    { label: '💰 Total Profit / Loss',value: totalPnL,   labelBg: COLORS.summaryBg,  valueColor: totalPnL >= 0 ? COLORS.profit : COLORS.loss, numFmt: '₹#,##0.00', bold: true },
    { label: '📈 Return %',           value: progressPct, labelBg: COLORS.summaryBg, valueColor: progressPct >= 0 ? COLORS.profit : COLORS.loss, numFmt: '0.00%', bold: true },
    { label: '🎯 Left to 2× Target', value: Math.max(0, toTarget), labelBg: COLORS.rowAlt, numFmt: '₹#,##0.00' },
    { label: '🔓 Free Capital',       value: freeCapital, labelBg: COLORS.rowAlt,    valueColor: COLORS.profit, numFmt: '₹#,##0.00' },
    { label: '🔒 Capital in Trades',  value: capitalInUse,labelBg: COLORS.rowAlt,    numFmt: '₹#,##0.00' },
    { label: '📋 Open Trades',        value: openTrades.length, labelBg: COLORS.openBg },
    { label: '🏆 Win Rate',           value: winRate,     labelBg: closedCount > 0 ? (winRate >= 0.5 ? COLORS.green : COLORS.red) : COLORS.rowAlt, valueColor: winRate >= 0.5 ? COLORS.greenFont : COLORS.redFont, numFmt: '0.0%', bold: true },
    { label: `✅ ${wins}W  ❌ ${losses}L  (${closedCount} closed)`, value: '', labelBg: COLORS.rowAlt },
  ];

  snapshotRows.forEach((row, i) => {
    const r   = ws.getRow(i + 2);  // start at row 2 (below title bar)
    const lbl = r.getCell(16);     // column P
    const val = r.getCell(17);     // column Q
    lbl.value = row.label;
    val.value = row.value !== '' ? row.value : undefined;
    styleCell(lbl, { bold: row.bold, bgColor: row.labelBg, color: row.labelColor, align: 'left',   border: true });
    styleCell(val, { bold: row.bold, bgColor: row.labelBg, color: row.valueColor, align: 'center', border: true, numFmt: row.numFmt });
    r.getCell(16).font = { ...(r.getCell(16).font || {}), size: i === 0 ? 11 : 10 };
  });

  // ── Sheet 2: Portfolio Summary ───────────────────────────────────────────────
  const ws2 = wb.addWorksheet('💰 Portfolio');
  ws2.columns = [{ width: 28 }, { width: 20 }];

  const addKV = (label, value, bold, bgColor, numFmt, color) => {
    const r = ws2.addRow([label, value]);
    r.height = 20;
    styleCell(r.getCell(1), { bold, bgColor, border: true, align: 'left' });
    styleCell(r.getCell(2), { bold, bgColor, numFmt, color, border: true, align: 'right' });
  };

  const daysLeft    = Math.max(0, Math.ceil((new Date(journal.account.target_date) - new Date()) / 86_400_000));
  const fx          = journal.forex_account;
  const fxCapital   = fx ? fx.current_capital : 0;
  const fxPnL       = fx ? fxCapital - fx.starting_capital : 0;
  const totalStart  = journal.account.starting_capital + (fx?.starting_capital || 0);
  const combinedCap = currentCap + fxCapital;
  const combinedPnL = totalPnL + fxPnL;
  const combinedPct = combinedPnL / totalStart;

  ws2.addRow(['']);
  addKV('🚀  CLAUDE TRADE TRACKER', '', true, COLORS.header);
  ws2.addRow(['']);

  // Combined overview
  addKV('💼  COMBINED BALANCE',     combinedCap,              true,  COLORS.summaryBg, '₹#,##0.00', combinedPnL >= 0 ? COLORS.profit : COLORS.loss);
  addKV('🎯  Combined Goal (4x)',   journal.account.target,   true,  COLORS.summaryBg, '₹#,##0.00');
  addKV('📈  Combined P&L',         combinedPnL,              true,  COLORS.summaryBg, '₹#,##0.00', combinedPnL >= 0 ? COLORS.profit : COLORS.loss);
  addKV('📉  Combined Progress',    combinedPct,              true,  COLORS.summaryBg, '0.00%',     combinedPct >= 0 ? COLORS.profit : COLORS.loss);
  ws2.addRow(['']);

  // NSE Account
  addKV('📈  NSE STOCKS ACCOUNT',   '',                       true,  COLORS.header);
  addKV('📅  Start Date',           journal.account.start_date,  false, COLORS.rowAlt);
  addKV('🏁  Target Date',          journal.account.target_date, false, COLORS.rowAlt);
  addKV('⏳  Days Remaining',       daysLeft,                    false, COLORS.rowAlt);
  addKV('💵  Starting Capital',     journal.account.starting_capital, false, COLORS.rowAlt, '₹#,##0.00');
  addKV('📊  Current Capital',      currentCap, true, COLORS.summaryBg, '₹#,##0.00', currentCap >= journal.account.starting_capital ? COLORS.profit : COLORS.loss);
  addKV('📈  NSE P&L',              totalPnL,   true, COLORS.summaryBg, '₹#,##0.00', totalPnL   >= 0 ? COLORS.profit : COLORS.loss);
  addKV('📉  NSE Progress',         progressPct,true, COLORS.summaryBg, '0.00%',     totalPnL   >= 0 ? COLORS.profit : COLORS.loss);
  ws2.addRow(['']);

  // Forex Account
  if (fx) {
    addKV('💱  FOREX ACCOUNT',        '',           true,  COLORS.header);
    addKV('💵  Forex Starting Cap',   fx.starting_capital, false, COLORS.rowAlt, '₹#,##0.00');
    addKV('📊  Forex Current Cap',    fxCapital,    true,  COLORS.summaryBg, '₹#,##0.00', fxCapital >= fx.starting_capital ? COLORS.profit : COLORS.loss);
    addKV('📈  Forex P&L',            fxPnL,        true,  COLORS.summaryBg, '₹#,##0.00', fxPnL >= 0 ? COLORS.profit : COLORS.loss);
    if (fx.usd_inr_rate) addKV('💲  USD/INR Rate', fx.usd_inr_rate, false, COLORS.rowAlt, '0.00');
    ws2.addRow(['']);
  }

  // Trade stats
  addKV('🔢  Total Trades', journal.trades.length,                                     false, COLORS.rowAlt);
  addKV('✅  Open Trades',  journal.trades.filter((t) => t.status === 'OPEN').length,  false, COLORS.rowAlt);
  addKV('🏆  Wins',         journal.trades.filter((t) => t.status === 'WIN').length,   false, COLORS.green);
  addKV('❌  Losses',       journal.trades.filter((t) => t.status === 'LOSS').length,  false, COLORS.red);
  ws2.addRow(['']);
  addKV('🕐  Last Updated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST', false, COLORS.rowAlt);

  // ── Sheet 3: Trade Log ───────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('📝 Log');
  ws3.columns = [{ width: 14 }, { width: 90 }];

  const logHdr = ws3.getRow(1);
  logHdr.height = 22;
  ['Date', 'Note'].forEach((h, i) => {
    const cell = logHdr.getCell(i + 1);
    cell.value = h;
    styleCell(cell, { bold: true, color: COLORS.headerFont, bgColor: COLORS.header, border: true, align: 'center' });
  });

  journal.log.forEach((entry, idx) => {
    const r  = ws3.addRow([entry.date, entry.note]);
    r.height = 18;
    const bg = idx % 2 === 1 ? COLORS.rowAlt : 'FFFFFF';
    styleCell(r.getCell(1), { bgColor: bg, align: 'center', border: true });
    const noteCell = r.getCell(2);
    styleCell(noteCell, { bgColor: bg, align: 'left', border: true });
    noteCell.alignment = { wrapText: true, vertical: 'top' };
  });

  return wb;
}

// ── Main (standalone run only) ────────────────────────────────────────────────
async function main() {
  if (!existsSync(JOURNAL_PATH)) {
    console.error('trade-journal.json not found at', JOURNAL_PATH);
    process.exit(1);
  }

  const journal     = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
  const openSymbols = journal.trades.filter((t) => t.status === 'OPEN').map((t) => t.symbol);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Fetching prices for: ${openSymbols.join(', ') || 'none (all closed)'}`);
  const livePrices = await getLivePrices(openSymbols);

  for (const [sym, price] of Object.entries(livePrices)) console.log(`  ${sym}: ₹${price}`);
  if (!Object.keys(livePrices).length && openSymbols.length)
    console.log('  (live prices unavailable — using entry price for P&L)');

  const wb = await buildExcel(journal, livePrices);
  try {
    await wb.xlsx.writeFile(OUT_FILE);
  } catch (err) {
    if (err.code === 'EBUSY' || err.message.includes('busy') || err.message.includes('locked')) {
      const tmp = OUT_FILE.replace('.xlsx', '_latest.xlsx');
      await wb.xlsx.writeFile(tmp);
      console.log(`  (file locked — saved to: ${tmp})`);
      return;
    }
    throw err;
  }

  const totalPnL = journal.trades.reduce((sum, t) => {
    const price = livePrices[t.symbol] || t.exit || t.entry;
    return sum + (price - t.entry) * t.shares * (t.action === 'SELL' ? -1 : 1);
  }, 0);

  console.log(`\n✅ Excel updated: ${OUT_FILE}`);
  console.log(`   Trades: ${journal.trades.length} | Open: ${openSymbols.length}`);
  console.log(`   P&L: ₹${totalPnL.toFixed(2)} | Capital: ₹${(journal.account.starting_capital + totalPnL).toFixed(2)}`);
}

// Guard: only execute when run directly, not when imported
const __self = fileURLToPath(import.meta.url);
if (process.argv[1] === __self || process.argv[1]?.replace(/\\/g, '/') === __self.replace(/\\/g, '/')) {
  main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
}
