// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE CONNECTOR
// Abstract interface + Mock implementation for paper trading/backtesting
// ═══════════════════════════════════════════════════════════════════════════

import { Candle, Position } from '../types';
import { Logger } from './logger';

// ─────────────────────────────────────────────────────────────────────────
// ABSTRACT EXCHANGE INTERFACE
// Implement this for different exchanges (Binance, Bybit, OKX, etc.)
// ─────────────────────────────────────────────────────────────────────────
export interface IExchange {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    // Market Data
    getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;
    getFundingRate(symbol: string): Promise<number>;
    getMarkPrice(symbol: string): Promise<number>;

    // Trading
    openPosition(
        symbol: string,
        side: 'LONG' | 'SHORT',
        size: number,
        leverage: number
    ): Promise<{ orderId: string; avgPrice: number }>;

    closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }>;

    setStopLoss(symbol: string, stopPrice: number): Promise<void>;
    setTakeProfit(symbol: string, tpPrice: number): Promise<void>;

    // Account
    getBalance(): Promise<number>;
    getPosition(symbol: string): Promise<Position | null>;
}

// ─────────────────────────────────────────────────────────────────────────
// MOCK EXCHANGE (for backtesting/paper trading)
// Full-featured simulation with proper leverage and PnL calculations
// ─────────────────────────────────────────────────────────────────────────
export class MockExchange implements IExchange {
    private logger: Logger;
    private balance: number;
    private initialBalance: number;
    private position: Position | null = null;
    private candles: Candle[] = [];
    private currentIndex: number = 0;
    private leverage: number = 1;

    // Simulated order tracking
    private stopLossOrder: number | null = null;
    private takeProfitOrder: number | null = null;

    constructor(initialBalance: number) {
        this.logger = new Logger('MockExchange');
        this.balance = initialBalance;
        this.initialBalance = initialBalance;
    }

    async connect(): Promise<void> {
        this.logger.info(`Mock exchange connected. Initial balance: $${this.balance.toFixed(2)}`);
    }

