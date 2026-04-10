# Graph Report - graphify-out  (2026-04-10)

## Corpus Check
- 92 files · ~90,859 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 358 nodes · 453 edges · 69 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Claude Decision Tree (CLAUDE.md)` - 30 edges
2. `Research Notes` - 13 edges
3. `request()` - 12 edges
4. `main()` - 11 edges
5. `getJwt()` - 11 edges
6. `ensurePineEditorOpen()` - 10 edges
7. `Replay Practice Skill` - 10 edges
8. `pollLoop()` - 9 edges
9. `Persistent Brain System` - 9 edges
10. `getSignal()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Strategy Report Skill` --semantically_similar_to--> `Performance Analyst Agent`  [INFERRED] [semantically similar]
  skills/strategy-report/SKILL.md → agents/performance-analyst.md
- `TradingView MCP Jackson` --references--> `Claude Decision Tree (CLAUDE.md)`  [EXTRACTED]
  README.md → CLAUDE.md
- `Contributing Scope Policy` --references--> `Chrome DevTools Protocol (CDP)`  [EXTRACTED]
  CONTRIBUTING.md → README.md
- `Setup Guide` --references--> `Research Notes`  [EXTRACTED]
  SETUP_GUIDE.md → RESEARCH.md
- `Security Policy` --references--> `Chrome DevTools Protocol (CDP)`  [EXTRACTED]
  SECURITY.md → README.md

## Hyperedges (group relationships)
- **Chart Analysis Workflow** — tool_quote_get, tool_data_get_study_values, tool_data_get_pine_lines, tool_data_get_pine_labels, tool_data_get_pine_tables, tool_capture_screenshot [EXTRACTED 1.00]
- **Pine Script Development Loop** — tool_pine_set_source, tool_pine_smart_compile, tool_pine_get_errors, tool_pine_get_console, tool_pine_save [EXTRACTED 1.00]
- **Replay Trading Loop** — tool_replay_start, tool_replay_step, tool_replay_trade, tool_replay_status, tool_replay_stop [EXTRACTED 1.00]
- **Morning Brief System** — tool_morning_brief, config_rules_json, tool_session_save, tool_session_get, tool_watchlist_get [EXTRACTED 0.95]
- **Persistent Brain Files** — brain_lessons, brain_mistakes, brain_patterns, brain_market_notes, brain_performance, brain_trade_journal [EXTRACTED 1.00]
- **End-to-End Architecture** — arch_claude_code, arch_mcp_server, arch_cdp, arch_tradingview_desktop [EXTRACTED 1.00]
- **Strategy Analysis Tool Set** — tool_data_get_strategy_results, tool_data_get_trades, tool_data_get_equity, tool_chart_get_state, tool_capture_screenshot [EXTRACTED 1.00]

## Communities

### Community 0 - "Claude Decision Tree (CLAUDE.md)"
Cohesion: 0.09
Nodes (41): Performance Analyst Agent, Claude Decision Tree (CLAUDE.md), Pine Script, ~/.claude/.mcp.json, Setup Guide, Chart Analysis Skill, Multi-Symbol Scan Skill, Pine Script Development Skill (+33 more)

### Community 1 - "scalper-run.js"
Cohesion: 0.19
Nodes (22): calcATR(), calcEMA(), calcRSI(), calcVWAP(), demoBuy(), demoGetBalances(), demoSell(), getBalances() (+14 more)

### Community 2 - "broker.js"
Cohesion: 0.24
Nodes (15): base32Decode(), baseHeaders(), cancelOrder(), generateTOTP(), getFunds(), getHoldings(), getJwt(), getLTP() (+7 more)

### Community 3 - "stream.js"
Cohesion: 0.18
Nodes (9): pollLoop(), sleep(), streamAllPanes(), streamBars(), streamLabels(), streamLines(), streamQuote(), streamTables() (+1 more)

### Community 4 - "pine.js"
Cohesion: 0.2
Nodes (10): compile(), ensurePineEditorOpen(), getConsole(), getErrors(), getSource(), newScript(), openScript(), save() (+2 more)

### Community 5 - "data.js"
Cohesion: 0.17
Nodes (5): buildGraphicsJS(), getPineBoxes(), getPineLabels(), getPineLines(), getPineTables()

### Community 6 - "TradingView MCP Jackson"
Cohesion: 0.19
Nodes (15): Chrome DevTools Protocol (CDP), Claude Code, MCP Server (stdio), TradingView Desktop (Electron), tv CLI Command, Morning Brief Workflow, rules.json, Contributing Scope Policy (+7 more)

### Community 7 - "Research Notes"
Cohesion: 0.13
Nodes (15): Agent-Forward Trading Paradigm, Context Window Management, Failure Transparency, Human-in-the-Loop Design, Temporal Consistency Problem, Tool Granularity Design Decision, Rationale: Compact Output by Default, Rationale: Granular Tool Design (+7 more)

### Community 8 - "connection.js"
Cohesion: 0.26
Nodes (12): connect(), evaluate(), evaluateAsync(), findChartTarget(), getBottomBar(), getChartApi(), getChartCollection(), getClient() (+4 more)

### Community 9 - "ui.js"
Cohesion: 0.14
Nodes (0): 

### Community 10 - "chart.js"
Cohesion: 0.17
Nodes (0): 

### Community 11 - "backtest.js"
Cohesion: 0.38
Nodes (9): atr(), ema(), fetchCandles(), request(), rsi(), runBacktest(), simulate(), volActive() (+1 more)

### Community 12 - "replay.js"
Cohesion: 0.39
Nodes (7): autoplay(), start(), status(), step(), stop(), trade(), wv()

### Community 13 - "Persistent Brain System"
Cohesion: 0.22
Nodes (9): brain/lessons.json, brain/market_notes.json, brain/mistakes.json, brain/patterns.json, brain/performance.json, trade-journal.json, Persistent Brain System, scripts/brain_briefing.js (+1 more)

### Community 14 - "router.js"
Cohesion: 0.52
Nodes (5): execute(), handleError(), printCommandHelp(), printHelp(), run()

### Community 15 - "drawing.js"
Cohesion: 0.29
Nodes (0): 

### Community 16 - "check_trades.js"
Cohesion: 0.47
Nodes (3): getISTHourMinute(), getLivePrices(), main()

### Community 17 - "update_excel.js"
Cohesion: 0.6
Nodes (5): buildExcel(), getLivePrices(), getLivePricesDirect(), main(), styleCell()

### Community 18 - "health.js"
Cohesion: 0.33
Nodes (0): 

### Community 19 - "morning.js"
Cohesion: 0.4
Nodes (2): loadRules(), runBrief()

### Community 20 - "pane.js"
Cohesion: 0.47
Nodes (4): focus(), list(), setLayout(), setSymbol()

### Community 21 - "tab.js"
Cohesion: 0.53
Nodes (4): closeTab(), list(), newTab(), switchTab()

### Community 22 - "e2e.test.js"
Cohesion: 0.53
Nodes (4): apiExists(), ensureEditor(), evaluate(), sleep()

### Community 23 - "close_trade.js"
Cohesion: 0.4
Nodes (0): 

### Community 24 - "alerts.js"
Cohesion: 0.4
Nodes (0): 

### Community 25 - "watchlist.js"
Cohesion: 0.5
Nodes (0): 

### Community 26 - "indicators.js"
Cohesion: 0.5
Nodes (0): 

### Community 27 - "brain_briefing.js"
Cohesion: 0.67
Nodes (0): 

### Community 28 - "capture.js"
Cohesion: 0.67
Nodes (0): 

### Community 29 - "batch.js"
Cohesion: 0.67
Nodes (0): 

### Community 30 - "cli.test.js"
Cohesion: 0.67
Nodes (0): 

### Community 31 - "analyze-trades.js"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "wait.js"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "_format.js"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "pine_analyze.test.js"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "add_brain_shortcut.ps1"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "create_shortcuts.ps1"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "pine_pull.js"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "pine_push.js"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "server.js"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "index.js"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "indicator.js"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "layout.js"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "pane_set_layout Tool"
Cohesion: 1.0
Nodes (1): pane_set_layout Tool

### Community 44 - "BTCUSDT Weekly Chart - Binance (08:49:50)"
Cohesion: 1.0
Nodes (1): BTCUSDT Weekly Chart - Binance (08:49:50)

### Community 45 - "BTCUSDT Weekly Chart - Binance (08:50:41)"
Cohesion: 1.0
Nodes (1): BTCUSDT Weekly Chart - Binance (08:50:41)

### Community 46 - "BTCUSDT Weekly Chart - Binance (08:51:50)"
Cohesion: 1.0
Nodes (1): BTCUSDT Weekly Chart - Binance (08:51:50)

### Community 47 - "Nifty 50 Index Daily Chart - NSE (08:52:38)"
Cohesion: 1.0
Nodes (1): Nifty 50 Index Daily Chart - NSE (08:52:38)

### Community 48 - "Nifty 50 Index 15-min Chart - NSE (09:04:11)"
Cohesion: 1.0
Nodes (1): Nifty 50 Index 15-min Chart - NSE (09:04:11)

### Community 49 - "JTL Industries Limited 15-min Chart - NSE (09:44:38)"
Cohesion: 1.0
Nodes (1): JTL Industries Limited 15-min Chart - NSE (09:44:38)

### Community 50 - "JTL Industries Limited 15-min Chart - NSE (09:45:05)"
Cohesion: 1.0
Nodes (1): JTL Industries Limited 15-min Chart - NSE (09:45:05)

### Community 51 - "BTCUSDT - Bitcoin / TetherUS"
Cohesion: 1.0
Nodes (1): BTCUSDT - Bitcoin / TetherUS

### Community 52 - "NIFTY - Nifty 50 Index"
Cohesion: 1.0
Nodes (1): NIFTY - Nifty 50 Index

### Community 53 - "JTLIND - JTL Industries Limited"
Cohesion: 1.0
Nodes (1): JTLIND - JTL Industries Limited

### Community 54 - "Binance Exchange"
Cohesion: 1.0
Nodes (1): Binance Exchange

### Community 55 - "NSE - National Stock Exchange of India"
Cohesion: 1.0
Nodes (1): NSE - National Stock Exchange of India

### Community 56 - "TradingView Platform"
Cohesion: 1.0
Nodes (1): TradingView Platform

### Community 57 - "Weekly Timeframe (1W)"
Cohesion: 1.0
Nodes (1): Weekly Timeframe (1W)

### Community 58 - "Daily Timeframe (1D)"
Cohesion: 1.0
Nodes (1): Daily Timeframe (1D)

### Community 59 - "15-Minute Timeframe (15m)"
Cohesion: 1.0
Nodes (1): 15-Minute Timeframe (15m)

### Community 60 - "Volume Indicator"
Cohesion: 1.0
Nodes (1): Volume Indicator

### Community 61 - "Oscillator / Momentum Indicator (sub-panel)"
Cohesion: 1.0
Nodes (1): Oscillator / Momentum Indicator (sub-panel)

### Community 62 - "Moving Average Indicator"
Cohesion: 1.0
Nodes (1): Moving Average Indicator

### Community 63 - "BTCUSDT Sharp Price Decline Event (2026)"
Cohesion: 1.0
Nodes (1): BTCUSDT Sharp Price Decline Event (2026)

### Community 64 - "Nifty 50 Bearish Trend (Apr 2026)"
Cohesion: 1.0
Nodes (1): Nifty 50 Bearish Trend (Apr 2026)

### Community 65 - "JTLIND Intraday Volatility (Apr 2026)"
Cohesion: 1.0
Nodes (1): JTLIND Intraday Volatility (Apr 2026)

### Community 66 - "BTC Price Level ~71,000 USD"
Cohesion: 1.0
Nodes (1): BTC Price Level ~71,000 USD

### Community 67 - "Nifty Price Level ~22,000"
Cohesion: 1.0
Nodes (1): Nifty Price Level ~22,000

### Community 68 - "JTLIND Price Level ~64 INR"
Cohesion: 1.0
Nodes (1): JTLIND Price Level ~64 INR

## Knowledge Gaps
- **60 isolated node(s):** `tradingview-mcp (Original)`, `session_save Tool`, `session_get Tool`, `data_get_study_values Tool`, `data_get_pine_lines Tool` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `analyze-trades.js`** (2 nodes): `analyze-trades.js`, `claudeRequest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `wait.js`** (2 nodes): `wait.js`, `waitForChartReady()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `_format.js`** (2 nodes): `_format.js`, `jsonResult()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `pine_analyze.test.js`** (2 nodes): `pine_analyze.test.js`, `analyze()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `add_brain_shortcut.ps1`** (1 nodes): `add_brain_shortcut.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `create_shortcuts.ps1`** (1 nodes): `create_shortcuts.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `pine_pull.js`** (1 nodes): `pine_pull.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `pine_push.js`** (1 nodes): `pine_push.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `server.js`** (1 nodes): `server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `index.js`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `indicator.js`** (1 nodes): `indicator.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `layout.js`** (1 nodes): `layout.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `pane_set_layout Tool`** (1 nodes): `pane_set_layout Tool`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `BTCUSDT Weekly Chart - Binance (08:49:50)`** (1 nodes): `BTCUSDT Weekly Chart - Binance (08:49:50)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `BTCUSDT Weekly Chart - Binance (08:50:41)`** (1 nodes): `BTCUSDT Weekly Chart - Binance (08:50:41)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `BTCUSDT Weekly Chart - Binance (08:51:50)`** (1 nodes): `BTCUSDT Weekly Chart - Binance (08:51:50)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Nifty 50 Index Daily Chart - NSE (08:52:38)`** (1 nodes): `Nifty 50 Index Daily Chart - NSE (08:52:38)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Nifty 50 Index 15-min Chart - NSE (09:04:11)`** (1 nodes): `Nifty 50 Index 15-min Chart - NSE (09:04:11)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `JTL Industries Limited 15-min Chart - NSE (09:44:38)`** (1 nodes): `JTL Industries Limited 15-min Chart - NSE (09:44:38)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `JTL Industries Limited 15-min Chart - NSE (09:45:05)`** (1 nodes): `JTL Industries Limited 15-min Chart - NSE (09:45:05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `BTCUSDT - Bitcoin / TetherUS`** (1 nodes): `BTCUSDT - Bitcoin / TetherUS`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `NIFTY - Nifty 50 Index`** (1 nodes): `NIFTY - Nifty 50 Index`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `JTLIND - JTL Industries Limited`** (1 nodes): `JTLIND - JTL Industries Limited`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Binance Exchange`** (1 nodes): `Binance Exchange`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `NSE - National Stock Exchange of India`** (1 nodes): `NSE - National Stock Exchange of India`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `TradingView Platform`** (1 nodes): `TradingView Platform`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Weekly Timeframe (1W)`** (1 nodes): `Weekly Timeframe (1W)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Daily Timeframe (1D)`** (1 nodes): `Daily Timeframe (1D)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `15-Minute Timeframe (15m)`** (1 nodes): `15-Minute Timeframe (15m)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Volume Indicator`** (1 nodes): `Volume Indicator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Oscillator / Momentum Indicator (sub-panel)`** (1 nodes): `Oscillator / Momentum Indicator (sub-panel)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Moving Average Indicator`** (1 nodes): `Moving Average Indicator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `BTCUSDT Sharp Price Decline Event (2026)`** (1 nodes): `BTCUSDT Sharp Price Decline Event (2026)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Nifty 50 Bearish Trend (Apr 2026)`** (1 nodes): `Nifty 50 Bearish Trend (Apr 2026)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `JTLIND Intraday Volatility (Apr 2026)`** (1 nodes): `JTLIND Intraday Volatility (Apr 2026)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `BTC Price Level ~71,000 USD`** (1 nodes): `BTC Price Level ~71,000 USD`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Nifty Price Level ~22,000`** (1 nodes): `Nifty Price Level ~22,000`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `JTLIND Price Level ~64 INR`** (1 nodes): `JTLIND Price Level ~64 INR`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Claude Decision Tree (CLAUDE.md)` connect `Claude Decision Tree (CLAUDE.md)` to `Persistent Brain System`, `TradingView MCP Jackson`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `Setup Guide` connect `Claude Decision Tree (CLAUDE.md)` to `TradingView MCP Jackson`, `Research Notes`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `Research Notes` connect `Research Notes` to `Claude Decision Tree (CLAUDE.md)`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `tradingview-mcp (Original)`, `session_save Tool`, `session_get Tool` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Claude Decision Tree (CLAUDE.md)` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Research Notes` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `ui.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._