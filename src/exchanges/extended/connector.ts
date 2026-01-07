// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED CONNECTOR
// Main connector using REST and WebSocket clients
// ═══════════════════════════════════════════════════════════════════════════

import {
    IExchange,
    ExchangeConfig,
    OrderParams,
    Balance as IBalance,
    ExchangeStats,
} from '../interface';
import { Candle, MarketData, Position as IPosition, OrderResult } from '../../types';
import { ExtendedRestClient } from './rest-client';
import { ExtendedWebSocketClient } from './websocket-client';
import { PythonBridge } from './python-bridge';
import {
    EXTENDED_MAINNET_CONFIG,
    EXTENDED_TESTNET_CONFIG,
    ExtendedConfig,
    OrderSide,
    OrderType,
    TimeInForce,
    CreateOrderRequest,
    Balance,
    Position,
} from './types';
import { EXTENDED_CONFIG } from './config';

/**
 * Extended Exchange Connector
 * Self-custody perpetual DEX on Starknet
 */
export class ExtendedConnector implements IExchange {
    private rest: ExtendedRestClient;
    private ws: ExtendedWebSocketClient | null = null;
    private pythonBridge: PythonBridge | null = null;
    private config: ExtendedConfig;
    private apiKey: string;
    private connected = false;
    private usePythonSigning: boolean;

    // Price subscription callbacks
    private priceCallbacks: Map<string, (price: number) => void> = new Map();

    // Stats tracking
    private stats = {
        totalTrades: 0,
        totalVolume: 0,
        makerTrades: 0,
        takerTrades: 0,
        fees: {
            maker: 0,
            taker: 0,
            total: 0,
        },
    };

