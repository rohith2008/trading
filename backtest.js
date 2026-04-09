/**
 * backtest.js — Historical backtester for the VWAP + RSI(3) + EMA(8) scalper
 * Uses BitGet historical candles to simulate trades and measure strategy performance.
 *
 * Usage: node backtest.js
 */
import { createHmac } from "crypto";
import https from "https";
import { existsSync, readFileSync, writeFileSync } from "fs";

readFileSync(new URL(".env", import.meta.url), "utf8")
  .split("\n")
  .forEach((line) => {
    const [k, ...v] = line.split("=");
    if (k && !k.startsWith("#") && v.length)
      process.env[k.trim()] = v.join("=").trim();
  });

const API_KEY = process.env.BITGET_API_KEY;
const SECRET_KEY = process.env.BITGET_SECRET_KEY;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;

// ── Config ──────────────────────────────────────────────────────
const SYMBOL       = "XRPUSDT";
const INITIAL_BAL  = 10000;
const RISK_PCT     = 0.02;
const RR_RATIO     = 2;
const ATR_MULT     = 1.5;
const ATR_PERIOD   = 14;
const VOL_MA       = 20;
const VOL_RATIO    = 1.2;
const FEE_BUY      = 0.000418;
const FEE_SELL     = 0.000668;
const SLIPPAGE     = 0.0005;

// ── HTTP ────────────────────────────────────────────────────────
function sign(ts, method, path, body = "") {
  return createHmac("sha256", SECRET_KEY).update(ts + method + path + body).digest("base64");
}

