// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE CONNECTOR
// Abstract interface + Hyperliquid implementation
// ═══════════════════════════════════════════════════════════════════════════

import { Candle, Position } from '../types';
import { Logger } from './logger';
import { retryWithBackoff, CircuitBreaker, RateLimiter, withTimeout } from './retry';
import { NetworkError, ExchangeError, InsufficientDataError } from './errors';

// ─────────────────────────────────────────────────────────────────────────
// ABSTRACT EXCHANGE INTERFACE
// Implement this for different DEXs (Hyperliquid, GMX, dYdX, etc.)
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
// HYPERLIQUID CONNECTOR
// Real implementation for Hyperliquid DEX
// ─────────────────────────────────────────────────────────────────────────
export class HyperliquidConnector implements IExchange {
    private logger: Logger;
    private apiUrl: string;
    // Private key will be used for order signing when Hyperliquid SDK is integrated
    private _privateKey: string; // eslint-disable-line @typescript-eslint/no-unused-vars
    private walletAddress: string;
    private circuitBreaker: CircuitBreaker;
    private rateLimiter: RateLimiter;
    private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

    constructor(privateKey: string, walletAddress: string, testnet: boolean = true) {
        this.logger = new Logger('Hyperliquid');
        this._privateKey = privateKey;
        this.walletAddress = walletAddress;
        this.apiUrl = testnet
            ? 'https://api.hyperliquid-testnet.xyz'
            : 'https://api.hyperliquid.xyz';

        // Circuit breaker: 5 failures, 60s cooldown
        this.circuitBreaker = new CircuitBreaker(5, 60000, 'Hyperliquid');

        // Rate limiter: 10 requests per second
        this.rateLimiter = new RateLimiter(10, 10, 'Hyperliquid');
    }

    async connect(): Promise<void> {
        this.logger.info(`Connecting to Hyperliquid (${this.apiUrl})`);
        // Verify connection
        const balance = await this.getBalance();
        this.logger.info(`Connected. Balance: $${balance.toFixed(2)}`);
    }

    async disconnect(): Promise<void> {
        this.logger.info('Disconnected from Hyperliquid');
    }