    constructor(exchangeConfig: ExchangeConfig) {
        // Select mainnet or testnet config
        this.config = exchangeConfig.testnet
            ? EXTENDED_TESTNET_CONFIG
            : EXTENDED_MAINNET_CONFIG;

        // API key from config or environment
        this.apiKey = exchangeConfig.apiKey || process.env.EXTENDED_API_KEY || '';

        if (!this.apiKey) {
            console.warn('⚠️  No API key provided - only public endpoints will work');
        }

        // Create REST client
        this.rest = new ExtendedRestClient(this.config, this.apiKey);

        // Check if we should use Python signing
        this.usePythonSigning = !!(
            process.env.STARKNET_PRIVATE_KEY &&
            process.env.EXTENDED_VAULT
        );

        // Create Python bridge if credentials available
        if (this.usePythonSigning) {
            this.pythonBridge = new PythonBridge(
                this.apiKey,
                process.env.STARKNET_PRIVATE_KEY!,
                process.env.EXTENDED_VAULT!,
                exchangeConfig.testnet || false
            );
            console.log('🐍 Python bridge enabled for order signing');
        } else {
            console.warn(
                '⚠️  Python signing disabled (STARKNET_PRIVATE_KEY or EXTENDED_VAULT not set)'
            );
        }

        console.log(
            `✅ Extended connector created (${exchangeConfig.testnet ? 'Testnet' : 'Mainnet'})`
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONNECTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Connect to Extended exchange
     */
    async connect(): Promise<void> {
        try {
            console.log('🔌 Connecting to Extended...');

            // Test REST connection if API key provided
            if (this.apiKey) {
                const accountInfo = await this.rest.getAccountInfo();
                console.log(`✅ Account connected: ${accountInfo.starkKey}`);

                // Initialize WebSocket
                this.ws = new ExtendedWebSocketClient(this.config, this.apiKey, {
                    onConnect: () => console.log('✅ WebSocket connected'),
                    onDisconnect: () => console.log('🔌 WebSocket disconnected'),
                    onError: (error) => console.error('❌ WebSocket error:', error),
                    onAccountUpdate: (update) => {
                        console.log(`📊 Account update: ${update.type}`);
                    },
                    onMarkPrice: (market, data) => {
                        const callback = this.priceCallbacks.get(market);
                        if (callback) {
                            callback(parseFloat(data.price));
                        }
                    },
                });

                // Connect WebSocket
                this.ws.connect();

                // Get initial balance
                const balance = await this.getBalance();
                console.log(`💰 Balance: $${balance.available.toFixed(2)}`);
            } else {
                console.log('ℹ️  Connected to Extended (public endpoints only)');
            }

            this.connected = true;
        } catch (error) {
            console.error('❌ Failed to connect to Extended:', error);
            throw error;
        }
    }

    /**
     * Disconnect from Extended
     */
    async disconnect(): Promise<void> {
        if (this.ws) {
            this.ws.disconnect();
            this.ws = null;
        }

        this.connected = false;
        console.log('🔌 Disconnected from Extended');
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MARKET DATA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get historical candles
     */
    async getCandles(
        symbol: string,
        timeframe: string,
        limit: number = 500
    ): Promise<Candle[]> {
        try {
            const market = this.normalizeSymbol(symbol);
            const interval = this.normalizeTimeframe(timeframe);

            const candles = await this.rest.getCandles(
                market,
                'trades',
                interval,
                limit
            );

            return candles.map((c) => ({
                timestamp: c.timestamp,
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                volume: parseFloat(c.volume),
            }));
        } catch (error) {
            console.error('❌ Failed to fetch candles:', error);
            throw error;
        }
    }

    /**
     * Get current market data
     */
    async getMarketData(symbol: string): Promise<MarketData> {
        try {
            const market = this.normalizeSymbol(symbol);
            const stats = await this.rest.getMarketStats(market);

            return {
                symbol,
                markPrice: parseFloat(stats.close),
                indexPrice: parseFloat(stats.close), // TODO: Get actual index price
                fundingRate: parseFloat(stats.fundingRate),
                openInterest: parseFloat(stats.openInterest),
                volume24h: parseFloat(stats.volumeQuote),
            };
        } catch (error) {
            console.error('❌ Failed to fetch market data:', error);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACCOUNT & POSITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get account balance
     */
    async getBalance(): Promise<IBalance> {
        try {
            const balance: Balance = await this.rest.getBalance();

            return {
                total: parseFloat(balance.equity),
                available: parseFloat(balance.availableForTrade),
                locked: parseFloat(balance.totalPositionValue),
                unrealizedPnl: parseFloat(balance.unrealizedPnl),
            };
        } catch (error) {
            console.error('❌ Failed to fetch balance:', error);
            throw error;
        }
    }

    /**
     * Get current positions
     */
    async getPositions(): Promise<IPosition[]> {
        try {
            const positions: Position[] = await this.rest.getPositions();

            return positions.map((p) => ({
                side: p.side,
                entryPrice: parseFloat(p.entryPrice),
                size: parseFloat(p.size),
                stopLoss: 0, // TODO: Get from conditional orders
                takeProfit: 0, // TODO: Get from conditional orders
                entryTime: Date.now(), // TODO: Get actual entry time
                unrealizedPnl: parseFloat(p.unrealizedPnl),
            }));
        } catch (error) {
            console.error('❌ Failed to fetch positions:', error);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ORDER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Open a new position
     * Uses Python SDK for order signing if configured
     */
    async openPosition(params: OrderParams): Promise<OrderResult> {
        try {
            console.log(`📈 Opening ${params.side} position: ${params.symbol}`);

            const market = this.normalizeSymbol(params.symbol);
            const side = params.side === 'LONG' ? OrderSide.BUY : OrderSide.SELL;

            // Market order = IOC limit at best price + 0.75% margin
            let price: string | undefined;
            if (!params.price) {
                const orderbook = await this.rest.getOrderBook(market);
                const bestPrice =
                    side === OrderSide.BUY
                        ? parseFloat(orderbook.asks[0]?.price || '0')
                        : parseFloat(orderbook.bids[0]?.price || '0');
                price = (bestPrice * (side === OrderSide.BUY ? 1.0075 : 0.9925)).toFixed(2);
            } else {
                price = params.price.toString();
            }

            const orderRequest: CreateOrderRequest = {
                market,
                side,
                type: OrderType.LIMIT,
                size: params.size.toString(),
                price,
                timeInForce: params.price ? TimeInForce.GTT : TimeInForce.IOC,
                expiryEpochMillis: params.price
                    ? Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days for limit
                    : Date.now() + 60 * 1000, // 1 min for market
                reduceOnly: params.reduceOnly || false,
                postOnly: params.price ? true : false, // Maker orders for limits
                selfTradeProtection: 'ACCOUNT',
            };

            // Add TP/SL if specified
            if (params.takeProfit || params.stopLoss) {
                orderRequest.tpslType = 'ORDER';

                if (params.takeProfit) {
                    orderRequest.takeProfit = {
                        triggerPrice: params.takeProfit.toString(),
                        triggerPriceType: 'LAST',
                        priceType: 'LIMIT',
                    };
                }

                if (params.stopLoss) {
                    orderRequest.stopLoss = {
                        triggerPrice: params.stopLoss.toString(),
                        triggerPriceType: 'LAST',
                        priceType: 'LIMIT',
                    };
                }
            }

            // Use Python bridge for signing if available
            let response;
            if (this.pythonBridge) {
                console.log('🐍 Using Python SDK for order signing...');
                response = await this.pythonBridge.placeOrder(orderRequest);
            } else {
                // Fallback to REST (will fail without signature)
                console.warn('⚠️  No Python bridge - order will likely fail without signature');
                response = await this.rest.createOrder(orderRequest);
            }

            // Update stats
            this.updateStats(response.order, parseFloat(price));

            console.log(`✅ Order placed: ${response.order.id}`);

            return {
                orderId: response.order.id.toString(),
                avgPrice: parseFloat(response.order.avgFillPrice || price),
                filledSize: parseFloat(response.order.filledSize),
                status: 'filled',
            };
        } catch (error) {
            console.error('❌ Failed to open position:', error);
            throw error;
        }
    }

    /**
     * Close an existing position
     */
    async closePosition(symbol: string, size?: number): Promise<OrderResult> {
        try {
            console.log(`📉 Closing position: ${symbol}`);

            const positions = await this.getPositions();
            const position = positions.find((p) => p.side !== undefined);

            if (!position) {
                throw new Error('No position found to close');
            }

            // Close with opposite side
            const closeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
            const closeSize = size || position.size;

            return await this.openPosition({
                symbol,
                side: closeSide,
                size: closeSize,
                reduceOnly: true,
            });
        } catch (error) {
            console.error('❌ Failed to close position:', error);
            throw error;
        }
    }

    /**
     * Update stop loss and take profit
     */
    async updatePosition(
        symbol: string,
        stopLoss?: number,
        takeProfit?: number
    ): Promise<void> {
        console.warn('⚠️  updatePosition not fully implemented for Extended');
        // TODO: Cancel existing TPSL orders and create new ones
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATISTICS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get trading statistics
     */
    async getStats(): Promise<ExchangeStats> {
        return {
            totalTrades: this.stats.totalTrades,
            totalVolume: this.stats.totalVolume,
            makerTrades: this.stats.makerTrades,
            takerTrades: this.stats.takerTrades,
            fees: this.stats.fees,
            points: 0, // TODO: Fetch from Extended API when available
        };
    }

    /**
     * Update internal stats
     */
    private updateStats(order: any, price: number): void {
        this.stats.totalTrades++;
        const volume = parseFloat(order.size) * price;
        this.stats.totalVolume += volume;

        const isMaker = order.postOnly || order.timeInForce === 'GTT';
        if (isMaker) {
            this.stats.makerTrades++;
            this.stats.fees.maker += volume * EXTENDED_CONFIG.fees.maker;
        } else {
            this.stats.takerTrades++;
            this.stats.fees.taker += volume * EXTENDED_CONFIG.fees.taker;
        }

        this.stats.fees.total = this.stats.fees.maker + this.stats.fees.taker;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // REAL-TIME PRICE UPDATES
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Subscribe to price updates
     */
    async subscribeToPrice(symbol: string, callback: (price: number) => void): Promise<void> {
        const market = this.normalizeSymbol(symbol);
        this.priceCallbacks.set(market, callback);

        if (this.ws?.isConnected()) {
            this.ws.subscribeMarkPrice(market);
        }
    }

    /**
     * Unsubscribe from price updates
     */
    async unsubscribeFromPrice(symbol: string): Promise<void> {
        const market = this.normalizeSymbol(symbol);
        this.priceCallbacks.delete(market);
        // TODO: Unsubscribe from WebSocket
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITY METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Normalize symbol (BTC-USD -> BTCUSD or BTC-USD depending on API)
     */
    private normalizeSymbol(symbol: string): string {
        // Extended uses BTC-USD format
        return symbol;
    }

    /**
     * Normalize timeframe (15m -> 15)
     */
    private normalizeTimeframe(timeframe: string): string {
        // Extended accepts: 1, 5, 15, 30, 60, 120, 240, 360, 720, D, W
        const map: Record<string, string> = {
            '1m': '1',
            '5m': '5',
            '15m': '15',
            '30m': '30',
            '1h': '60',
            '2h': '120',
            '4h': '240',
            '6h': '360',
            '12h': '720',
            '1d': 'D',
            '1w': 'W',
        };

        return map[timeframe] || timeframe;
    }

    /**
     * Get REST client (for advanced usage)
     */
    getRestClient(): ExtendedRestClient {
        return this.rest;
    }

    /**
     * Get WebSocket client (for advanced usage)
     */
    getWebSocketClient(): ExtendedWebSocketClient | null {
        return this.ws;
    }
}
