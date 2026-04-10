/**
 * analyze-trades.js — AI-powered trade log analysis using Claude
 * Reads safety-check-log.json and asks Claude to review performance,
 * suggest improvements, and detect patterns.
 *
 * Usage: node analyze-trades.js
 * Requires: ANTHROPIC_API_KEY in .env
 */
import https from "https";
import { existsSync, readFileSync } from "fs";

readFileSync(new URL(".env", import.meta.url), "utf8")
  .split("\n")
  .forEach((line) => {
    const [k, ...v] = line.split("=");
    if (k && !k.startsWith("#") && v.length)
      process.env[k.trim()] = v.join("=").trim();
  });

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error("❌ ANTHROPIC_API_KEY not set in .env");
  process.exit(1);
}

const LOG_FILE = "safety-check-log.json";
if (!existsSync(LOG_FILE)) {
  console.error(`❌ No trade log found at ${LOG_FILE} — run the bot first`);
  process.exit(1);
}

const trades = JSON.parse(readFileSync(LOG_FILE, "utf8"));
const completed = trades.filter((t) => t.pnl !== undefined);

if (completed.length === 0) {
  console.log("No completed trades to analyze yet. Run the bot first.");
  process.exit(0);
}

// Build summary stats
const wins = completed.filter((t) => t.pnl > 0).length;
const losses = completed.filter((t) => t.pnl <= 0).length;
const totalPnl = completed.reduce((s, t) => s + t.pnl, 0);
const winRate = (wins / completed.length * 100).toFixed(1);

const summary = {
  totalTrades: completed.length,
  wins, losses, winRate: `${winRate}%`,
  totalNetPnl: +totalPnl.toFixed(4),
  avgPnl: +(totalPnl / completed.length).toFixed(4),
  recentTrades: completed.slice(-20), // last 20 trades
};

console.log(`\n🤖 Analyzing ${completed.length} trades with Claude...\n`);

function claudeRequest(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        const json = JSON.parse(d);
        resolve(json.content?.[0]?.text || "No response");
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const prompt = `You are an expert trading analyst reviewing the performance of an automated XRP scalping bot.

Strategy: VWAP + RSI(3) + EMA(8) on 1-minute candles with ATR-based stop-loss (1.5×ATR) and 2:1 risk/reward.

Here is the trade performance summary:
${JSON.stringify(summary, null, 2)}

Please provide:
1. **Performance Assessment** — Is this strategy working? What do the numbers say?
2. **Pattern Analysis** — Any patterns in winning vs losing trades (RSI levels, time of day, signal type)?
3. **Key Issues** — What are the top 2-3 problems you see?
4. **Actionable Improvements** — Specific parameter changes or rule additions to improve win rate
5. **Risk Assessment** — Is the risk management healthy?

Be specific, direct, and data-driven. Keep it under 300 words.`;

const analysis = await claudeRequest(prompt);

console.log("═".repeat(60));
console.log("  🧠 AI TRADE ANALYSIS");
console.log("═".repeat(60));
console.log(analysis);
console.log("═".repeat(60) + "\n");
