import { createHmac } from "crypto";
import https from "https";
import { existsSync, readFileSync, writeFileSync } from "fs";

// ── Environment ──────────────────────────────────────────────────────────────
try {
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n")
    .forEach((line) => {
      const [k, ...v] = line.split("=");
      if (k && !k.startsWith("#") && v.length)
        process.env[k.trim()] = v.join("=").trim();
    });
} catch {
  console.warn("⚠️  .env file not found — using environment variables only");
}

const API_KEY    = process.env.BITGET_API_KEY;
const SECRET_KEY = process.env.BITGET_SECRET_KEY;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;

// ── Strategy config ──────────────────────────────────────────────────────────
const SYMBOL        = "XRPUSDT";  // XRP/USDT spot
const INTERVAL_MS   = 10_000;     // 10 s between ticks
const TOTAL_TRADES  = 9999;       // run until market close or Ctrl+C
const RISK_PCT      = 0.02;       // 2% account risk per trade
const RR_RATIO      = 2.5;        // take-profit = 2.5× stop distance
const ATR_PERIOD    = 14;
const ATR_MULTIPLIER = 2;         // stop = 2× ATR from entry

// ── Fees & slippage (Estimated Crypto Spot fees) ────────────────────────────
// The constants below simulate typical taker/maker fees + buffers.
const FEE_BUY  = 0.000418;
const FEE_SELL = 0.000668;
const SLIPPAGE = 0.0005;  // 0.05% per side (market order spread)

// ── Filters ──────────────────────────────────────────────────────────────────
const VOL_MA_PERIOD = 20;   // volume must be ≥ VOL_MIN_RATIO × 20-bar average
const VOL_MIN_RATIO = 1.2;

// ── Demo / live ──────────────────────────────────────────────────────────────
const DEMO_MODE    = true;
const DEMO_BALANCE = 10_000;  // virtual starting balance ($)

// ── Market hours (IST) ───────────────────────────────────────────────────────
const MARKET_OPEN_H  = 9,  MARKET_OPEN_M  = 15;  // 9:15 AM IST
const MARKET_CLOSE_H = 15, MARKET_CLOSE_M = 30;  // 3:30 PM IST

