// ═══════════════════════════════════════════════════════════════════════════
// MULTI-EXCHANGE CONNECTORS
// Support for: Nado, StandX, GRVT, Pacifica
// ═══════════════════════════════════════════════════════════════════════════

import { Candle, Position, ExchangeType, ExchangeConfig } from '../../types';
import { Logger } from '../logger';
import { retryWithBackoff, CircuitBreaker, RateLimiter, withTimeout } from '../retry';
import { NetworkError, ExchangeError, InsufficientDataError } from '../errors';

// ─────────────────────────────────────────────────────────────────────────
// ABSTRACT EXCHANGE INTERFACE
// ─────────────────────────────────────────────────────────────────────────
export interface IExchange {
    readonly name: ExchangeType;
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
// BASE EXCHANGE (Common functionality)
// ─────────────────────────────────────────────────────────────────────────
abstract class BaseExchange implements IExchange {
    abstract readonly name: ExchangeType;
    protected logger: Logger;
    protected circuitBreaker: CircuitBreaker;
    protected rateLimiter: RateLimiter;
    protected readonly REQUEST_TIMEOUT = 30000;
    protected config: ExchangeConfig;

    constructor(config: ExchangeConfig, exchangeName: string) {
        this.config = config;
        this.logger = new Logger(exchangeName);
        this.circuitBreaker = new CircuitBreaker(5, 60000, exchangeName);
        this.rateLimiter = new RateLimiter(10, 10, exchangeName);
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

// ═══════════════════════════════════════════════════════════════════════════
// NADO CONNECTOR
// Kraken-backed CLOB DEX on Ink L2
// API: https://docs.nado.xyz/developer-resources/api/v2
// ═══════════════════════════════════════════════════════════════════════════
export class NadoConnector extends BaseExchange {
    readonly name: ExchangeType = 'NADO';
    private gatewayUrl: string;
    private archiveUrl: string;

    constructor(config: ExchangeConfig) {
        super(config, 'Nado');
        const isTestnet = config.testnet !== false;
        this.gatewayUrl = config.nadoApiUrl ||
            (isTestnet ? 'https://gateway.test.nado.xyz/v2' : 'https://gateway.nado.xyz/v2');
        this.archiveUrl = isTestnet ?
            'https://archive.test.nado.xyz/v2' : 'https://archive.nado.xyz/v2';
    }

    async connect(): Promise<void> {
        this.logger.info(`Connecting to Nado (${this.gatewayUrl})`);
        const balance = await this.getBalance();
        this.logger.info(`Connected. Balance: $${balance.toFixed(2)}`);
    }

    async disconnect(): Promise<void> {
        this.logger.info('Disconnected from Nado');
    }

    async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    // Nado uses archive endpoint for historical data
                    const response = await withTimeout(
                        fetch(`${this.archiveUrl}/candles`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                symbol: symbol,
                                interval: timeframe,
                                limit: limit,
                                endTime: Date.now()
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        `Candles request timeout for ${symbol}`
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch candles: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    if (!Array.isArray(data) || data.length === 0) {
                        throw new InsufficientDataError(`No candle data returned for ${symbol}`);
                    }

                    return data.map((c: any) => ({
                        timestamp: c.timestamp || c.t,
                        open: parseFloat(c.open || c.o),
                        high: parseFloat(c.high || c.h),
                        low: parseFloat(c.low || c.l),
                        close: parseFloat(c.close || c.c),
                        volume: parseFloat(c.volume || c.v)
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
                        fetch(`${this.gatewayUrl}/contracts/${symbol}/funding`),
                        this.REQUEST_TIMEOUT,
                        'Funding rate request timeout'
                    );

                    if (!response.ok) {
                        this.logger.warn(`No funding rate for ${symbol}, returning 0`);
                        return 0;
                    }

                    const data = await response.json();
                    return parseFloat(data.fundingRate || data.rate || '0');
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
                        fetch(`${this.gatewayUrl}/tickers/${symbol}`),
                        this.REQUEST_TIMEOUT,
                        'Mark price request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch mark price: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    return parseFloat(data.markPrice || data.lastPrice || data.price);
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
        this.logger.trade(side, 0, `Opening ${side} position, size: ${size}`);

        // TODO: Implement real Nado order signing with EIP-712
        // Nado requires signed orders via their SDK
        const orderId = `nado_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade('CLOSE', 0, `Closing ${position.side} position`);

        const orderId = `nado_close_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        this.logger.info(`Setting SL @ ${stopPrice}`);
        // TODO: Implement with Nado trigger orders API
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        this.logger.info(`Setting TP @ ${tpPrice}`);
        // TODO: Implement with Nado trigger orders API
    }

    async getBalance(): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.gatewayUrl}/account`, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                // TODO: Add authentication headers
                            }
                        }),
                        this.REQUEST_TIMEOUT,
                        'Balance request timeout'
                    );

                    if (!response.ok) {
                        // Return mock balance for now
                        this.logger.warn('Could not fetch balance, using default');
                        return 10000;
                    }

                    const data = await response.json();
                    return parseFloat(data.balance || data.equity || data.totalBalance || '10000');
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
                        fetch(`${this.gatewayUrl}/positions/${symbol}`, {
                            headers: {
                                'Content-Type': 'application/json',
                            }
                        }),
                        this.REQUEST_TIMEOUT,
                        'Position request timeout'
                    );

                    if (!response.ok) {
                        return null;
                    }

                    const data = await response.json();
                    if (!data || !data.size || parseFloat(data.size) === 0) {
                        return null;
                    }

                    const size = parseFloat(data.size);
                    return {
                        side: size > 0 ? 'LONG' : 'SHORT',
                        entryPrice: parseFloat(data.entryPrice),
                        size: Math.abs(size),
                        stopLoss: 0,
                        takeProfit: 0,
                        entryTime: Date.now(),
                        unrealizedPnl: parseFloat(data.unrealizedPnl || '0')
                    };
                }, 'getPosition');
            },
            { maxRetries: 4 },
            this.logger,
            'getPosition'
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GRVT CONNECTOR
// Hybrid DEX on zkSync with CLOB
// API: https://api-docs.grvt.io/
// ═══════════════════════════════════════════════════════════════════════════
export class GRVTConnector extends BaseExchange {
    readonly name: ExchangeType = 'GRVT';
    private apiUrl: string;
    private apiKey: string;
    private subAccountId: string;

    constructor(config: ExchangeConfig) {
        super(config, 'GRVT');
        const isTestnet = config.testnet !== false;
        this.apiUrl = config.grvtApiUrl ||
            (isTestnet ? 'https://testnet.grvt.io/api' : 'https://api.grvt.io');
        this.apiKey = config.grvtApiKey || '';
        this.subAccountId = config.grvtSubAccountId || '';
    }

    private getAuthHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
            'X-Sub-Account-ID': this.subAccountId
        };
    }

    async connect(): Promise<void> {
        this.logger.info(`Connecting to GRVT (${this.apiUrl})`);
        const balance = await this.getBalance();
        this.logger.info(`Connected. Balance: $${balance.toFixed(2)}`);
    }

    async disconnect(): Promise<void> {
        this.logger.info('Disconnected from GRVT');
    }

    async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/full/v1/klines`, {
                            method: 'POST',
                            headers: this.getAuthHeaders(),
                            body: JSON.stringify({
                                instrument: `${symbol}_USDT_PERP`,
                                interval: timeframe,
                                limit: limit
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        `Candles request timeout for ${symbol}`
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch candles: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    const candles = data.result || data.data || data;

                    if (!Array.isArray(candles) || candles.length === 0) {
                        throw new InsufficientDataError(`No candle data returned for ${symbol}`);
                    }

                    return candles.map((c: any) => ({
                        timestamp: c.timestamp || c.open_time || c.t,
                        open: parseFloat(c.open || c.o),
                        high: parseFloat(c.high || c.h),
                        low: parseFloat(c.low || c.l),
                        close: parseFloat(c.close || c.c),
                        volume: parseFloat(c.volume || c.v)
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
                        fetch(`${this.apiUrl}/full/v1/funding_rate`, {
                            method: 'POST',
                            headers: this.getAuthHeaders(),
                            body: JSON.stringify({
                                instrument: `${symbol}_USDT_PERP`
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Funding rate request timeout'
                    );

                    if (!response.ok) {
                        this.logger.warn(`No funding rate for ${symbol}, returning 0`);
                        return 0;
                    }

                    const data = await response.json();
                    return parseFloat(data.result?.funding_rate || data.funding_rate || '0');
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
                        fetch(`${this.apiUrl}/full/v1/ticker`, {
                            method: 'POST',
                            headers: this.getAuthHeaders(),
                            body: JSON.stringify({
                                instrument: `${symbol}_USDT_PERP`
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Mark price request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch mark price: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    return parseFloat(data.result?.mark_price || data.mark_price || data.last_price);
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
        leverage: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade(side, 0, `Opening ${side} position, size: ${size}, leverage: ${leverage}x`);

        // TODO: Implement with GRVT order API with proper signing
        // GRVT requires ZKSync signing for order execution
        const orderId = `grvt_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade('CLOSE', 0, `Closing ${position.side} position`);

        const orderId = `grvt_close_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        this.logger.info(`Setting SL @ ${stopPrice}`);
        // TODO: Implement with GRVT conditional orders
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        this.logger.info(`Setting TP @ ${tpPrice}`);
        // TODO: Implement with GRVT conditional orders
    }

    async getBalance(): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/full/v1/account`, {
                            method: 'POST',
                            headers: this.getAuthHeaders(),
                            body: JSON.stringify({
                                sub_account_id: this.subAccountId
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Balance request timeout'
                    );

                    if (!response.ok) {
                        this.logger.warn('Could not fetch balance, using default');
                        return 10000;
                    }

                    const data = await response.json();
                    return parseFloat(data.result?.equity || data.equity || '10000');
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
                        fetch(`${this.apiUrl}/full/v1/positions`, {
                            method: 'POST',
                            headers: this.getAuthHeaders(),
                            body: JSON.stringify({
                                sub_account_id: this.subAccountId,
                                kind: ['PERPETUAL'],
                                base: [symbol]
                            })
                        }),
                        this.REQUEST_TIMEOUT,
                        'Position request timeout'
                    );

                    if (!response.ok) {
                        return null;
                    }

                    const data = await response.json();
                    const positions = data.result || data.positions || [];
                    const pos = positions.find((p: any) =>
                        p.instrument?.includes(symbol) || p.symbol?.includes(symbol)
                    );

                    if (!pos || parseFloat(pos.size || pos.quantity || '0') === 0) {
                        return null;
                    }

                    const size = parseFloat(pos.size || pos.quantity);
                    return {
                        side: size > 0 ? 'LONG' : 'SHORT',
                        entryPrice: parseFloat(pos.entry_price || pos.avgPrice),
                        size: Math.abs(size),
                        stopLoss: 0,
                        takeProfit: 0,
                        entryTime: Date.now(),
                        unrealizedPnl: parseFloat(pos.unrealized_pnl || pos.pnl || '0')
                    };
                }, 'getPosition');
            },
            { maxRetries: 4 },
            this.logger,
            'getPosition'
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PACIFICA CONNECTOR
// High-performance Solana perp DEX
// API: https://docs.pacifica.fi/api-documentation/api
// ═══════════════════════════════════════════════════════════════════════════
export class PacificaConnector extends BaseExchange {
    readonly name: ExchangeType = 'PACIFICA';
    private apiUrl: string;
    private apiKey: string;

    constructor(config: ExchangeConfig) {
        super(config, 'Pacifica');
        const isTestnet = config.testnet !== false;
        this.apiUrl = config.pacificaApiUrl ||
            (isTestnet ? 'https://testnet-api.pacifica.fi' : 'https://api.pacifica.fi');
        this.apiKey = config.pacificaApiKey || '';
    }

    private getAuthHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }
        return headers;
    }

    async connect(): Promise<void> {
        this.logger.info(`Connecting to Pacifica (${this.apiUrl})`);
        const balance = await this.getBalance();
        this.logger.info(`Connected. Balance: $${balance.toFixed(2)}`);
    }

    async disconnect(): Promise<void> {
        this.logger.info('Disconnected from Pacifica');
    }

    async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/v1/market/klines?symbol=${symbol}-PERP&interval=${timeframe}&limit=${limit}`, {
                            headers: this.getAuthHeaders()
                        }),
                        this.REQUEST_TIMEOUT,
                        `Candles request timeout for ${symbol}`
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch candles: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    const candles = data.data || data.result || data;

                    if (!Array.isArray(candles) || candles.length === 0) {
                        throw new InsufficientDataError(`No candle data returned for ${symbol}`);
                    }

                    return candles.map((c: any) => ({
                        timestamp: c.timestamp || c.openTime || c.t,
                        open: parseFloat(c.open || c.o),
                        high: parseFloat(c.high || c.h),
                        low: parseFloat(c.low || c.l),
                        close: parseFloat(c.close || c.c),
                        volume: parseFloat(c.volume || c.v)
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
                        fetch(`${this.apiUrl}/v1/market/funding?symbol=${symbol}-PERP`, {
                            headers: this.getAuthHeaders()
                        }),
                        this.REQUEST_TIMEOUT,
                        'Funding rate request timeout'
                    );

                    if (!response.ok) {
                        this.logger.warn(`No funding rate for ${symbol}, returning 0`);
                        return 0;
                    }

                    const data = await response.json();
                    return parseFloat(data.data?.fundingRate || data.fundingRate || '0');
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
                        fetch(`${this.apiUrl}/v1/market/ticker?symbol=${symbol}-PERP`, {
                            headers: this.getAuthHeaders()
                        }),
                        this.REQUEST_TIMEOUT,
                        'Mark price request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch mark price: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    return parseFloat(data.data?.markPrice || data.markPrice || data.lastPrice);
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
        leverage: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade(side, 0, `Opening ${side} position, size: ${size}, leverage: ${leverage}x`);

        // TODO: Implement with Pacifica order API
        // Pacifica uses Solana wallet signing
        const orderId = `pacifica_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade('CLOSE', 0, `Closing ${position.side} position`);

        const orderId = `pacifica_close_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        this.logger.info(`Setting SL @ ${stopPrice}`);
        // TODO: Implement with Pacifica conditional orders
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        this.logger.info(`Setting TP @ ${tpPrice}`);
        // TODO: Implement with Pacifica conditional orders
    }

    async getBalance(): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/v1/account/balance`, {
                            headers: this.getAuthHeaders()
                        }),
                        this.REQUEST_TIMEOUT,
                        'Balance request timeout'
                    );

                    if (!response.ok) {
                        this.logger.warn('Could not fetch balance, using default');
                        return 10000;
                    }

                    const data = await response.json();
                    return parseFloat(data.data?.equity || data.equity || data.balance || '10000');
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
                        fetch(`${this.apiUrl}/v1/account/positions`, {
                            headers: this.getAuthHeaders()
                        }),
                        this.REQUEST_TIMEOUT,
                        'Position request timeout'
                    );

                    if (!response.ok) {
                        return null;
                    }

                    const data = await response.json();
                    const positions = data.data || data.positions || [];
                    const pos = positions.find((p: any) =>
                        p.symbol?.includes(symbol) || p.market?.includes(symbol)
                    );

                    if (!pos || parseFloat(pos.size || pos.quantity || '0') === 0) {
                        return null;
                    }

                    const size = parseFloat(pos.size || pos.quantity);
                    return {
                        side: pos.side === 'long' || size > 0 ? 'LONG' : 'SHORT',
                        entryPrice: parseFloat(pos.entryPrice || pos.avgPrice),
                        size: Math.abs(size),
                        stopLoss: 0,
                        takeProfit: 0,
                        entryTime: Date.now(),
                        unrealizedPnl: parseFloat(pos.unrealizedPnl || pos.pnl || '0')
                    };
                }, 'getPosition');
            },
            { maxRetries: 4 },
            this.logger,
            'getPosition'
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// STANDX CONNECTOR
// Solana/BNB perp DEX with DUSD yield
// Note: API documentation not publicly available yet
// ═══════════════════════════════════════════════════════════════════════════
export class StandXConnector extends BaseExchange {
    readonly name: ExchangeType = 'STANDX';
    private apiUrl: string;
    private chain: 'solana' | 'bnb';

    constructor(config: ExchangeConfig) {
        super(config, 'StandX');
        this.chain = config.standxChain || 'solana';
        const isTestnet = config.testnet !== false;

        // StandX API endpoints (to be confirmed when docs are available)
        this.apiUrl = config.standxApiUrl ||
            (isTestnet ? 'https://testnet-api.standx.io' : 'https://api.standx.io');
    }

    async connect(): Promise<void> {
        this.logger.info(`Connecting to StandX on ${this.chain} (${this.apiUrl})`);
        this.logger.warn('StandX API integration pending - using mock mode');
        const balance = await this.getBalance();
        this.logger.info(`Connected. Balance: $${balance.toFixed(2)}`);
    }

    async disconnect(): Promise<void> {
        this.logger.info('Disconnected from StandX');
    }

    async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    // TODO: Implement when StandX API docs are available
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/api/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`),
                        this.REQUEST_TIMEOUT,
                        `Candles request timeout for ${symbol}`
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch candles: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    const candles = data.data || data.result || data;

                    if (!Array.isArray(candles) || candles.length === 0) {
                        throw new InsufficientDataError(`No candle data returned for ${symbol}`);
                    }

                    return candles.map((c: any) => ({
                        timestamp: c.timestamp || c.t,
                        open: parseFloat(c.open || c.o),
                        high: parseFloat(c.high || c.h),
                        low: parseFloat(c.low || c.l),
                        close: parseFloat(c.close || c.c),
                        volume: parseFloat(c.volume || c.v)
                    }));
                }, 'getCandles');
            },
            { maxRetries: 4 },
            this.logger,
            'getCandles'
        );
    }

    async getFundingRate(symbol: string): Promise<number> {
        this.logger.debug(`Getting funding rate for ${symbol}`);
        // StandX uses DUSD which has built-in yield
        return 0;
    }

    async getMarkPrice(symbol: string): Promise<number> {
        return await retryWithBackoff(
            async () => {
                await this.rateLimiter.acquire();
                return await this.circuitBreaker.execute(async () => {
                    const response = await withTimeout(
                        fetch(`${this.apiUrl}/api/v1/ticker?symbol=${symbol}`),
                        this.REQUEST_TIMEOUT,
                        'Mark price request timeout'
                    );

                    if (!response.ok) {
                        throw new NetworkError(`Failed to fetch mark price: ${response.statusText}`, response.status);
                    }

                    const data = await response.json();
                    return parseFloat(data.data?.markPrice || data.markPrice || data.price);
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
        leverage: number
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade(side, 0, `Opening ${side} position, size: ${size}, leverage: ${leverage}x`);

        // TODO: Implement when StandX API is available
        // StandX uses Solana or BNB wallet signing depending on chain
        const orderId = `standx_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async closePosition(
        symbol: string,
        position: Position
    ): Promise<{ orderId: string; avgPrice: number }> {
        this.logger.trade('CLOSE', 0, `Closing ${position.side} position`);

        const orderId = `standx_close_${Date.now()}`;
        const markPrice = await this.getMarkPrice(symbol);

        return { orderId, avgPrice: markPrice };
    }

    async setStopLoss(_symbol: string, stopPrice: number): Promise<void> {
        this.logger.info(`Setting SL @ ${stopPrice}`);
    }

    async setTakeProfit(_symbol: string, tpPrice: number): Promise<void> {
        this.logger.info(`Setting TP @ ${tpPrice}`);
    }

    async getBalance(): Promise<number> {
        // Return default balance until API is available
        return 10000;
    }

    async getPosition(_symbol: string): Promise<Position | null> {
        // Return null until API is available
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE FACTORY
// Creates the appropriate exchange connector based on config
// ═══════════════════════════════════════════════════════════════════════════
export function createExchange(config: ExchangeConfig): IExchange {
    switch (config.exchange) {
        case 'NADO':
            return new NadoConnector(config);
        case 'GRVT':
            return new GRVTConnector(config);
        case 'PACIFICA':
            return new PacificaConnector(config);
        case 'STANDX':
            return new StandXConnector(config);
        default:
            throw new Error(`Unknown exchange type: ${config.exchange}`);
    }
}

// Re-export for convenience
export { IExchange as ExchangeInterface };
