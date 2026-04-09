import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/broker.js';

export function registerBrokerTools(server) {

  server.tool('broker_login',
    'Login to AngelOne SmartAPI. Reads credentials from .env. Pass totp if ANGELONE_TOTP_SECRET is not set.',
    { totp: z.string().optional().describe('6-digit TOTP code (skip if ANGELONE_TOTP_SECRET is set in .env)') },
    async ({ totp }) => {
      try { return jsonResult(await core.login({ totp })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_logout',
    'Clear the AngelOne session token.',
    {},
    async () => {
      try { return jsonResult(core.logout()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_session',
    'Check AngelOne login status and token expiry.',
    {},
    async () => {
      try { return jsonResult(core.sessionStatus()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_search_symbol',
    'Search for a symbol on AngelOne to get its token ID (required for placing orders).',
    {
      symbol: z.string().describe('Symbol to search e.g. "SBIN", "RELIANCE", "NIFTY"'),
      exchange: z.string().optional().describe('Exchange: NSE (default), BSE, NFO, MCX'),
    },
    async ({ symbol, exchange }) => {
      try { return jsonResult(await core.searchSymbol({ symbol, exchange })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_get_ltp',
    'Get the last traded price (LTP) for a symbol.',
    {
      token: z.string().describe('Symbol token from broker_search_symbol'),
      exchange: z.string().optional().describe('Exchange: NSE (default), BSE, NFO, MCX'),
      symbol: z.string().optional().describe('Symbol name (for reference only)'),
    },
    async ({ token, exchange, symbol }) => {
      try { return jsonResult(await core.getLTP({ token, exchange, symbol })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_place_order',
    'Place a BUY or SELL order on AngelOne. Use broker_search_symbol first to get the token.',
    {
      symbol: z.string().describe('Trading symbol e.g. "SBIN-EQ", "RELIANCE-EQ", "NIFTY24DECFUT"'),
      token: z.string().describe('Symbol token from broker_search_symbol'),
      action: z.enum(['BUY', 'SELL']).describe('BUY or SELL'),
      quantity: z.number().int().positive().describe('Number of shares/lots'),
      exchange: z.string().optional().describe('NSE (default), BSE, NFO, MCX'),
      order_type: z.enum(['MARKET', 'LIMIT', 'STOPLOSS_LIMIT', 'STOPLOSS_MARKET']).optional().describe('Order type (default: MARKET)'),
      product: z.enum(['INTRADAY', 'DELIVERY', 'CARRYFORWARD', 'MARGIN']).optional().describe('Product type (default: INTRADAY)'),
      price: z.number().optional().describe('Price for LIMIT orders'),
      trigger_price: z.number().optional().describe('Trigger price for stoploss orders'),
    },
    async (args) => {
      try { return jsonResult(await core.placeOrder(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_cancel_order',
    'Cancel a pending order by order ID.',
    {
      order_id: z.string().describe('Order ID to cancel'),
      variety: z.string().optional().describe('Order variety (default: NORMAL)'),
    },
    async ({ order_id, variety }) => {
      try { return jsonResult(await core.cancelOrder({ order_id, variety })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_modify_order',
    'Modify a pending order (price, quantity, type).',
    {
      order_id: z.string().describe('Order ID to modify'),
      symbol: z.string().describe('Trading symbol'),
      token: z.string().describe('Symbol token'),
      quantity: z.number().int().positive().describe('New quantity'),
      price: z.number().optional().describe('New price'),
      trigger_price: z.number().optional().describe('New trigger price'),
      exchange: z.string().optional().describe('Exchange'),
      order_type: z.string().optional().describe('New order type'),
      product: z.string().optional().describe('Product type'),
      variety: z.string().optional().describe('Order variety'),
    },
    async (args) => {
      try { return jsonResult(await core.modifyOrder(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_order_book',
    'Get today\'s order book — all placed orders with status.',
    {},
    async () => {
      try { return jsonResult(await core.getOrderBook()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_positions',
    'Get current open positions with P&L.',
    {},
    async () => {
      try { return jsonResult(await core.getPositions()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_holdings',
    'Get your demat holdings (long-term portfolio) with P&L.',
    {},
    async () => {
      try { return jsonResult(await core.getHoldings()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('broker_funds',
    'Get available cash, used margin, and net funds.',
    {},
    async () => {
      try { return jsonResult(await core.getFunds()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
