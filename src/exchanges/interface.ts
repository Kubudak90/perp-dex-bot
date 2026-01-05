// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE INTERFACE
// Standard interface for all perpetual DEX connectors
// ═══════════════════════════════════════════════════════════════════════════

import { Candle, MarketData, Position, OrderResult } from '../types';

/**
 * Exchange Configuration
 */
export interface ExchangeConfig {
    apiUrl: string;
    wsUrl?: string;
    privateKey?: string;
    testnet?: boolean;
}

/**
 * Order Parameters
 */
export interface OrderParams {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    price?: number;           // Limit order price (optional for market orders)
    stopLoss?: number;
    takeProfit?: number;
    reduceOnly?: boolean;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

/**
 * Account Balance
 */
export interface Balance {
    total: number;
    available: number;
    locked: number;
    unrealizedPnl: number;
}

/**
 * Exchange Statistics (for airdrop tracking)
 */
export interface ExchangeStats {
    totalTrades: number;
    totalVolume: number;
    points?: number;           // Platform-specific points/rewards
    makerTrades?: number;
    takerTrades?: number;
    fees?: {
        maker: number;
        taker: number;
        total: number;
    };
}

/**
 * Standard interface that all exchange connectors must implement
 */
export interface IExchange {
    /**
     * Connect to the exchange (authenticate, initialize)
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the exchange
     */
    disconnect(): Promise<void>;

    /**
     * Check if connected
     */
    isConnected(): boolean;

    /**
     * Get historical candle data
     */
    getCandles(symbol: string, timeframe: string, limit?: number): Promise<Candle[]>;

    /**
     * Get current market data
     */
    getMarketData(symbol: string): Promise<MarketData>;

    /**
     * Get account balance
     */
    getBalance(): Promise<Balance>;

    /**
     * Get current positions
     */
    getPositions(): Promise<Position[]>;

    /**
     * Open a new position
     */
    openPosition(params: OrderParams): Promise<OrderResult>;

    /**
     * Close an existing position
     */
    closePosition(symbol: string, size?: number): Promise<OrderResult>;

    /**
     * Update stop loss and take profit for existing position
     */
    updatePosition(symbol: string, stopLoss?: number, takeProfit?: number): Promise<void>;

    /**
     * Get trading statistics (for airdrop tracking)
     */
    getStats(): Promise<ExchangeStats>;

    /**
     * Subscribe to real-time price updates
     */
    subscribeToPrice(symbol: string, callback: (price: number) => void): Promise<void>;

    /**
     * Unsubscribe from price updates
     */
    unsubscribeFromPrice(symbol: string): Promise<void>;
}
