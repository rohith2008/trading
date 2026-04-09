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
const RR_RATIO = 2;          // Take-profit = 2× stop distance (2:1 R:R)
const ATR_PERIOD = 14;       // ATR period for stop placement
const ATR_MULTIPLIER = 1.5;  // Stop = 1.5× ATR from entry

// ── DEMO MODE ───────────────────────────────────────────────────
// Set to false and add your AngelOne API key to .env to go live
const DEMO_MODE = true;
const DEMO_BALANCE = 10000; // $10,000 virtual starting balance

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

// ── Signal logic (mirrors Pine Script) ─────────────────────────
function getSignal(candles) {
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];

  const ema8 = calcEMA(closes, 8);
  const rsi3 = calcRSI(closes, 3);
  const vwap = calcVWAP(candles);
  const atr = calcATR(candles);

  const bullBias = last > vwap && last > ema8;
  const bearBias = last < vwap && last < ema8;

  let signal = "flat";
  if (bullBias && rsi3 < 30) signal = "buy";
  else if (bearBias && rsi3 > 70) signal = "sell";

  // Stop-loss and take-profit levels
  const stopDist = atr * ATR_MULTIPLIER;
  const stopLoss = signal === "buy" ? last - stopDist : last + stopDist;
  const takeProfit = signal === "buy" ? last + stopDist * RR_RATIO : last - stopDist * RR_RATIO;

  return { signal, last, ema8, rsi3, vwap, atr, stopLoss, takeProfit, stopDist };
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
  console.log(
    `Symbol: ${SYMBOL} | ${TOTAL_TRADES} trades × ${INTERVAL_MS / 1000}s\n`,
  );

  const log = [];
  let holding = "usdt";
  let lastBuyXrpQty = 0;
  let lastBuyPrice = 0;
  let trailingStop = 0;
  let highSinceEntry = 0;   // highest price seen since last buy
  let entryTakeProfit = 0;  // TP locked at entry price
  let totalPnl = 0;

  for (let i = 1; i <= TOTAL_TRADES; i++) {
    const ts = new Date().toISOString();
    const candles = await getCandles(SYMBOL, 30);
    const { signal, last, ema8, rsi3, vwap, atr, stopLoss, takeProfit, stopDist } = getSignal(candles);
    const bals = await getBalances();

    console.log(`[${i}/${TOTAL_TRADES}] ${ts}`);
    console.log(
      `  Price: $${last.toFixed(4)} | EMA8: ${ema8.toFixed(4)} | RSI3: ${rsi3.toFixed(1)} | VWAP: ${vwap.toFixed(4)} | ATR: ${atr.toFixed(4)}`,
    );
    console.log(
      `  USDT: $${bals.usdt.toFixed(4)} | XRP: ${bals.xrp.toFixed(4)} | Signal: ${signal.toUpperCase()}`,
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
        const tradePnl = (last - lastBuyPrice) * soldQty;
        totalPnl += tradePnl;
        entry.exitPrice = last;
        entry.pnl = +tradePnl.toFixed(4);
        console.log(
          `  ✅ SELL PLACED — ${entry.orderId} (${soldQty.toFixed(4)} XRP) | Trade P&L: ${tradePnl >= 0 ? "+" : ""}$${tradePnl.toFixed(4)}`,
        );
        lastBuyXrpQty = 0;
        lastBuyPrice = 0;
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
  console.log(`\n📊 Final:`);
  console.log(`  USDT: $${final.usdt.toFixed(4)}`);
  console.log(
    `  XRP: ${final.xrp.toFixed(4)} (≈$${(final.xrp * price).toFixed(4)})`,
  );
  console.log(`  Total est. value: $${totalValue.toFixed(4)}`);

  const placed = log.filter((e) => e.orderPlaced).length;
  const wins = log.filter((e) => e.pnl > 0).length;
  const losses = log.filter((e) => e.pnl < 0).length;
  console.log(`\n✅ Done — ${placed}/${TOTAL_TRADES} orders placed.`);
  console.log(`  Wins: ${wins} | Losses: ${losses} | Session P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(4)}\n`);

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