    async disconnect(): Promise<void> {
        this.logger.info('Mock exchange disconnected');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CANDLE MANAGEMENT (for backtesting)
    // ─────────────────────────────────────────────────────────────────────────
    loadCandles(candles: Candle[]): void {
        this.candles = candles;
        this.currentIndex = 0;
        this.logger.info(`Loaded ${candles.length} candles for backtesting`);
    }

    advanceCandle(): Candle | null {
        if (this.currentIndex >= this.candles.length) return null;
        return this.candles[this.currentIndex++];
    }

    setCurrentIndex(index: number): void {
        this.currentIndex = Math.min(index, this.candles.length);
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARKET DATA
    // ─────────────────────────────────────────────────────────────────────────
    async getCandles(_symbol: string, _timeframe: string, limit: number): Promise<Candle[]> {
        const start = Math.max(0, this.currentIndex - limit);
        return this.candles.slice(start, this.currentIndex);
    }

    async getFundingRate(_symbol: string): Promise<number> {
        // Mock: random funding between -0.01% and 0.01%
        return (Math.random() - 0.5) * 0.0002;
    }

    async getMarkPrice(_symbol: string): Promise<number> {
        if (this.currentIndex === 0 || this.candles.length === 0) {
            return 0;
        }
        return this.candles[Math.min(this.currentIndex, this.candles.length) - 1].close;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRADING OPERATIONS
    // ─────────────────────────────────────────────────────────────────────────
    async openPosition(
        symbol: string,
        side: 'LONG' | 'SHORT',
        size: number,
        leverage: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        const price = await this.getMarkPrice(symbol);

        if (price === 0) {
            throw new Error('Cannot open position: no price data available');
        }

        // Store leverage for PnL calculations
        this.leverage = leverage;

        // Calculate margin required
        const notionalValue = size * price;
        const marginRequired = notionalValue / leverage;

        if (marginRequired > this.balance) {
            throw new Error(`Insufficient margin. Required: $${marginRequired.toFixed(2)}, Available: $${this.balance.toFixed(2)}`);
        }

        this.position = {
            side,
            entryPrice: price,
            size,
            stopLoss: 0,
            takeProfit: 0,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            initialSize: size,
            remainingSize: size
        };

        // Reset SL/TP orders
        this.stopLossOrder = null;
        this.takeProfitOrder = null;

        this.logger.trade(side, price, `Position opened | Size: ${size.toFixed(6)} | Leverage: ${leverage}x | Margin: $${marginRequired.toFixed(2)}`);

        return { orderId: `mock_${Date.now()}`, avgPrice: price };
    }

    async closePosition(
        symbol: string,
        position: Position,
        closeSize?: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        const price = await this.getMarkPrice(symbol);
        const sizeToClose = closeSize || position.size;

        // Calculate PnL with leverage
        const pnl = this.calculatePnL(position, price, sizeToClose);

        this.balance += pnl;

        // Partial or full close
        if (closeSize && closeSize < position.size && this.position) {
            this.position.size -= closeSize;
            this.position.remainingSize = this.position.size;
            this.logger.trade('PARTIAL_CLOSE', price, `Closed ${sizeToClose.toFixed(6)} | PnL: $${pnl.toFixed(2)} | Remaining: ${this.position.size.toFixed(6)}`);
        } else {
            this.position = null;
            this.stopLossOrder = null;
            this.takeProfitOrder = null;
            this.logger.trade('CLOSE', price, `Position closed | PnL: $${pnl.toFixed(2)} | Balance: $${this.balance.toFixed(2)}`);
        }

        return { orderId: `mock_close_${Date.now()}`, avgPrice: price };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SL/TP ORDERS
    // ─────────────────────────────────────────────────────────────────────────
    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        this.stopLossOrder = stopPrice;
        if (this.position) {
            this.position.stopLoss = stopPrice;
        }
        this.logger.info(`Stop Loss set @ $${stopPrice.toFixed(2)}`);
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        this.takeProfitOrder = tpPrice;
        if (this.position) {
            this.position.takeProfit = tpPrice;
        }
        this.logger.info(`Take Profit set @ $${tpPrice.toFixed(2)}`);
    }

    // Check if SL/TP hit (call this on each candle in backtest)
    checkSLTPHit(currentPrice: number, highPrice: number, lowPrice: number): { hit: boolean; type: 'SL' | 'TP' | null; price: number } {
        if (!this.position) {
            return { hit: false, type: null, price: currentPrice };
        }

        if (this.position.side === 'LONG') {
            // Check SL (price goes down)
            if (this.stopLossOrder && lowPrice <= this.stopLossOrder) {
                return { hit: true, type: 'SL', price: this.stopLossOrder };
            }
            // Check TP (price goes up)
            if (this.takeProfitOrder && highPrice >= this.takeProfitOrder) {
                return { hit: true, type: 'TP', price: this.takeProfitOrder };
            }
        } else {
            // SHORT position
            // Check SL (price goes up)
            if (this.stopLossOrder && highPrice >= this.stopLossOrder) {
                return { hit: true, type: 'SL', price: this.stopLossOrder };
            }
            // Check TP (price goes down)
            if (this.takeProfitOrder && lowPrice <= this.takeProfitOrder) {
                return { hit: true, type: 'TP', price: this.takeProfitOrder };
            }
        }

        return { hit: false, type: null, price: currentPrice };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCOUNT
    // ─────────────────────────────────────────────────────────────────────────
    async getBalance(): Promise<number> {
        return this.balance;
    }

    async getPosition(_symbol: string): Promise<Position | null> {
        return this.position;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private calculatePnL(position: Position, exitPrice: number, size?: number): number {
        const posSize = size || position.size;
        let pnlPercent: number;

        if (position.side === 'LONG') {
            pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
        } else {
            pnlPercent = ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
        }

        // Apply leverage to PnL
        const leveragedPnlPercent = pnlPercent * this.leverage;
        const notionalValue = posSize * position.entryPrice;
        const pnl = notionalValue * (leveragedPnlPercent / 100);

        return pnl;
    }

    // Update unrealized PnL for position
    async updateUnrealizedPnL(symbol: string): Promise<void> {
        if (!this.position) return;

        const currentPrice = await this.getMarkPrice(symbol);
        this.position.unrealizedPnl = this.calculatePnL(this.position, currentPrice);
    }

    // Get stats
    getStats(): { balance: number; initialBalance: number; totalPnL: number; totalPnLPercent: number } {
        const totalPnL = this.balance - this.initialBalance;
        const totalPnLPercent = (totalPnL / this.initialBalance) * 100;
        return {
            balance: this.balance,
            initialBalance: this.initialBalance,
            totalPnL,
            totalPnLPercent
        };
    }

    // Reset exchange state
    reset(): void {
        this.balance = this.initialBalance;
        this.position = null;
        this.stopLossOrder = null;
        this.takeProfitOrder = null;
        this.currentIndex = 0;
        this.logger.info('Mock exchange reset');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// GENERIC EXCHANGE CONNECTOR (Template for real exchanges)
// Extend this class to implement real exchange integrations
// ─────────────────────────────────────────────────────────────────────────
export abstract class BaseExchangeConnector implements IExchange {
    protected logger: Logger;
    protected apiUrl: string;
    protected apiKey?: string;
    protected apiSecret?: string;

    constructor(name: string, apiUrl: string, apiKey?: string, apiSecret?: string) {
        this.logger = new Logger(name);
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
    }

    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
    abstract getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;
    abstract getFundingRate(symbol: string): Promise<number>;
    abstract getMarkPrice(symbol: string): Promise<number>;
    abstract openPosition(symbol: string, side: 'LONG' | 'SHORT', size: number, leverage: number): Promise<{ orderId: string; avgPrice: number }>;
    abstract closePosition(symbol: string, position: Position): Promise<{ orderId: string; avgPrice: number }>;
    abstract setStopLoss(symbol: string, stopPrice: number): Promise<void>;
    abstract setTakeProfit(symbol: string, tpPrice: number): Promise<void>;
    abstract getBalance(): Promise<number>;
    abstract getPosition(symbol: string): Promise<Position | null>;

    // Helper: Convert timeframe to milliseconds
    protected getIntervalMs(timeframe: string): number {
        const map: Record<string, number> = {
            '1m': 60000,
            '5m': 300000,
            '15m': 900000,
            '30m': 1800000,
            '1h': 3600000,
            '4h': 14400000,
            '1d': 86400000
        };
        return map[timeframe] || 3600000;
    }
}
