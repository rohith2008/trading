import { createHmac } from "crypto";
import https from "https";
import { existsSync, readFileSync, writeFileSync } from "fs";

// Load .env
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

const SYMBOL = "XRPUSDT"; // XRP/USDT spot — low price, above min order size
const INTERVAL_MS = 10000; // 10 seconds
const TOTAL_TRADES = 6;
const RISK_PCT = 0.02;       // Risk 2% of account per trade
const RR_RATIO = 2.5;          // optimised          // Take-profit = 2× stop distance (2:1 R:R)
const ATR_PERIOD = 14;       // ATR period for stop placement
const ATR_MULTIPLIER = 2;  // optimised  // Stop = 1.5× ATR from entry

// ── FEES & SLIPPAGE (AngelOne intraday) ─────────────────────────
// Brokerage: 0.03% per side, STT: 0.025% on sell, Exchange: 0.00325%
// GST: 18% on brokerage, SEBI: 0.0001%, Stamp: 0.003% on buy
const FEE_BUY  = 0.0003 + 0.0000325 + 0.00003 * 1.18 + 0.000001 + 0.00003; // ~0.000418
const FEE_SELL = 0.0003 + 0.00025 + 0.0000325 + 0.00003 * 1.18 + 0.000001; // ~0.000668
const SLIPPAGE = 0.0005; // 0.05% slippage per side (market order spread)

// ── VOLUME FILTER ────────────────────────────────────────────────
const VOL_MA_PERIOD = 20;    // compare current vol to 20-bar average
const VOL_MIN_RATIO = 1.2;   // current vol must be 1.2× the average (active market)

// ── DEMO MODE ───────────────────────────────────────────────────
// Set to false and add your AngelOne API key to .env to go live
const DEMO_MODE = true;
const DEMO_BALANCE = 10000; // $10,000 virtual starting balance

// ── INDIAN MARKET HOURS (IST) ────────────────────────────────────
// NSE/BSE: Pre-open 9:00 AM, Market open 9:15 AM, Close 3:30 PM
// Mon–Fri only (no weekends)
const MARKET_OPEN_H = 9, MARKET_OPEN_M = 15;   // 9:15 AM IST
const MARKET_CLOSE_H = 15, MARKET_CLOSE_M = 30; // 3:30 PM IST

