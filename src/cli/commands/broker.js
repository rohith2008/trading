import { register } from '../router.js';
import * as core from '../../core/broker.js';

register('broker', {
  description: 'AngelOne broker tools (login, order, positions, funds)',
  subcommands: new Map([
    ['login', {
      description: 'Login to AngelOne SmartAPI',
      options: { totp: { type: 'string', description: '6-digit TOTP code (skip if ANGELONE_TOTP_SECRET set)' } },
      handler: (opts) => core.login({ totp: opts.totp }),
    }],
    ['logout', {
      description: 'Clear session token',
      handler: () => core.logout(),
    }],
    ['session', {
      description: 'Check login status',
      handler: () => core.sessionStatus(),
    }],
    ['search', {
      description: 'Search for a symbol token',
      options: {
        symbol: { type: 'string', short: 's', description: 'Symbol to search' },
        exchange: { type: 'string', short: 'e', description: 'Exchange (default: NSE)' },
      },
      handler: (opts, pos) => core.searchSymbol({ symbol: opts.symbol || pos[0], exchange: opts.exchange }),
    }],
    ['ltp', {
      description: 'Get last traded price',
      options: {
        token: { type: 'string', short: 't', description: 'Symbol token' },
        exchange: { type: 'string', short: 'e', description: 'Exchange (default: NSE)' },
        symbol: { type: 'string', short: 's', description: 'Symbol name (reference only)' },
      },
      handler: (opts) => core.getLTP({ token: opts.token, exchange: opts.exchange, symbol: opts.symbol }),
    }],
    ['buy', {
      description: 'Place a BUY order',
      options: {
        symbol: { type: 'string', short: 's', description: 'Trading symbol e.g. SBIN-EQ' },
        token: { type: 'string', short: 't', description: 'Symbol token' },
        qty: { type: 'string', short: 'q', description: 'Quantity' },
        exchange: { type: 'string', short: 'e', description: 'Exchange (default: NSE)' },
        type: { type: 'string', description: 'Order type: MARKET (default), LIMIT, STOPLOSS_LIMIT' },
        product: { type: 'string', short: 'p', description: 'Product: INTRADAY (default), DELIVERY' },
        price: { type: 'string', description: 'Price for LIMIT orders' },
        trigger: { type: 'string', description: 'Trigger price for stoploss orders' },
      },
      handler: (opts) => core.placeOrder({
        symbol: opts.symbol, token: opts.token, action: 'BUY',
        quantity: Number(opts.qty), exchange: opts.exchange,
        order_type: opts.type, product: opts.product,
        price: opts.price ? Number(opts.price) : undefined,
        trigger_price: opts.trigger ? Number(opts.trigger) : undefined,
      }),
    }],
    ['sell', {
      description: 'Place a SELL order',
      options: {
        symbol: { type: 'string', short: 's', description: 'Trading symbol e.g. SBIN-EQ' },
        token: { type: 'string', short: 't', description: 'Symbol token' },
        qty: { type: 'string', short: 'q', description: 'Quantity' },
        exchange: { type: 'string', short: 'e', description: 'Exchange (default: NSE)' },
        type: { type: 'string', description: 'Order type: MARKET (default), LIMIT' },
        product: { type: 'string', short: 'p', description: 'Product: INTRADAY (default), DELIVERY' },
        price: { type: 'string', description: 'Price for LIMIT orders' },
        trigger: { type: 'string', description: 'Trigger price for stoploss orders' },
      },
      handler: (opts) => core.placeOrder({
        symbol: opts.symbol, token: opts.token, action: 'SELL',
        quantity: Number(opts.qty), exchange: opts.exchange,
        order_type: opts.type, product: opts.product,
        price: opts.price ? Number(opts.price) : undefined,
        trigger_price: opts.trigger ? Number(opts.trigger) : undefined,
      }),
    }],
    ['cancel', {
      description: 'Cancel a pending order',
      options: {
        id: { type: 'string', description: 'Order ID to cancel' },
      },
      handler: (opts, pos) => core.cancelOrder({ order_id: opts.id || pos[0] }),
    }],
    ['orders', {
      description: 'Show today\'s order book',
      handler: () => core.getOrderBook(),
    }],
    ['positions', {
      description: 'Show open positions with P&L',
      handler: () => core.getPositions(),
    }],
    ['holdings', {
      description: 'Show demat holdings',
      handler: () => core.getHoldings(),
    }],
    ['funds', {
      description: 'Show available cash and margin',
      handler: () => core.getFunds(),
    }],
  ]),
});
