#!/usr/bin/env node
/**
 * Trade journal Excel updater.
 * Reads trade-journal.json, fetches live prices from TradingView via CDP,
 * and writes a styled Excel file: trades/trade-journal.xlsx
 */
import ExcelJS from 'exceljs';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JOURNAL_PATH = resolve(ROOT, 'trade-journal.json');
const OUT_DIR = resolve(ROOT, 'trades');
const OUT_FILE = resolve(OUT_DIR, 'trade-journal.xlsx');

// ─── Fetch live prices using the project's core modules ──────────────────────

async function getLivePrices(symbols) {
  const prices = {};
  if (!symbols.length) return prices;
  try {
    const { evaluate, disconnect } = await import('../src/connection.js');
    const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
    const BARS_PATH = 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()';

    for (const sym of symbols) {
      try {
        // Switch symbol
        await evaluate(`(function(){ ${CHART_API}.setSymbol('${sym}', function(){}); })()`);
        await new Promise(r => setTimeout(r, 3000));
        // Read quote using same approach as core/data.js getQuote
        const data = await evaluate(`
          (function() {
            var api = ${CHART_API};
            var bars = ${BARS_PATH};
            var quote = {};
            if (bars && typeof bars.lastIndex === 'function') {
              var last = bars.valueAt(bars.lastIndex());
              if (last) { quote.last = last[4]; }
            }
            if (!quote.last) {
              try {
                var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
                if (hdr) { var p = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(p) && p > 0) quote.last = p; }
              } catch(e) {}
            }
            return quote;
          })()`);
        if (data?.last && data.last > 0) prices[sym] = data.last;
      } catch { /* skip this symbol */ }
    }
    await disconnect();
  } catch { /* CDP unavailable */ }
  return prices;
}

async function getLivePricesDirect(symbols) {
  return {}; // no-op fallback
}

// ─── Excel builder ───────────────────────────────────────────────────────────

const COLORS = {
  header: '1E3A5F',
  headerFont: 'FFFFFF',
  green: 'C6EFCE',
  greenFont: '276221',
  red: 'FFC7CE',
  redFont: '9C0006',
  neutral: 'FFEB9C',
  neutralFont: '9C6500',
  openBg: 'DEEBF7',
  openFont: '1F497D',
  rowAlt: 'F2F7FC',
  summaryBg: 'FFF2CC',
  summaryFont: '7F6000',
  profit: '00B050',
  loss: 'FF0000',
};