function getISTTime() {
  // IST = UTC + 5:30. Always add to UTC ms so result is timezone-independent.
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function isMarketOpen() {
  const ist = getISTTime();
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false; // weekend

  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const nowMins = h * 60 + m;
  const openMins = MARKET_OPEN_H * 60 + MARKET_OPEN_M;   // 555
  const closeMins = MARKET_CLOSE_H * 60 + MARKET_CLOSE_M; // 930
  return nowMins >= openMins && nowMins < closeMins;
}

function getMarketStatusMsg() {
  const ist = getISTTime();
  const day = ist.getUTCDay();
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const pad = (n) => String(n).padStart(2, "0");
  const timeStr = `${pad(h)}:${pad(m)} IST`;
  if (day === 0 || day === 6) return `Market CLOSED — weekend (${timeStr})`;
  const nowMins = h * 60 + m;
  const openMins = MARKET_OPEN_H * 60 + MARKET_OPEN_M;
  const closeMins = MARKET_CLOSE_H * 60 + MARKET_CLOSE_M;
  if (nowMins < openMins) return `Market not open yet — opens 9:15 AM IST (now ${timeStr})`;
  if (nowMins >= closeMins) return `Market CLOSED — closed at 3:30 PM IST (now ${timeStr})`;
  return `Market OPEN (${timeStr})`;
}

// ── BitGet helpers ──────────────────────────────────────────────
function sign(ts, method, path, body = "") {
  return createHmac("sha256", SECRET_KEY)
    .update(ts + method + path + body)
    .digest("base64");
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : "";
    const sig = sign(ts, method, path, bodyStr);
    const req = https.request(
      {
        hostname: "api.bitget.com",
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "ACCESS-KEY": API_KEY,
          "ACCESS-SIGN": sig,
          "ACCESS-TIMESTAMP": ts,
          "ACCESS-PASSPHRASE": PASSPHRASE,
          locale: "en-US",
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Demo paper trading state ────────────────────────────────────
const demo = {
  usdt: DEMO_BALANCE,
  xrp: 0,
  orderCount: 0,
};

function demoBuy(price, size) {
  const cost = price * parseFloat(size);
  if (cost > demo.usdt) return { code: "ERR", msg: "Insufficient demo balance" };
  demo.usdt -= cost;
  demo.xrp += parseFloat(size);
  demo.orderCount++;
  return { code: "00000", data: { orderId: `DEMO-${demo.orderCount}` } };
}

function demoSell(size) {
  const qty = parseFloat(size);
  if (qty > demo.xrp) return { code: "ERR", msg: "Insufficient demo XRP" };
  // price credited at sell time in main loop
  demo.xrp -= qty;
  demo.orderCount++;
  return { code: "00000", data: { orderId: `DEMO-${demo.orderCount}` } };
}

function demoGetBalances() {
  return { usdt: demo.usdt, xrp: demo.xrp };
}

// ── Market data ─────────────────────────────────────────────────
async function getCandles(symbol, limit = 30) {
  // 1-minute candles from BitGet
  const res = await request(
    "GET",
    `/api/v2/spot/market/candles?symbol=${symbol}&granularity=1min&limit=${limit}`,
  );
  // returns [[ts, open, high, low, close, vol], ...]
  return (res.data || []).map((c) => ({
    ts: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[5]),
  }));
}

async function getCandles5m(symbol, limit = 20) {
  const res = await request(
    "GET",
    `/api/v2/spot/market/candles?symbol=${symbol}&granularity=5min&limit=${limit}`,
  );
  return (res.data || []).map((c) => ({
    ts: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[5]),
  }));
}

async function getPrice(symbol) {
  const res = await request(
    "GET",
    `/api/v2/spot/market/tickers?symbol=${symbol}`,
  );
  return parseFloat(res.data?.[0]?.lastPr || 0);
}

async function getBalances() {
  if (DEMO_MODE) return demoGetBalances();
  // 🔴 LIVE: swap this for AngelOne when ready
  // import { getFunds } from './src/core/broker.js' and map to { usdt, xrp }
  const res = await request("GET", "/api/v2/spot/account/assets");
  const usdt = res.data?.find((a) => a.coin === "USDT");
  const xrp = res.data?.find((a) => a.coin === "XRP");
  return {
    usdt: parseFloat(usdt?.available || 0),
    xrp: parseFloat(xrp?.available || 0),
  };
}

// ── Indicators ──────────────────────────────────────────────────
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes, period = 3) {
  if (closes.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calcVWAP(candles) {
  // Session VWAP approximation (all candles provided)
  let cumTPV = 0,
    cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.vol;
    cumVol += c.vol;
  }
  return cumVol === 0 ? candles[candles.length - 1].close : cumTPV / cumVol;
}

// ── ATR (Average True Range) ────────────────────────────────────
function calcATR(candles, period = ATR_PERIOD) {
  if (candles.length < period + 1) return candles[candles.length - 1].high - candles[candles.length - 1].low;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  // Wilder's smoothing
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

// ── Volume filter ───────────────────────────────────────────────
function isVolumeActive(candles) {
  if (candles.length < VOL_MA_PERIOD + 1) return true; // not enough data, allow
  const vols = candles.map((c) => c.vol);
  const avgVol = vols.slice(-VOL_MA_PERIOD - 1, -1).reduce((a, b) => a + b, 0) / VOL_MA_PERIOD;
  const currentVol = vols[vols.length - 1];
  return currentVol >= avgVol * VOL_MIN_RATIO;
}

// ── Higher timeframe trend (5-min EMA21) ────────────────────────
function getHTFTrend(candles5m) {
  if (!candles5m || candles5m.length < 5) return "neutral";
  const closes = candles5m.map((c) => c.close);
  const ema21 = calcEMA(closes, Math.min(21, closes.length));
  const last = closes[closes.length - 1];
  if (last > ema21) return "bull";
  if (last < ema21) return "bear";
  return "neutral";
}

// ── Signal logic ────────────────────────────────────────────────
function getSignal(candles, candles5m) {
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];

  const ema8 = calcEMA(closes, 8);
  const rsi3 = calcRSI(closes, 3);
  const vwap = calcVWAP(candles);
  const atr = calcATR(candles);
  const volActive = isVolumeActive(candles);
  const htfTrend = getHTFTrend(candles5m);

  const bullBias = last > vwap && last > ema8;
  const bearBias = last < vwap && last < ema8;

  let signal = "flat";
  let filterReason = "";

  if (!volActive) {
    filterReason = "low volume — sideways market";
  } else if (bullBias && rsi3 < 30 && htfTrend !== "bear") {
    signal = "buy";  // 5m trend must not be bearish
  } else if (bearBias && rsi3 > 70 && htfTrend !== "bull") {
    signal = "sell"; // 5m trend must not be bullish
  }

  // Stop-loss and take-profit levels
  const stopDist = atr * ATR_MULTIPLIER;
  const stopLoss = signal === "buy" ? last - stopDist : last + stopDist;
  const takeProfit = signal === "buy" ? last + stopDist * RR_RATIO : last - stopDist * RR_RATIO;

  return { signal, last, ema8, rsi3, vwap, atr, stopLoss, takeProfit, stopDist, volActive, htfTrend, filterReason };
}

// ── Order helpers ───────────────────────────────────────────────
async function placeOrder(side, size, price = 0) {
  if (DEMO_MODE) {
    return side === "buy" ? demoBuy(price, size) : demoSell(size);
  }
  // 🔴 LIVE: swap this for AngelOne when ready
  // import { placeOrder as angelPlaceOrder } from './src/core/broker.js'
  const body = {
    symbol: SYMBOL,
    side,
    orderType: "market",
    force: "gtc",
    size,
  };
  return request("POST", "/api/v2/spot/trade/place-order", body);
}

async function getOrderFill(orderId) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await request(
      "GET",
      `/api/v2/spot/trade/orderInfo?orderId=${orderId}&symbol=${SYMBOL}`,
    );
    const fill = parseFloat(res.data?.baseVolume || 0);
    if (fill > 0) return fill;
  }
  return 0;
}