function getISTTime() {
  // IST = UTC + 5:30. Add to UTC ms so result is timezone-independent.
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function isMarketOpen() {
  const ist  = getISTTime();
  const day  = ist.getUTCDay();  // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins  = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= MARKET_OPEN_H * 60 + MARKET_OPEN_M &&
         mins  < MARKET_CLOSE_H * 60 + MARKET_CLOSE_M;
}

function getMarketStatusMsg() {
  const ist = getISTTime();
  const day = ist.getUTCDay();
  const h   = ist.getUTCHours();
  const m   = ist.getUTCMinutes();
  const pad = (n) => String(n).padStart(2, "0");
  const t   = `${pad(h)}:${pad(m)} IST`;
  if (day === 0 || day === 6) return `Market CLOSED — weekend (${t})`;
  const mins  = h * 60 + m;
  const open  = MARKET_OPEN_H  * 60 + MARKET_OPEN_M;
  const close = MARKET_CLOSE_H * 60 + MARKET_CLOSE_M;
  if (mins < open)  return `Market not open yet — opens 9:15 AM IST (now ${t})`;
  if (mins >= close) return `Market CLOSED — closed at 3:30 PM IST (now ${t})`;
  return `Market OPEN (${t})`;
}

// ── BitGet HTTP ──────────────────────────────────────────────────────────────
function sign(ts, method, path, body = "") {
  return createHmac("sha256", SECRET_KEY)
    .update(ts + method + path + body)
    .digest("base64");
}

function request(method, path, body = null, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const ts      = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : "";
    const hasKeys = API_KEY && SECRET_KEY && PASSPHRASE;
    const headers = { "Content-Type": "application/json", locale: "en-US" };
    if (hasKeys) {
      headers["ACCESS-KEY"]        = API_KEY;
      headers["ACCESS-SIGN"]       = sign(ts, method, path, bodyStr);
      headers["ACCESS-TIMESTAMP"]  = ts;
      headers["ACCESS-PASSPHRASE"] = PASSPHRASE;
    }
    const req = https.request(
      {
        hostname: "api.bitget.com",
        path,
        method,
        headers,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try   { resolve(JSON.parse(d)); }
          catch { reject(new Error(`Bad JSON from ${path}: ${d.slice(0, 80)}`)); }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout: ${method} ${path}`)));
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Demo paper trading ───────────────────────────────────────────────────────
const demo = { usdt: DEMO_BALANCE, xrp: 0, orderCount: 0 };

function demoBuy(price, size) {
  const qty  = parseFloat(size);
  const cost = price * qty * (1 + FEE_BUY + SLIPPAGE);
  if (cost > demo.usdt) return { code: "ERR", msg: "Insufficient demo balance" };
  demo.usdt -= cost;
  demo.xrp  += qty;
  return { code: "00000", data: { orderId: `DEMO-${++demo.orderCount}` } };
}

function demoSell(size) {
  const qty = parseFloat(size);
  if (qty > demo.xrp) return { code: "ERR", msg: "Insufficient demo XRP" };
  demo.xrp -= qty;
  return { code: "00000", data: { orderId: `DEMO-${++demo.orderCount}` } };
}

function demoGetBalances() {
  return { usdt: demo.usdt, xrp: demo.xrp };
}

// ── Market data ──────────────────────────────────────────────────────────────
function parseCandles(res) {
  return (res.data || []).map((c) => ({
    ts:    parseInt(c[0]),
    open:  parseFloat(c[1]),
    high:  parseFloat(c[2]),
    low:   parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol:   parseFloat(c[5]),
  }));
}

async function getCandles(symbol, limit = 30) {
  return parseCandles(
    await request("GET", `/api/v2/spot/market/candles?symbol=${symbol}&granularity=1min&limit=${limit}`),
  );
}

async function getCandles5m(symbol, limit = 20) {
  return parseCandles(
    await request("GET", `/api/v2/spot/market/candles?symbol=${symbol}&granularity=5min&limit=${limit}`),
  );
}

async function getPrice(symbol) {
  const res = await request("GET", `/api/v2/spot/market/tickers?symbol=${symbol}`);
  return parseFloat(res.data?.[0]?.lastPr || 0);
}

async function getBalances() {
  if (DEMO_MODE) return demoGetBalances();
  const res  = await request("GET", "/api/v2/spot/account/assets");
  const usdt = res.data?.find((a) => a.coin === "USDT");
  const xrp  = res.data?.find((a) => a.coin === "XRP");
  return {
    usdt: parseFloat(usdt?.available || 0),
    xrp:  parseFloat(xrp?.available  || 0),
  };
}

// ── Indicators ───────────────────────────────────────────────────────────────
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  return closes.reduce((ema, c, i) => i === 0 ? c : c * k + ema * (1 - k));
}

function calcRSI(closes, period = 3) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    diff > 0 ? (gains += diff) : (losses -= diff);
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function calcVWAP(candles) {
  let tpv = 0, vol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    tpv += tp * c.vol;
    vol += c.vol;
  }
  return vol === 0 ? candles.at(-1).close : tpv / vol;
}

function calcATR(candles, period = ATR_PERIOD) {
  if (candles.length < period + 1)
    return candles.at(-1).high - candles.at(-1).low;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

function isVolumeActive(candles) {
  if (candles.length < VOL_MA_PERIOD + 1) return true;
  const vols   = candles.map((c) => c.vol);
  const avgVol = vols.slice(-VOL_MA_PERIOD - 1, -1).reduce((a, b) => a + b, 0) / VOL_MA_PERIOD;
  return vols.at(-1) >= avgVol * VOL_MIN_RATIO;
}

function getHTFTrend(candles5m) {
  if (!candles5m || candles5m.length < 5) return "neutral";
  const closes = candles5m.map((c) => c.close);
  const ema21  = calcEMA(closes, Math.min(21, closes.length));
  const last   = closes.at(-1);
  return last > ema21 ? "bull" : last < ema21 ? "bear" : "neutral";
}

// ── Signal ───────────────────────────────────────────────────────────────────
function getSignal(candles, candles5m) {
  const closes    = candles.map((c) => c.close);
  const last      = closes.at(-1);
  const ema8      = calcEMA(closes, 8);
  const rsi3      = calcRSI(closes, 3);
  const vwap      = calcVWAP(candles);
  const atr       = calcATR(candles);
  const volActive = isVolumeActive(candles);
  const htfTrend  = getHTFTrend(candles5m);

  let signal = "flat", filterReason = "";

  if (!volActive) {
    filterReason = "low volume — sideways market";
  } else if (last > vwap && last > ema8 && rsi3 < 30 && htfTrend !== "bear") {
    signal = "buy";
  } else if (last < vwap && last < ema8 && rsi3 > 70 && htfTrend !== "bull") {
    signal = "sell";
  }

  const stopDist   = atr * ATR_MULTIPLIER;
  const stopLoss   = signal === "buy"  ? last - stopDist : last + stopDist;
  const takeProfit = signal === "buy"  ? last + stopDist * RR_RATIO : last - stopDist * RR_RATIO;

  return { signal, last, ema8, rsi3, vwap, atr, stopLoss, takeProfit, stopDist, volActive, htfTrend, filterReason };
}

// ── Orders ───────────────────────────────────────────────────────────────────
async function placeOrder(side, size, price = 0) {
  if (DEMO_MODE) return side === "buy" ? demoBuy(price, size) : demoSell(size);
  return request("POST", "/api/v2/spot/trade/place-order", {
    symbol: SYMBOL, side, orderType: "market", force: "gtc", size,
  });
}

async function getOrderFill(orderId) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    const res  = await request("GET", `/api/v2/spot/trade/orderInfo?orderId=${orderId}&symbol=${SYMBOL}`);
    const fill = parseFloat(res.data?.baseVolume || 0);
    if (fill > 0) return fill;
  }
  return 0;
}

// BitGet locks newly purchased assets against immediate resale (anti-wash-trading).
// Retries until the lock lifts, parsing the available amount from the error message.
async function placeSellWithRetry(qty, maxRetries = 12, retryDelayMs = 3_000, price = 0) {
  if (DEMO_MODE) {
    const size = (Math.floor(qty * 10_000) / 10_000).toFixed(4);
    const res  = demoSell(size);
    if (res.code === "00000") {
      const soldQty = parseFloat(size);
      demo.usdt += price * soldQty * (1 - FEE_SELL - SLIPPAGE);
      return { ok: true, res, soldQty };
    }
    return { ok: false, res, soldQty: 0 };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const size = (Math.floor(qty * 10_000) / 10_000).toFixed(4);
    const res  = await placeOrder("sell", size);
    if (res.code === "00000") return { ok: true, res, soldQty: parseFloat(size) };

    // Parse locked qty from error: "0.001234XRP can be used at most"
    const lockMatch = res.msg?.match(/([\d.]+)XRP can be used at most/i);
    if (lockMatch) {
      console.log(`  🔒 Lock — only ${lockMatch[1]} XRP tradeable. Retry ${attempt}/${maxRetries}...`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
      continue;
    }
    return { ok: false, res, soldQty: 0 };
  }
  return { ok: false, res: { msg: "Sell lock never lifted" }, soldQty: 0 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Single source of truth for resetting all position state
function makePositionState() {
  return { qty: 0, price: 0, cost: 0, fee: 0, trailingStop: 0, highSinceEntry: 0, takeProfit: 0 };
}

function fmt4(n) { return n.toFixed(4); }
function fmtPnl(n) { return `${n >= 0 ? "+" : ""}$${n.toFixed(4)}`; }

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  const modeLabel = DEMO_MODE
    ? `📝 DEMO MODE — $${DEMO_BALANCE.toLocaleString()} virtual balance`
    : "🔴 LIVE MODE — real money";

  console.log(`\n🤖 XRP Scalper — VWAP + RSI(3) + EMA(8) + ATR trailing stop`);
  console.log(`   Mode   : ${modeLabel}`);
  console.log(`   Market : ${getMarketStatusMsg()}`);
  console.log(`   Symbol : ${SYMBOL} | ${TOTAL_TRADES} ticks × ${INTERVAL_MS / 1000}s\n`);

  // XRP/USDT is crypto — trades 24/7, no market hours gate needed

  const existingLogs = existsSync("safety-check-log.json")
    ? JSON.parse(readFileSync("safety-check-log.json", "utf8"))
    : [];

  const log      = [];
  let pos        = makePositionState();
  let holding    = "usdt";
  let totalPnl   = 0;
  let totalFees  = 0;

  for (let i = 1; i <= TOTAL_TRADES; i++) {
    const ts = new Date().toISOString();
    const [candles, candles5m] = await Promise.all([
      getCandles(SYMBOL, 30),
      getCandles5m(SYMBOL, 25),
    ]);
    const sig  = getSignal(candles, candles5m);
    const bals = await getBalances();

    console.log(`[${i}/${TOTAL_TRADES}] ${ts}`);
    console.log(`  Price: $${fmt4(sig.last)} | EMA8: ${fmt4(sig.ema8)} | RSI3: ${sig.rsi3.toFixed(1)} | VWAP: ${fmt4(sig.vwap)} | ATR: ${fmt4(sig.atr)}`);
    console.log(`  HTF: ${sig.htfTrend.toUpperCase()} | Vol: ${sig.volActive ? "✅ active" : "⚠️ low"} | Signal: ${sig.signal.toUpperCase()}${sig.filterReason ? ` (${sig.filterReason})` : ""}`);
    console.log(`  USDT: $${bals.usdt.toFixed(4)} | XRP: ${bals.xrp.toFixed(4)}`);

    // ── Ratchet trailing stop on new high ──────────────────────────────────
    if (holding === "xrp" && sig.last > pos.highSinceEntry) {
      pos.highSinceEntry = sig.last;
      pos.trailingStop   = sig.last - sig.atr * ATR_MULTIPLIER;
      console.log(`  📈 New high $${fmt4(sig.last)} — trailing stop → $${fmt4(pos.trailingStop)}`);
    }

    // ── Forced exits (trailing stop / take profit) ─────────────────────────
    if (holding === "xrp" && pos.qty > 0) {
      const hitStop = sig.last <= pos.trailingStop;
      const hitTP   = sig.last >= pos.takeProfit;

      if (hitStop || hitTP) {
        const label = hitStop ? "🛑 TRAILING STOP" : "🎯 TAKE PROFIT";
        console.log(`  ${label} HIT @ $${fmt4(sig.last)} — forcing sell`);
        const { ok, soldQty } = await placeSellWithRetry(pos.qty, 12, 3_000, sig.last);
        if (ok) {
          const sellFee  = sig.last * soldQty * (FEE_SELL + SLIPPAGE);
          const tradePnl = sig.last * soldQty - pos.cost - sellFee;
          totalFees += sellFee;
          totalPnl  += tradePnl;
          log.push({ tick: i, timestamp: ts, price: sig.last, signal: hitStop ? "trailing-stop" : "take-profit",
            side: "sell", orderPlaced: true, exitPrice: sig.last,
            fees: +(pos.fee + sellFee).toFixed(4), pnl: +tradePnl.toFixed(4) });
          console.log(`  💰 Sold ${soldQty} XRP | Fees: -$${fmt4(sellFee)} | Net P&L: ${fmtPnl(tradePnl)}`);
          pos     = makePositionState();
          holding = "usdt";
        }
        if (i < TOTAL_TRADES) await new Promise((r) => setTimeout(r, INTERVAL_MS));
        continue;
      }
    }

    // ── Entry / signal sell ───────────────────────────────────────────────
    let side, size, label;
    const entry = {
      tick: i, timestamp: ts, price: sig.last, ema8: sig.ema8, rsi3: sig.rsi3,
      vwap: sig.vwap, atr: sig.atr, signal: sig.signal,
      stopLoss:   sig.signal !== "flat" ? +sig.stopLoss.toFixed(4)   : null,
      takeProfit: sig.signal !== "flat" ? +sig.takeProfit.toFixed(4) : null,
      riskReward: RR_RATIO, orderPlaced: false,
    };

    if (sig.signal === "buy" && holding === "usdt" && bals.usdt >= 1) {
      side   = "buy";
      const xrpQty = (bals.usdt * RISK_PCT) / sig.stopDist;
      size   = Math.min(xrpQty, bals.usdt / sig.last * 0.99);
      size   = (Math.floor(size * 10_000) / 10_000).toFixed(4);
      label  = `BUY ${size} XRP | SL: $${fmt4(sig.stopLoss)} | TP: $${fmt4(sig.takeProfit)} (2% risk)`;
      holding = "xrp";
    } else if (sig.signal === "sell" && holding === "xrp" && pos.qty > 0) {
      side  = "sell";
      size  = (Math.floor(pos.qty * 10_000) / 10_000).toFixed(4);
      const pnl    = (sig.last - pos.price) * pos.qty;
      const pnlPct = ((sig.last - pos.price) / pos.price * 100).toFixed(2);
      label = `SELL ${size} XRP | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)} (${pnlPct}%)`;
      holding = "usdt";
    } else {
      const reason = sig.signal === "flat"
        ? "no signal — conditions not met"
        : `signal=${sig.signal} but holding=${holding}`;
      console.log(`  ⏭  Skip — ${reason}\n`);
      log.push({ ...entry, skipped: true, skipReason: reason });
      if (i < TOTAL_TRADES) await new Promise((r) => setTimeout(r, INTERVAL_MS));
      continue;
    }

    console.log(`  → ${label}`);
    entry.side = side;
    entry.size = size;

    // ── Place order ───────────────────────────────────────────────────────
    if (side === "buy") {
      const res = await placeOrder("buy", size, sig.last);
      const ok  = res.code === "00000";
      entry.orderId     = res.data?.orderId || res.msg;
      entry.orderPlaced = ok;
      if (ok) {
        const filled     = DEMO_MODE ? parseFloat(size) : await getOrderFill(res.data.orderId);
        const buyFee     = sig.last * filled * (FEE_BUY + SLIPPAGE);
        pos              = { qty: filled, price: sig.last, cost: sig.last * filled + buyFee,
                             fee: buyFee, trailingStop: sig.stopLoss,
                             highSinceEntry: sig.last, takeProfit: sig.takeProfit };
        totalFees       += buyFee;
        entry.filledQty  = filled;
        entry.entryPrice = sig.last;
        console.log(`  ✅ BUY PLACED — ${entry.orderId}`);
        console.log(`  📦 Filled: ${filled.toFixed(4)} XRP @ $${fmt4(sig.last)} | SL: $${fmt4(sig.stopLoss)} | TP: $${fmt4(sig.takeProfit)}`);
      } else {
        console.log(`  ❌ Rejected: ${res.msg}`);
        holding = "usdt";
      }
    } else {
      const { ok, res, soldQty } = await placeSellWithRetry(pos.qty, 12, 3_000, sig.last);
      entry.orderId     = res.data?.orderId || res.msg;
      entry.orderPlaced = ok;
      if (ok) {
        const sellFee  = sig.last * soldQty * (FEE_SELL + SLIPPAGE);
        const grossPnl = sig.last * soldQty - pos.cost;
        const tradePnl = grossPnl - sellFee;
        totalFees += sellFee;
        totalPnl  += tradePnl;
        entry.exitPrice = sig.last;
        entry.grossPnl  = +grossPnl.toFixed(4);
        entry.fees      = +(pos.fee + sellFee).toFixed(4);
        entry.pnl       = +tradePnl.toFixed(4);
        console.log(`  ✅ SELL PLACED — ${entry.orderId} (${soldQty.toFixed(4)} XRP) | Gross: ${fmtPnl(grossPnl)} | Fees: -$${fmt4(sellFee)} | Net P&L: ${fmtPnl(tradePnl)}`);
        pos = makePositionState();
      } else {
        console.log(`  ❌ Sell failed: ${res.msg}`);
        holding = "xrp";
      }
    }

    log.push(entry);

    // Save state iteratively to prevent data loss on crash/exit
    const combinedLog = [...existingLogs, ...log].slice(-2000);
    writeFileSync("safety-check-log.json", JSON.stringify(combinedLog, null, 2));

    if (i < TOTAL_TRADES) {
      const wait = side === "buy" ? Math.max(INTERVAL_MS - 5_000, 4_000) : INTERVAL_MS;
      console.log(`  ⏱  Next in ${wait / 1000}s...\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // ── End-of-session liquidation ─────────────────────────────────────────────
  if (holding === "xrp" && pos.qty > 0) {
    const exitPrice = await getPrice(SYMBOL);
    console.log(`\n⚠️  Session ended with open position — liquidating ${pos.qty.toFixed(4)} XRP @ $${fmt4(exitPrice)}`);
    const { ok, soldQty } = await placeSellWithRetry(pos.qty, 12, 3_000, exitPrice);
    if (ok) {
      const sellFee  = exitPrice * soldQty * (FEE_SELL + SLIPPAGE);
      const tradePnl = exitPrice * soldQty - pos.cost - sellFee;
      totalFees += sellFee;
      totalPnl  += tradePnl;
      console.log(`  💰 Liquidated | Fees: -$${fmt4(sellFee)} | Net P&L: ${fmtPnl(tradePnl)}`);
    } else {
      console.log(`  ❌ Liquidation failed — close manually`);
    }
  }

  // ── Session analytics ──────────────────────────────────────────────────────
  const final      = await getBalances();
  const price      = await getPrice(SYMBOL);
  const totalValue = final.usdt + final.xrp * price;
  const startValue = DEMO_MODE ? DEMO_BALANCE : totalValue - totalPnl;
  const returnPct  = ((totalValue - startValue) / startValue * 100).toFixed(2);

  const trades     = log.filter((e) => e.pnl !== undefined);
  const wins       = trades.filter((e) => e.pnl > 0);
  const losses     = trades.filter((e) => e.pnl < 0);
  const winRate    = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : "0.0";
  const avgWin     = wins.length    > 0 ? (wins.reduce((s, t) => s + t.pnl, 0)   / wins.length).toFixed(4)   : "0";
  const avgLoss    = losses.length  > 0 ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(4) : "0";
  const best       = trades.length  > 0 ? Math.max(...trades.map((t) => t.pnl)).toFixed(4) : "0";
  const worst      = trades.length  > 0 ? Math.min(...trades.map((t) => t.pnl)).toFixed(4) : "0";

  const line = "═".repeat(50);
  const dash = "─".repeat(50);
  console.log(`\n${line}`);
  console.log(`  📊 SESSION ANALYTICS`);
  console.log(line);
  console.log(`  Mode          : ${DEMO_MODE ? "DEMO" : "LIVE"}`);
  console.log(`  Start Balance : $${startValue.toFixed(2)}`);
  console.log(`  End Value     : $${totalValue.toFixed(2)}`);
  console.log(`  Return        : ${parseFloat(returnPct) >= 0 ? "+" : ""}${returnPct}%`);
  console.log(`  Net P&L       : ${fmtPnl(totalPnl)}`);
  console.log(`  Total Fees    : -$${totalFees.toFixed(4)}`);
  console.log(dash);
  console.log(`  Trades        : ${trades.length}  (${wins.length}W / ${losses.length}L)`);
  console.log(`  Win Rate      : ${winRate}%`);
  console.log(`  Avg Win       : +$${avgWin}`);
  console.log(`  Avg Loss      : $${avgLoss}`);
  console.log(`  Best Trade    : +$${best}`);
  console.log(`  Worst Trade   : $${worst}`);
  console.log(`${line}\n`);

  // Final save to capture any end-of-session liquidation
  const finalLog = [...existingLogs, ...log].slice(-2000);
  writeFileSync("safety-check-log.json", JSON.stringify(finalLog, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