function styleCell(cell, { bold, color, bgColor, align, numFmt, border } = {}) {
  if (bold) cell.font = { ...(cell.font || {}), bold: true };
  if (color) cell.font = { ...(cell.font || {}), color: { argb: `FF${color}` } };
  if (bgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgColor}` } };
  if (align) cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
  if (numFmt) cell.numFmt = numFmt;
  if (border) {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      left: { style: 'thin', color: { argb: 'FFB0C4DE' } },
      right: { style: 'thin', color: { argb: 'FFB0C4DE' } },
    };
  }
}

async function buildExcel(journal, livePrices) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TradingView MCP — Claude';
  wb.created = new Date();
  wb.modified = new Date();

  // ── Sheet 1: Active Trades ─────────────────────────────────────────────────
  const ws = wb.addWorksheet('📈 Active Trades', {
    pageSetup: { fitToPage: true, orientation: 'landscape' },
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Title row
  ws.mergeCells('A1:N1');
  const title = ws.getCell('A1');
  title.value = `🤖 Claude Trade Journal  |  Started: ${journal.account.start_date}  |  Target: 2x by ${journal.account.target_date}  |  Last Updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
  styleCell(title, { bold: true, color: 'FFFFFF', bgColor: COLORS.header, align: 'center' });
  ws.getRow(1).height = 28;

  // Column headers
  const headers = [
    { header: '#', key: 'id', width: 5 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Symbol', key: 'symbol', width: 16 },
    { header: 'Action', key: 'action', width: 8 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Entry ₹', key: 'entry', width: 10 },
    { header: 'LTP ₹', key: 'ltp', width: 10 },
    { header: 'Target ₹', key: 'target', width: 10 },
    { header: 'Stop ₹', key: 'stop', width: 10 },
    { header: 'Shares', key: 'shares', width: 8 },
    { header: 'Capital ₹', key: 'capital', width: 12 },
    { header: 'P&L ₹', key: 'pnl', width: 12 },
    { header: 'P&L %', key: 'pnl_pct', width: 10 },
    { header: 'R:R', key: 'rr', width: 8 },
  ];

  ws.columns = headers.map(h => ({ key: h.key, width: h.width }));

  const hdrRow = ws.getRow(2);
  hdrRow.height = 22;
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h.header;
    styleCell(cell, { bold: true, color: COLORS.headerFont, bgColor: COLORS.header, align: 'center', border: true });
  });

  // Data rows
  let totalPnL = 0;
  let totalCapitalUsed = 0;

  journal.trades.forEach((trade, idx) => {
    const sym = trade.symbol.replace('NSE:', '').replace('BSE:', '');
    const ltp = livePrices[trade.symbol] || livePrices[sym] || trade.entry;
    const isOpen = trade.status === 'OPEN';
    const currentPrice = isOpen ? ltp : (trade.exit || trade.entry);
    const pnl = (currentPrice - trade.entry) * trade.shares * (trade.action === 'SELL' ? -1 : 1);
    const pnlPct = ((currentPrice - trade.entry) / trade.entry * 100) * (trade.action === 'SELL' ? -1 : 1);
    totalPnL += pnl;
    totalCapitalUsed += trade.capital_used;

    const row = ws.getRow(idx + 3);
    row.height = 20;
    const isAlt = idx % 2 === 1;
    const rowBg = isOpen ? COLORS.openBg : (pnl >= 0 ? COLORS.green : COLORS.red);

    const values = [
      trade.id,
      trade.date,
      sym,
      trade.action,
      trade.status,
      trade.entry,
      currentPrice,
      trade.target,
      trade.stop_loss,
      trade.shares,
      trade.capital_used,
      pnl,
      pnlPct / 100,
      trade.rr_ratio,
    ];

    values.forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val;
      const isNum = [5, 6, 7, 8, 10, 11].includes(i);
      const isPct = i === 12;
      const isCcy = [10, 11].includes(i);
      styleCell(cell, {
        bgColor: isAlt && !isOpen ? COLORS.rowAlt : rowBg,
        align: i === 2 ? 'left' : 'center',
        numFmt: isPct ? '0.00%' : isNum ? '#,##0.00' : isCcy ? '₹#,##0.00' : undefined,
        border: true,
        color: i === 12 ? (pnl >= 0 ? COLORS.profit : COLORS.loss) : undefined,
        bold: i === 12,
      });
    });

    // Status badge color
    const statusCell = row.getCell(5);
    if (trade.status === 'OPEN') styleCell(statusCell, { bold: true, color: COLORS.openFont, bgColor: COLORS.openBg });
    else if (trade.status === 'WIN') styleCell(statusCell, { bold: true, color: COLORS.greenFont, bgColor: COLORS.green });
    else if (trade.status === 'LOSS') styleCell(statusCell, { bold: true, color: COLORS.redFont, bgColor: COLORS.red });
  });

  // Summary row
  const summRow = ws.getRow(journal.trades.length + 3);
  summRow.height = 22;
  ws.mergeCells(`A${summRow.number}:J${summRow.number}`);
  const summLabel = summRow.getCell(1);
  summLabel.value = 'TOTAL P&L';
  styleCell(summLabel, { bold: true, bgColor: COLORS.summaryBg, color: COLORS.summaryFont, align: 'right', border: true });

  const pnlCell = summRow.getCell(12);
  pnlCell.value = totalPnL;
  styleCell(pnlCell, { bold: true, numFmt: '₹#,##0.00', bgColor: COLORS.summaryBg, color: totalPnL >= 0 ? COLORS.profit : COLORS.loss, align: 'center', border: true });

  const pnlPctTotal = (totalPnL / journal.account.starting_capital) * 100;
  const pnlPctCell = summRow.getCell(13);
  pnlPctCell.value = pnlPctTotal / 100;
  styleCell(pnlPctCell, { bold: true, numFmt: '0.00%', bgColor: COLORS.summaryBg, color: pnlPctTotal >= 0 ? COLORS.profit : COLORS.loss, align: 'center', border: true });

  // ── Sheet 2: Portfolio Summary ─────────────────────────────────────────────
  const ws2 = wb.addWorksheet('💰 Portfolio');
  ws2.columns = [{ width: 28 }, { width: 20 }];

  const addKV = (label, value, bold, bgColor, numFmt, color) => {
    const r = ws2.addRow([label, value]);
    r.height = 20;
    styleCell(r.getCell(1), { bold, bgColor, border: true, align: 'left' });
    styleCell(r.getCell(2), { bold, bgColor, numFmt, color, border: true, align: 'right' });
  };

  const currentCap = journal.account.starting_capital + totalPnL;
  const progressPct = ((currentCap - journal.account.starting_capital) / journal.account.starting_capital);
  const daysLeft = Math.max(0, Math.ceil((new Date(journal.account.target_date) - new Date()) / 86400000));

  ws2.addRow(['']);
  addKV('🚀  CLAUDE TRADE TRACKER', '', true, COLORS.header);
  ws2.addRow(['']);
  addKV('📅  Start Date', journal.account.start_date, false, COLORS.rowAlt);
  addKV('🏁  Target Date', journal.account.target_date, false, COLORS.rowAlt);
  addKV('⏳  Days Remaining', daysLeft, false, COLORS.rowAlt);
  ws2.addRow(['']);
  addKV('💵  Starting Capital', journal.account.starting_capital, true, COLORS.summaryBg, '₹#,##0.00');
  addKV('🎯  Target Capital (2x)', journal.account.target, true, COLORS.summaryBg, '₹#,##0.00');
  addKV('📊  Current Capital', currentCap, true, COLORS.summaryBg, '₹#,##0.00', currentCap >= journal.account.starting_capital ? COLORS.profit : COLORS.loss);
  addKV('📈  Total P&L', totalPnL, true, COLORS.summaryBg, '₹#,##0.00', totalPnL >= 0 ? COLORS.profit : COLORS.loss);
  addKV('📉  Progress to 2x', progressPct, true, COLORS.summaryBg, '0.00%', totalPnL >= 0 ? COLORS.profit : COLORS.loss);
  ws2.addRow(['']);
  addKV('🔢  Total Trades', journal.trades.length, false, COLORS.rowAlt);
  addKV('✅  Open Trades', journal.trades.filter(t => t.status === 'OPEN').length, false, COLORS.rowAlt);
  addKV('🏆  Wins', journal.trades.filter(t => t.status === 'WIN').length, false, COLORS.green);
  addKV('❌  Losses', journal.trades.filter(t => t.status === 'LOSS').length, false, COLORS.red);
  ws2.addRow(['']);
  addKV('🕐  Last Updated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST', false, COLORS.rowAlt);

  // ── Sheet 3: Trade Log ─────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('📝 Log');
  ws3.columns = [{ width: 14 }, { width: 90 }];
  const logHdr = ws3.getRow(1);
  ['Date', 'Note'].forEach((h, i) => {
    const cell = logHdr.getCell(i + 1);
    cell.value = h;
    styleCell(cell, { bold: true, color: COLORS.headerFont, bgColor: COLORS.header, border: true, align: 'center' });
  });
  logHdr.height = 22;

  journal.log.forEach((entry, idx) => {
    const r = ws3.addRow([entry.date, entry.note]);
    r.height = 18;
    const alt = idx % 2 === 1;
    styleCell(r.getCell(1), { bgColor: alt ? COLORS.rowAlt : 'FFFFFF', align: 'center', border: true });
    const noteCell = r.getCell(2);
    styleCell(noteCell, { bgColor: alt ? COLORS.rowAlt : 'FFFFFF', align: 'left', border: true });
    noteCell.alignment = { wrapText: true, vertical: 'top' };
  });

  return wb;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(JOURNAL_PATH)) {
    console.error('trade-journal.json not found at', JOURNAL_PATH);
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  // Get symbols for open trades
  const openSymbols = journal.trades
    .filter(t => t.status === 'OPEN')
    .map(t => t.symbol);

  console.log(`Fetching prices for: ${openSymbols.join(', ') || 'none (all closed)'}`);

  // Fetch live prices (best-effort via CDP)
  let livePrices = {};
  if (openSymbols.length > 0) {
    livePrices = await getLivePrices(openSymbols);
    // Fallback to direct connection module
    if (!Object.keys(livePrices).length) {
      livePrices = await getLivePricesDirect(openSymbols);
    }
    for (const [sym, price] of Object.entries(livePrices)) {
      console.log(`  ${sym}: ₹${price}`);
    }
    if (!Object.keys(livePrices).length) {
      console.log('  (live prices unavailable — using entry price for P&L)');
    }
  }

  const wb = await buildExcel(journal, livePrices);
  // If file is locked (open in Excel), write to a temp copy
  try {
    await wb.xlsx.writeFile(OUT_FILE);
  } catch (err) {
    if (err.code === 'EBUSY' || err.message.includes('busy') || err.message.includes('locked')) {
      const tmpFile = OUT_FILE.replace('.xlsx', '_latest.xlsx');
      await wb.xlsx.writeFile(tmpFile);
      console.log(`  (Main file locked by Excel — saved to: ${tmpFile})`);
      return;
    }
    throw err;
  }

  console.log(`\n✅ Excel updated: ${OUT_FILE}`);
  console.log(`   Trades: ${journal.trades.length} | Open: ${journal.trades.filter(t => t.status === 'OPEN').length}`);

  const totalPnL = journal.trades.reduce((sum, t) => {
    const price = livePrices[t.symbol] || t.exit || t.entry;
    return sum + (price - t.entry) * t.shares * (t.action === 'SELL' ? -1 : 1);
  }, 0);
  console.log(`   P&L: ₹${totalPnL.toFixed(2)} | Capital: ₹${(journal.account.starting_capital + totalPnL).toFixed(2)}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