// BitGet locks newly purchased assets against immediate resale (anti-wash-trading).
// This retries the sell, parsing the actually-available amount from the error
// message until the lock lifts or we time out.
async function placeSellWithRetry(qty, maxRetries = 12, retryDelayMs = 3000, price = 0) {
  if (DEMO_MODE) {
    const size = (Math.floor(qty * 10000) / 10000).toFixed(4);
    const res = demoSell(size);
    if (res.code === "00000") {
      demo.usdt += price * parseFloat(size); // credit sale proceeds
      return { ok: true, res, soldQty: parseFloat(size) };
    }
    return { ok: false, res, soldQty: 0 };
  }
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const size = (Math.floor(qty * 10000) / 10000).toFixed(4);
    const res = await placeOrder("sell", size);

    if (res.code === "00000")
      return { ok: true, res, soldQty: parseFloat(size) };

    // Parse available qty from lock error: "0.001234XRP can be used at most"
    const lockMatch = res.msg?.match(/([\d.]+)XRP can be used at most/i);
    if (lockMatch) {
      const available = parseFloat(lockMatch[1]);
      console.log(
        `  🔒 Lock active — only ${available} XRP tradeable. Retry ${attempt}/${maxRetries} in ${retryDelayMs / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, retryDelayMs));
      continue;
    }

    // Any other error — don't retry
    return { ok: false, res, soldQty: 0 };
  }
  return {
    ok: false,
    res: { msg: "Sell lock never lifted after retries" },
    soldQty: 0,
  };
}

// ── Main loop ───────────────────────────────────────────────────
async function main() {
  const modeLabel = DEMO_MODE ? `📝 DEMO MODE — $${DEMO_BALANCE.toLocaleString()} virtual balance` : "🔴 LIVE MODE — real money";
  console.log(`\n🤖 XRP Scalper — VWAP + RSI(3) + EMA(8)`);
  console.log(`Mode: ${modeLabel}`);
  console.log(`Market: ${getMarketStatusMsg()}`);
  console.log(
    `Symbol: ${SYMBOL} | ${TOTAL_TRADES} trades × ${INTERVAL_MS / 1000}s\n`,
  );

  // Block trading outside market hours (skip in demo for testing)
  if (!DEMO_MODE && !isMarketOpen()) {
    console.log(`\n⛔ Cannot trade — ${getMarketStatusMsg()}`);
    console.log(`   NSE/BSE hours: Mon–Fri, 9:15 AM – 3:30 PM IST`);
    process.exit(0);
  }
  if (DEMO_MODE && !isMarketOpen()) {
    console.log(`⚠️  Outside market hours — demo running anyway for testing\n`);
  }

  const log = [];
  let holding = "usdt";
  let lastBuyXrpQty = 0;
  let lastBuyPrice = 0;
  let lastBuyCost = 0;   // total cost including buy fees
  let lastBuyFee = 0;    // buy-side fee stored for sell-side reporting
  let trailingStop = 0;
  let highSinceEntry = 0;
  let entryTakeProfit = 0;
  let totalPnl = 0;
  let totalFees = 0;

  for (let i = 1; i <= TOTAL_TRADES; i++) {
    // Stop trading if market closes mid-session (live only)
    if (!DEMO_MODE && !isMarketOpen()) {
      console.log(`\n⛔ Market closed mid-session — stopping bot`);
      break;
    }

    const ts = new Date().toISOString();
    const [candles, candles5m] = await Promise.all([
      getCandles(SYMBOL, 30),
      getCandles5m(SYMBOL, 25),
    ]);
    const { signal, last, ema8, rsi3, vwap, atr, stopLoss, takeProfit, stopDist, volActive, htfTrend, filterReason } = getSignal(candles, candles5m);
    const bals = await getBalances();

    console.log(`[${i}/${TOTAL_TRADES}] ${ts}`);
    console.log(
      `  Price: $${last.toFixed(4)} | EMA8: ${ema8.toFixed(4)} | RSI3: ${rsi3.toFixed(1)} | VWAP: ${vwap.toFixed(4)} | ATR: ${atr.toFixed(4)}`,
    );
    console.log(
      `  HTF: ${htfTrend.toUpperCase()} | Vol: ${volActive ? "✅ active" : "⚠️ low"} | Signal: ${signal.toUpperCase()}${filterReason ? ` (${filterReason})` : ""}`,
    );
    console.log(
      `  USDT: $${bals.usdt.toFixed(4)} | XRP: ${bals.xrp.toFixed(4)}`,
    );

    let side, size, label;
    const entry = {
      tick: i,
      timestamp: ts,
      price: last,
      ema8,
      rsi3,
      vwap,
      atr,
      signal,
      stopLoss: signal !== "flat" ? +stopLoss.toFixed(4) : null,
      takeProfit: signal !== "flat" ? +takeProfit.toFixed(4) : null,
      riskReward: RR_RATIO,
      orderPlaced: false,
    };

    // Ratchet trailing stop only when price makes a new high since entry
    if (holding === "xrp" && last > highSinceEntry) {
      highSinceEntry = last;
      trailingStop = last - (atr * ATR_MULTIPLIER);
      console.log(`  📈 New high $${last.toFixed(4)} — trailing stop → $${trailingStop.toFixed(4)}`);
    }

    // Force sell if trailing stop or locked entry take-profit hit
    if (holding === "xrp" && lastBuyXrpQty > 0) {
      if (last <= trailingStop) {
        console.log(`  🛑 TRAILING STOP HIT @ $${last.toFixed(4)} — forcing sell`);
        const { ok, res, soldQty } = await placeSellWithRetry(lastBuyXrpQty, 12, 3000, last);
        if (ok) {
          const tradePnl = (last - lastBuyPrice) * soldQty;
          totalPnl += tradePnl;
          log.push({ tick: i, timestamp: ts, price: last, signal: "trailing-stop", side: "sell", orderPlaced: true, exitPrice: last, pnl: +tradePnl.toFixed(4) });
          console.log(`  💰 Sold ${soldQty} XRP | P&L: ${tradePnl >= 0 ? "+" : ""}$${tradePnl.toFixed(4)}`);
          lastBuyXrpQty = 0; lastBuyPrice = 0; trailingStop = 0; highSinceEntry = 0; entryTakeProfit = 0; holding = "usdt";
        }
        if (i < TOTAL_TRADES) await new Promise((r) => setTimeout(r, INTERVAL_MS));
        continue;
      }
      if (last >= entryTakeProfit) {
        console.log(`  🎯 TAKE PROFIT HIT @ $${last.toFixed(4)} — forcing sell`);
        const { ok, res, soldQty } = await placeSellWithRetry(lastBuyXrpQty, 12, 3000, last);
        if (ok) {
          const tradePnl = (last - lastBuyPrice) * soldQty;
          totalPnl += tradePnl;
          log.push({ tick: i, timestamp: ts, price: last, signal: "take-profit", side: "sell", orderPlaced: true, exitPrice: last, pnl: +tradePnl.toFixed(4) });
          console.log(`  💰 Sold ${soldQty} XRP | P&L: +$${tradePnl.toFixed(4)}`);
          lastBuyXrpQty = 0; lastBuyPrice = 0; trailingStop = 0; highSinceEntry = 0; entryTakeProfit = 0; holding = "usdt";
        }
        if (i < TOTAL_TRADES) await new Promise((r) => setTimeout(r, INTERVAL_MS));
        continue;
      }
    }

    if (signal === "buy" && holding === "usdt" && bals.usdt >= 1) {
      side = "buy";
      // Risk 2% of account: position size = (account * riskPct) / stopDist
      const riskUSDT = bals.usdt * RISK_PCT;
      const xrpQty = riskUSDT / stopDist;
      size = Math.min(xrpQty, bals.usdt / last * 0.99); // cap at 99% of balance
      size = (Math.floor(size * 10000) / 10000).toFixed(4);
      label = `BUY ${size} XRP | SL: $${stopLoss.toFixed(4)} | TP: $${takeProfit.toFixed(4)} (2% risk)`;
      holding = "xrp";
    } else if (signal === "sell" && holding === "xrp" && lastBuyXrpQty > 0) {
      side = "sell";
      size = (Math.floor(lastBuyXrpQty * 10000) / 10000).toFixed(4);
      const pnl = (last - lastBuyPrice) * lastBuyXrpQty;
      const pnlPct = ((last - lastBuyPrice) / lastBuyPrice * 100).toFixed(2);
      label = `SELL ${size} XRP | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)} (${pnlPct}%)`;
      holding = "usdt";
    } else {
      const reason =
        signal === "flat"
          ? "no signal — conditions not met"
          : `signal=${signal} but holding=${holding} (waiting for right side)`;
      console.log(`  ⏭  Skip — ${reason}\n`);
      entry.skipped = true;
      entry.skipReason = reason;
      log.push(entry);
      if (i < TOTAL_TRADES)
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      continue;
    }

    console.log(`  → ${label}`);
    entry.side = side;
    entry.size = size;

    if (side === "buy") {
      const res = await placeOrder("buy", size, last);
      const ok = res.code === "00000";
      const orderId = res.data?.orderId;
      entry.orderId = orderId || res.msg;
      entry.orderPlaced = ok;

      if (ok) {
        console.log(`  ✅ BUY PLACED — ${orderId}`);
        lastBuyXrpQty = DEMO_MODE ? parseFloat(size) : await getOrderFill(orderId);
        lastBuyPrice = last;
        lastBuyFee = last * lastBuyXrpQty * (FEE_BUY + SLIPPAGE);
        lastBuyCost = last * lastBuyXrpQty + lastBuyFee;
        totalFees += lastBuyFee;
        trailingStop = stopLoss;
        highSinceEntry = last;
        entryTakeProfit = takeProfit;
        console.log(
          `  📦 Filled: ${lastBuyXrpQty.toFixed(4)} XRP @ $${last.toFixed(4)} — SL: $${stopLoss.toFixed(4)} | TP: $${takeProfit.toFixed(4)}`,
        );
        entry.filledQty = lastBuyXrpQty;
        entry.entryPrice = last;
      } else {
        console.log(`  ❌ Rejected: ${res.msg}`);
        holding = "usdt";
      }
    } else {
      // Use retry loop — handles BitGet's anti-wash-trading lock automatically
      const { ok, res, soldQty } = await placeSellWithRetry(lastBuyXrpQty, 12, 3000, last);
      entry.orderId = res.data?.orderId || res.msg;
      entry.orderPlaced = ok;

      if (ok) {
        const sellFee = last * soldQty * (FEE_SELL + SLIPPAGE);
        totalFees += sellFee;
        const grossPnl = (last * soldQty) - lastBuyCost;
        const tradePnl = grossPnl - sellFee;
        totalPnl += tradePnl;
        entry.exitPrice = last;
        entry.grossPnl = +grossPnl.toFixed(4);
        entry.fees = +(lastBuyFee + sellFee).toFixed(4);
        entry.pnl = +tradePnl.toFixed(4);
        console.log(
          `  ✅ SELL PLACED — ${entry.orderId} (${soldQty.toFixed(4)} XRP) | Gross: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(4)} | Fees: -$${sellFee.toFixed(4)} | Net P&L: ${tradePnl >= 0 ? "+" : ""}$${tradePnl.toFixed(4)}`,
        );
        lastBuyXrpQty = 0;
        lastBuyPrice = 0;
        lastBuyCost = 0;
        lastBuyFee = 0;
        trailingStop = 0;
      } else {
        console.log(`  ❌ Sell failed: ${res.msg}`);
        holding = "xrp"; // still holding
      }
    }

    log.push(entry);

    if (i < TOTAL_TRADES) {
      const waitMs =
        side === "buy" ? Math.max(INTERVAL_MS - 5000, 4000) : INTERVAL_MS;
      console.log(`  ⏱  Next in ${waitMs / 1000}s...\n`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  // Liquidate any open position at end of session
  if (holding === "xrp" && lastBuyXrpQty > 0) {
    const exitPrice = await getPrice(SYMBOL);
    console.log(`\n⚠️  Session ended with open position — liquidating ${lastBuyXrpQty.toFixed(4)} XRP @ $${exitPrice.toFixed(4)}`);
    const { ok, soldQty } = await placeSellWithRetry(lastBuyXrpQty, 12, 3000, exitPrice);
    if (ok) {
      const tradePnl = (exitPrice - lastBuyPrice) * soldQty;
      totalPnl += tradePnl;
      console.log(`  💰 Liquidated | P&L: ${tradePnl >= 0 ? "+" : ""}$${tradePnl.toFixed(4)}`);
    } else {
      console.log(`  ❌ Liquidation failed — close manually`);
    }
  }

  const final = await getBalances();
  const price = await getPrice(SYMBOL);
  const totalValue = final.usdt + final.xrp * price;
  const startValue = DEMO_MODE ? DEMO_BALANCE : totalValue - totalPnl;
  const returnPct = ((totalValue - startValue) / startValue * 100).toFixed(2);

  const trades = log.filter((e) => e.pnl !== undefined);
  const wins = trades.filter((e) => e.pnl > 0);
  const losses = trades.filter((e) => e.pnl < 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : "0.0";
  const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(4) : "0";
  const avgLoss = losses.length > 0 ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(4) : "0";
  const bestTrade = trades.length > 0 ? Math.max(...trades.map((t) => t.pnl)).toFixed(4) : "0";
  const worstTrade = trades.length > 0 ? Math.min(...trades.map((t) => t.pnl)).toFixed(4) : "0";

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  📊 SESSION ANALYTICS`);
  console.log(`${"═".repeat(50)}`);
  console.log(`  Mode         : ${DEMO_MODE ? "DEMO" : "LIVE"}`);
  console.log(`  Start Balance: $${startValue.toFixed(2)}`);
  console.log(`  End Value    : $${totalValue.toFixed(2)}`);
  console.log(`  Return       : ${returnPct >= 0 ? "+" : ""}${returnPct}%`);
  console.log(`  Net P&L      : ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(4)}`);
  console.log(`  Total Fees   : -$${totalFees.toFixed(4)}`);
  console.log(`${"─".repeat(50)}`);
  console.log(`  Trades       : ${trades.length} (${wins.length}W / ${losses.length}L)`);
  console.log(`  Win Rate     : ${winRate}%`);
  console.log(`  Avg Win      : +$${avgWin}`);
  console.log(`  Avg Loss     : $${avgLoss}`);
  console.log(`  Best Trade   : +$${bestTrade}`);
  console.log(`  Worst Trade  : $${worstTrade}`);
  console.log(`${"═".repeat(50)}\n`);

  const existing = existsSync("safety-check-log.json")
    ? JSON.parse(readFileSync("safety-check-log.json", "utf8"))
    : [];
  writeFileSync(
    "safety-check-log.json",
    JSON.stringify([...existing, ...log], null, 2),
  );
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