    async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();

                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/info`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'candleSnapshot',
                                req: {
                                    coin: symbol,
                                    interval: timeframe,
                                    startTime: Date.now() - (limit * this.getIntervalMs(timeframe)),
                                    endTime: Date.now()
                                }
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        `Candles request timeout for ${symbol}`
                    );

                    if (!response.ok) {
                        throw new NetworkError(
                            `Failed to fetch candles: ${response.statusText}`,
                            response.status
                        );
                    }

                    const data = await response.json();

                    if (!Array.isArray(data) || data.length === 0) {
                        throw new InsufficientDataError(`No candle data returned for ${symbol}`);
                    }

                    return data.map((c: any) => ({
                        timestamp: c.t,
                        open: parseFloat(c.o),
                        high: parseFloat(c.h),
                        low: parseFloat(c.l),
                        close: parseFloat(c.c),
                        volume: parseFloat(c.v)
                    }));
                }, 'getCandles');
            },
            { maxRetries: 4 },
            this.logger,
            'getCandles'
        );
    }

    async getFundingRate(symbol: string): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();

                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/info`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'metaAndAssetCtxs'
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Funding rate request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(
                            `Failed to fetch funding rate: ${response.statusText}`,
                            response.status
                        );
                    }

                    const data = (await response.json()) as any[];
                    const assetCtx = data[1]?.find((a: any) => a.coin === symbol);

                    if (!assetCtx) {
                        this.logger.warn(`No funding rate found for ${symbol}, returning 0`);
                        return 0;
                    }

                    return parseFloat(assetCtx.funding);
                }, 'getFundingRate');
            },
            { maxRetries: 4 },
            this.logger,
            'getFundingRate'
        );
    }

    async getMarkPrice(symbol: string): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();

                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/info`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'metaAndAssetCtxs'
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Mark price request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(
                            `Failed to fetch mark price: ${response.statusText}`,
                            response.status
                        );
                    }

                    const data = (await response.json()) as any[];
                    const assetCtx = data[1]?.find((a: any) => a.coin === symbol);

                    if (!assetCtx) {
                        throw new ExchangeError(`No mark price found for ${symbol}`);
                    }

                    return parseFloat(assetCtx.markPx);
                }, 'getMarkPrice');
            },
            { maxRetries: 4 },
            this.logger,
            'getMarkPrice'
        );
    }

    async openPosition(
        symbol: string,
        side: 'LONG' | 'SHORT',
        size: number,
        _leverage: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        // Hyperliquid order placement
        // NOTE: Bu kısım için gerçek imza ve order gönderimi gerekli
        // SDK kullanmanız önerilir: https://github.com/hyperliquid-dex/hyperliquid-ts-sdk

        this.logger.trade(side, 0, `Opening ${side} position, size: ${size}`);

        // Placeholder - implement with actual Hyperliquid SDK
        const orderId = `order_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade('CLOSE', 0, `Closing ${position.side} position`);

        // Placeholder - implement with actual Hyperliquid SDK
        const orderId = `close_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        this.logger.info(`Setting SL @ ${stopPrice}`);
        // Implement with Hyperliquid SDK
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        this.logger.info(`Setting TP @ ${tpPrice}`);
        // Implement with Hyperliquid SDK
    }

    async getBalance(): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();

                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/info`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'clearinghouseState',
                                user: this.walletAddress
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Balance request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(
                            `Failed to fetch balance: ${response.statusText}`,
                            response.status
                        );
                    }

                    const data = (await response.json()) as any;

                    if (!data.marginSummary?.accountValue) {
                        throw new ExchangeError('Invalid balance response');
                    }

                    return parseFloat(data.marginSummary.accountValue);
                }, 'getBalance');
            },
            { maxRetries: 4 },
            this.logger,
            'getBalance'
        );
    }

    async getPosition(symbol: string): Promise<Position | null> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();

                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/info`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'clearinghouseState',
                                user: this.walletAddress
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Position request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(
                            `Failed to fetch position: ${response.statusText}`,
                            response.status
                        );
                    }

                    const data = (await response.json()) as any;
                    const pos = data.assetPositions?.find((p: any) => p.position?.coin === symbol);

                    if (!pos || parseFloat(pos.position.szi) === 0) {
                        return null;
                    }

                    const szi = parseFloat(pos.position.szi);

                    return {
                        side: szi > 0 ? 'LONG' : 'SHORT',
                        entryPrice: parseFloat(pos.position.entryPx),
                        size: Math.abs(szi),
                        stopLoss: 0, // Managed separately
                        takeProfit: 0,
                        entryTime: Date.now(),
                        unrealizedPnl: parseFloat(pos.position.unrealizedPnl)
                    };
                }, 'getPosition');
            },
            { maxRetries: 4 },
            this.logger,
            'getPosition'
        );
    }

    private getIntervalMs(timeframe: string): number {
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

// ─────────────────────────────────────────────────────────────────────────
// SLIPPAGE MODEL
// ─────────────────────────────────────────────────────────────────────────
export interface SlippageConfig {
    baseSlippage: number;          // Base slippage % (e.g., 0.05 = 0.05%)
    volumeImpact: number;          // Additional slippage per $10k volume
    volatilityMultiplier: number;  // Multiplier based on ATR
    maxSlippage: number;           // Maximum slippage cap %
}

const DEFAULT_SLIPPAGE: SlippageConfig = {
    baseSlippage: 0.03,            // 0.03% base slippage
    volumeImpact: 0.01,            // +0.01% per $10k
    volatilityMultiplier: 1.5,     // 1.5x in high volatility
    maxSlippage: 0.5               // 0.5% max slippage
};

// ─────────────────────────────────────────────────────────────────────────
// MOCK EXCHANGE (for backtesting/paper trading)
// ─────────────────────────────────────────────────────────────────────────
export class MockExchange implements IExchange {
    private logger: Logger;
    private balance: number;
    private position: Position | null = null;
    private candles: Candle[] = [];
    private currentIndex: number = 0;
    private slippageConfig: SlippageConfig;
    private recentVolatility: number = 0;

    constructor(initialBalance: number, slippageConfig?: Partial<SlippageConfig>) {
        this.logger = new Logger('MockExchange');
        this.balance = initialBalance;
        this.slippageConfig = { ...DEFAULT_SLIPPAGE, ...slippageConfig };
    }

    // Calculate realistic slippage based on order size and market conditions
    private calculateSlippage(
        side: 'LONG' | 'SHORT' | 'CLOSE',
        orderValue: number,
        basePrice: number
    ): number {
        // Base slippage
        let slippage = this.slippageConfig.baseSlippage;

        // Volume impact: larger orders have more slippage
        const volumeImpact = (orderValue / 10000) * this.slippageConfig.volumeImpact;
        slippage += volumeImpact;

        // Volatility adjustment: high volatility = more slippage
        if (this.recentVolatility > 0.02) { // >2% ATR
            slippage *= this.slippageConfig.volatilityMultiplier;
        }

        // Random component (market microstructure noise)
        const randomFactor = 0.5 + Math.random(); // 0.5x to 1.5x
        slippage *= randomFactor;

        // Cap at max slippage
        slippage = Math.min(slippage, this.slippageConfig.maxSlippage);

        // Apply slippage direction (buy = pay more, sell = receive less)
        const slippagePercent = slippage / 100;
        if (side === 'LONG') {
            return basePrice * (1 + slippagePercent); // Worse entry for longs
        } else {
            return basePrice * (1 - slippagePercent); // Worse exit/entry for shorts
        }
    }

    // Update volatility estimate from recent candles
    updateVolatility(): void {
        if (this.currentIndex < 14) return;

        const recentCandles = this.candles.slice(this.currentIndex - 14, this.currentIndex);
        let sumTr = 0;

        for (let i = 1; i < recentCandles.length; i++) {
            const tr = Math.max(
                recentCandles[i].high - recentCandles[i].low,
                Math.abs(recentCandles[i].high - recentCandles[i - 1].close),
                Math.abs(recentCandles[i].low - recentCandles[i - 1].close)
            );
            sumTr += tr;
        }

        const atr = sumTr / (recentCandles.length - 1);
        const avgPrice = recentCandles[recentCandles.length - 1].close;
        this.recentVolatility = atr / avgPrice; // ATR as percentage
    }

    async connect(): Promise<void> {
        this.logger.info('Mock exchange connected');
    }

    async disconnect(): Promise<void> {
        this.logger.info('Mock exchange disconnected');
    }

    // Load historical data for backtesting
    loadCandles(candles: Candle[]): void {
        this.candles = candles;
        this.currentIndex = 0;
    }

    advanceCandle(): Candle | null {
        if (this.currentIndex >= this.candles.length) return null;
        return this.candles[this.currentIndex++];
    }

    async getCandles(_symbol: string, _timeframe: string, limit: number): Promise<Candle[]> {
        const start = Math.max(0, this.currentIndex - limit);
        return this.candles.slice(start, this.currentIndex);
    }

    async getFundingRate(_symbol: string): Promise<number> {
        // Mock: random funding between -0.01% and 0.01%
        return (Math.random() - 0.5) * 0.0002;
    }

    async getMarkPrice(_symbol: string): Promise<number> {
        if (this.currentIndex === 0) return 0;
        return this.candles[this.currentIndex - 1].close;
    }

    async openPosition(
        symbol: string,
        side: 'LONG' | 'SHORT',
        size: number,
        _leverage: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        const basePrice = await this.getMarkPrice(symbol);
        const orderValue = size * basePrice;

        // Update volatility and calculate slippage
        this.updateVolatility();
        const fillPrice = this.calculateSlippage(side, orderValue, basePrice);

        this.position = {
            side,
            entryPrice: fillPrice,
            size,
            stopLoss: 0,
            takeProfit: 0,
            entryTime: Date.now(),
            unrealizedPnl: 0
        };

        const slippageBps = Math.abs((fillPrice - basePrice) / basePrice * 10000).toFixed(1);
        this.logger.trade(side, fillPrice, `Mock position opened (slippage: ${slippageBps} bps)`);

        return { orderId: `mock_${Date.now()}`, avgPrice: fillPrice };
    }

    async closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }> {
        const basePrice = await this.getMarkPrice(symbol);
        const orderValue = position.size * basePrice;

        // Calculate slippage for exit (opposite direction of position)
        this.updateVolatility();
        const closeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
        const fillPrice = this.calculateSlippage(closeSide as 'LONG' | 'SHORT', orderValue, basePrice);

        // Calculate PnL with actual fill price
        let pnl: number;
        if (position.side === 'LONG') {
            pnl = (fillPrice - position.entryPrice) * position.size;
        } else {
            pnl = (position.entryPrice - fillPrice) * position.size;
        }

        this.balance += pnl;
        this.position = null;

        const slippageBps = Math.abs((fillPrice - basePrice) / basePrice * 10000).toFixed(1);
        this.logger.trade('CLOSE', fillPrice, `Mock position closed. PnL: ${pnl.toFixed(2)} (slippage: ${slippageBps} bps)`);

        return { orderId: `mock_close_${Date.now()}`, avgPrice: fillPrice };
    }

    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        if (this.position) {
            this.position.stopLoss = stopPrice;
        }
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        if (this.position) {
            this.position.takeProfit = tpPrice;
        }
    }

    async getBalance(): Promise<number> {
        return this.balance;
    }

    async getPosition(_symbol: string): Promise<Position | null> {
        return this.position;
    }
}