function request(method, path) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const sig = sign(ts, method, path);
    const req = https.request({
      hostname: "api.bitget.com", path, method,
      headers: {
        "Content-Type": "application/json",
        "ACCESS-KEY": API_KEY, "ACCESS-SIGN": sig,
        "ACCESS-TIMESTAMP": ts, "ACCESS-PASSPHRASE": PASSPHRASE, locale: "en-US",
      },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchCandles(granularity = "1min", limit = 500) {
  const res = await request("GET", `/api/v2/spot/market/candles?symbol=${SYMBOL}&granularity=${granularity}&limit=${limit}`);
  return (res.data || []).reverse().map((c) => ({
    ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
    low: parseFloat(c[3]), close: parseFloat(c[4]), vol: parseFloat(c[5]),
  }));
}

// ── Indicators ──────────────────────────────────────────────────
function ema(arr, p) {
  const k = 2 / (p + 1); let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsi(arr, p = 3) {
  if (arr.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = arr.length - p; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

function vwap(candles) {
  let tpv = 0, vol = 0;
  for (const c of candles) { const tp = (c.high + c.low + c.close) / 3; tpv += tp * c.vol; vol += c.vol; }
  return vol === 0 ? candles[candles.length - 1].close : tpv / vol;
}

function atr(candles, p = ATR_PERIOD) {
  if (candles.length < p + 1) return candles[candles.length - 1].high - candles[candles.length - 1].low;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high: h, low: l } = candles[i], pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = trs.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = p; i < trs.length; i++) a = (a * (p - 1) + trs[i]) / p;
  return a;
}

function volActive(candles) {
  if (candles.length < VOL_MA + 1) return true;
  const vols = candles.map((c) => c.vol);
  const avg = vols.slice(-VOL_MA - 1, -1).reduce((a, b) => a + b, 0) / VOL_MA;
  return vols[vols.length - 1] >= avg * VOL_RATIO;
}

// ── Backtest ────────────────────────────────────────────────────
async function runBacktest() {
  console.log(`\n🔬 Backtesting ${SYMBOL} — last 500 1-min candles\n`);
  const candles = await fetchCandles("1min", 500);
  console.log(`Loaded ${candles.length} candles\n`);

  let balance = INITIAL_BAL;
  let holding = false;
  let entryPrice = 0, entryQty = 0, entryStop = 0, entryTP = 0, entryCost = 0;
  const trades = [];

  for (let i = 30; i < candles.length; i++) {
    const window = candles.slice(i - 30, i + 1);
    const last = window[window.length - 1].close;
    const closes = window.map((c) => c.close);
    const e8 = ema(closes, 8);
    const r3 = rsi(closes, 3);
    const v = vwap(window);
    const a = atr(window);
    const active = volActive(window);
    const stopDist = a * ATR_MULT;

    if (holding) {
      // Check stop or TP
      if (last <= entryStop || last >= entryTP) {
        const sellFee = last * entryQty * (FEE_SELL + SLIPPAGE);
        const gross = last * entryQty - entryCost;
        const net = gross - sellFee;
        balance += last * entryQty - sellFee;
        trades.push({ entry: entryPrice, exit: last, qty: entryQty, gross: +gross.toFixed(4), net: +net.toFixed(4), exit_reason: last <= entryStop ? "stop" : "tp" });
        holding = false;
      }
    } else {
      const bullBias = last > v && last > e8;
      if (active && bullBias && r3 < 30) {
        const riskAmt = balance * RISK_PCT;
        const qty = Math.min(riskAmt / stopDist, balance / last * 0.99);
        const buyFee = last * qty * (FEE_BUY + SLIPPAGE);
        entryCost = last * qty + buyFee;
        if (entryCost <= balance) {
          balance -= entryCost;
          entryPrice = last; entryQty = qty;
          entryStop = last - stopDist;
          entryTP = last + stopDist * RR_RATIO;
          holding = true;
        }
      }
    }
  }

  // Force close at end
  if (holding) {
    const exitPrice = candles[candles.length - 1].close;
    const sellFee = exitPrice * entryQty * (FEE_SELL + SLIPPAGE);
    const gross = exitPrice * entryQty - entryCost;
    const net = gross - sellFee;
    balance += exitPrice * entryQty - sellFee;
    trades.push({ entry: entryPrice, exit: exitPrice, qty: entryQty, gross: +gross.toFixed(4), net: +net.toFixed(4), exit_reason: "end" });
  }

  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const totalNet = trades.reduce((s, t) => s + t.net, 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : 0;
  const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + t.net, 0) / wins.length).toFixed(4) : 0;
  const avgLoss = losses.length > 0 ? (losses.reduce((s, t) => s + t.net, 0) / losses.length).toFixed(4) : 0;
  const profitFactor = losses.length > 0 ? Math.abs(wins.reduce((s, t) => s + t.net, 0) / losses.reduce((s, t) => s + t.net, 0)).toFixed(2) : "∞";

  console.log(`${"═".repeat(50)}`);
  console.log(`  📊 BACKTEST RESULTS`);
  console.log(`${"═".repeat(50)}`);
  console.log(`  Start Balance : $${INITIAL_BAL.toFixed(2)}`);
  console.log(`  End Balance   : $${balance.toFixed(2)}`);
  console.log(`  Total Return  : ${((balance - INITIAL_BAL) / INITIAL_BAL * 100).toFixed(2)}%`);
  console.log(`  Net P&L       : ${totalNet >= 0 ? "+" : ""}$${totalNet.toFixed(4)}`);
  console.log(`${"─".repeat(50)}`);
  console.log(`  Total Trades  : ${trades.length} (${wins.length}W / ${losses.length}L)`);
  console.log(`  Win Rate      : ${winRate}%`);
  console.log(`  Avg Win       : +$${avgWin}`);
  console.log(`  Avg Loss      : $${avgLoss}`);
  console.log(`  Profit Factor : ${profitFactor}`);
  console.log(`${"═".repeat(50)}\n`);

  writeFileSync("backtest-results.json", JSON.stringify({ summary: { startBalance: INITIAL_BAL, endBalance: +balance.toFixed(2), returnPct: +((balance - INITIAL_BAL) / INITIAL_BAL * 100).toFixed(2), totalTrades: trades.length, winRate: +winRate, profitFactor: +profitFactor }, trades }, null, 2));
  console.log(`Results saved to backtest-results.json\n`);
}

runBacktest().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
