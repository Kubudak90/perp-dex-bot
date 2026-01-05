// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED CONNECTOR
// Starknet-based perpetual DEX connector for Extended.exchange
// ═══════════════════════════════════════════════════════════════════════════

import { Account, Provider, Contract, RpcProvider, constants } from 'starknet';
import axios, { AxiosInstance } from 'axios';
import {
    IExchange,
    ExchangeConfig,
    OrderParams,
    Balance,
    ExchangeStats,
} from '../interface';
import { Candle, MarketData, Position, OrderResult } from '../../types';
import {
    ExtendedOrder,
    ExtendedPosition,
    ExtendedPoints,
    ExtendedResponse,
    EXTENDED_ENDPOINTS,
    EXTENDED_CONTRACTS,
} from './types';
import { EXTENDED_CONFIG, EXTENDED_FEES } from './config';

/**
 * Extended Exchange Connector
 * Implements IExchange interface for Extended perpetual DEX
 */
export class ExtendedConnector implements IExchange {
    private provider: RpcProvider;
    private account: Account | null = null;
    private apiClient: AxiosInstance;
    private wsConnection: WebSocket | null = null;
    private connected: boolean = false;
    private config: ExchangeConfig;

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

    constructor(config: ExchangeConfig) {
        this.config = config;

        // Initialize Starknet provider
        const chainId = config.testnet
            ? constants.StarknetChainId.SN_SEPOLIA
            : constants.StarknetChainId.SN_MAIN;

        this.provider = new RpcProvider({
            nodeUrl: config.apiUrl,
        });

        // Initialize HTTP client
        const baseURL = config.testnet
            ? EXTENDED_ENDPOINTS.TESTNET
            : EXTENDED_ENDPOINTS.MAINNET;

        this.apiClient = axios.create({
            baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    /**
     * Connect to Extended exchange
     */
    async connect(): Promise<void> {
        try {
            if (!this.config.privateKey) {
                throw new Error('Private key is required for Extended connector');
            }

            // Create Starknet account
            const contractAddress = this.config.testnet
                ? EXTENDED_CONTRACTS.TESTNET.CLEARINGHOUSE
                : EXTENDED_CONTRACTS.MAINNET.CLEARINGHOUSE;

            // Note: In production, derive address from private key
            // For now, using placeholder
            const accountAddress = '0x...'; // TODO: Derive from private key

            this.account = new Account(
                this.provider,
                accountAddress,
                this.config.privateKey
            );

            // Test connection
            const balance = await this.getBalance();
            console.log(`✅ Connected to Extended (${this.config.testnet ? 'Testnet' : 'Mainnet'})`);
            console.log(`💰 Balance: $${balance.available.toFixed(2)}`);

            // Connect WebSocket
            await this.connectWebSocket();

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
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
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

    /**
     * Get historical candle data
     */
    async getCandles(
        symbol: string,
        timeframe: string,
        limit: number = 500
    ): Promise<Candle[]> {
        try {
            const response = await this.apiClient.get<ExtendedResponse<any>>('/v1/candles', {
                params: {
                    symbol: this.normalizeSymbol(symbol),
                    interval: this.normalizeTimeframe(timeframe),
                    limit,
                },
            });

            if (!response.data.success || !response.data.data) {
                throw new Error(response.data.error?.message || 'Failed to fetch candles');
            }

            return response.data.data.map((c: any) => ({
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
            const response = await this.apiClient.get<ExtendedResponse<any>>(
                `/v1/markets/${this.normalizeSymbol(symbol)}`
            );

            if (!response.data.success || !response.data.data) {
                throw new Error(response.data.error?.message || 'Failed to fetch market data');
            }

            const data = response.data.data;
            return {
                symbol,
                markPrice: parseFloat(data.markPrice),
                indexPrice: parseFloat(data.indexPrice),
                fundingRate: parseFloat(data.fundingRate),
                openInterest: parseFloat(data.openInterest),
                volume24h: parseFloat(data.volume24h),
            };
        } catch (error) {
            console.error('❌ Failed to fetch market data:', error);
            throw error;
        }
    }

    /**
     * Get account balance
     */
    async getBalance(): Promise<Balance> {
        try {
            if (!this.account) {
                throw new Error('Not connected');
            }

            const response = await this.apiClient.get<ExtendedResponse<any>>(
                `/v1/account/${this.account.address}`
            );

            if (!response.data.success || !response.data.data) {
                throw new Error(response.data.error?.message || 'Failed to fetch balance');
            }

            const data = response.data.data;
            return {
                total: parseFloat(data.balance),
                available: parseFloat(data.availableBalance),
                locked: parseFloat(data.marginUsed),
                unrealizedPnl: parseFloat(data.unrealizedPnl),
            };
        } catch (error) {
            console.error('❌ Failed to fetch balance:', error);
            throw error;
        }
    }

    /**
     * Get current positions
     */
    async getPositions(): Promise<Position[]> {
        try {
            if (!this.account) {
                throw new Error('Not connected');
            }

            const response = await this.apiClient.get<ExtendedResponse<ExtendedPosition[]>>(
                `/v1/positions/${this.account.address}`
            );

            if (!response.data.success || !response.data.data) {
                throw new Error(response.data.error?.message || 'Failed to fetch positions');
            }

            return response.data.data.map((p) => ({
                side: p.side,
                entryPrice: p.entryPrice,
                size: p.size,
                stopLoss: 0, // TODO: Fetch from orders
                takeProfit: 0, // TODO: Fetch from orders
                entryTime: Date.now(), // TODO: Get actual entry time
                unrealizedPnl: p.unrealizedPnl,
            }));
        } catch (error) {
            console.error('❌ Failed to fetch positions:', error);
            throw error;
        }
    }

    /**
     * Open a new position
     */
    async openPosition(params: OrderParams): Promise<OrderResult> {
        try {
            if (!this.account) {
                throw new Error('Not connected');
            }

            console.log(`📈 Opening ${params.side} position: ${params.symbol} @ ${params.size}`);

            // Prepare order data
            const orderData = {
                symbol: this.normalizeSymbol(params.symbol),
                side: params.side === 'LONG' ? 'BUY' : 'SELL',
                type: params.price ? 'LIMIT' : 'MARKET',
                size: params.size,
                price: params.price,
                timeInForce: params.timeInForce || 'GTC',
            };

            // Sign and submit order
            const response = await this.apiClient.post<ExtendedResponse<ExtendedOrder>>(
                '/v1/orders',
                orderData,
                {
                    headers: {
                        'X-Account-Address': this.account.address,
                        // TODO: Add signature header
                    },
                }
            );

            if (!response.data.success || !response.data.data) {
                throw new Error(response.data.error?.message || 'Failed to open position');
            }

            const order = response.data.data;

            // Update stats
            this.updateStats(order);

            // Place stop loss order if specified
            if (params.stopLoss) {
                await this.placeStopOrder(params.symbol, params.stopLoss, params.size, true);
            }

            // Place take profit order if specified
            if (params.takeProfit) {
                await this.placeStopOrder(params.symbol, params.takeProfit, params.size, false);
            }

            console.log(`✅ Position opened: ${order.orderId} @ $${order.avgPrice}`);

            return {
                orderId: order.orderId,
                avgPrice: order.avgPrice,
                filledSize: order.filledSize,
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
            if (!this.account) {
                throw new Error('Not connected');
            }

            console.log(`📉 Closing position: ${symbol}`);

            // Get current position to determine side
            const positions = await this.getPositions();
            const position = positions.find((p) => p.side !== undefined);

            if (!position) {
                throw new Error('No position found to close');
            }

            // Close with opposite side
            const closeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
            const closeSize = size || position.size;

            const result = await this.openPosition({
                symbol,
                side: closeSide,
                size: closeSize,
                reduceOnly: true,
            });

            console.log(`✅ Position closed: ${result.orderId}`);

            return result;
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
        try {
            // Cancel existing SL/TP orders
            // TODO: Implement order cancellation

            // Place new SL/TP orders
            const positions = await this.getPositions();
            const position = positions.find((p) => p.side !== undefined);

            if (!position) {
                throw new Error('No position found');
            }

            if (stopLoss) {
                await this.placeStopOrder(symbol, stopLoss, position.size, true);
            }

            if (takeProfit) {
                await this.placeStopOrder(symbol, takeProfit, position.size, false);
            }

            console.log(`✅ Position updated: SL=${stopLoss}, TP=${takeProfit}`);
        } catch (error) {
            console.error('❌ Failed to update position:', error);
            throw error;
        }
    }

    /**
     * Get trading statistics
     */
    async getStats(): Promise<ExchangeStats> {
        try {
            // Fetch points data
            const points = await this.getPoints();

            return {
                totalTrades: this.stats.totalTrades,
                totalVolume: this.stats.totalVolume,
                points: points.totalPoints,
                makerTrades: this.stats.makerTrades,
                takerTrades: this.stats.takerTrades,
                fees: this.stats.fees,
            };
        } catch (error) {
            console.error('❌ Failed to fetch stats:', error);
            return {
                ...this.stats,
                points: 0,
            };
        }
    }

    /**
     * Subscribe to real-time price updates
     */
    async subscribeToPrice(symbol: string, callback: (price: number) => void): Promise<void> {
        this.priceCallbacks.set(symbol, callback);

        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
            this.wsConnection.send(
                JSON.stringify({
                    action: 'subscribe',
                    channel: 'price',
                    symbol: this.normalizeSymbol(symbol),
                })
            );
        }
    }

    /**
     * Unsubscribe from price updates
     */
    async unsubscribeFromPrice(symbol: string): Promise<void> {
        this.priceCallbacks.delete(symbol);

        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
            this.wsConnection.send(
                JSON.stringify({
                    action: 'unsubscribe',
                    channel: 'price',
                    symbol: this.normalizeSymbol(symbol),
                })
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Connect to WebSocket
     */
    private async connectWebSocket(): Promise<void> {
        const wsUrl = this.config.testnet
            ? EXTENDED_ENDPOINTS.WS_TESTNET
            : EXTENDED_ENDPOINTS.WS_MAINNET;

        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onopen = () => {
            console.log('🔌 WebSocket connected');
        };

        this.wsConnection.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            } catch (error) {
                console.error('❌ Failed to parse WebSocket message:', error);
            }
        };

        this.wsConnection.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
        };

        this.wsConnection.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            // Attempt reconnection after 5 seconds
            setTimeout(() => this.connectWebSocket(), 5000);
        };
    }

    /**
     * Handle WebSocket messages
     */
    private handleWebSocketMessage(message: any): void {
        if (message.type === 'price' && message.symbol) {
            const callback = this.priceCallbacks.get(message.symbol);
            if (callback && message.data?.price) {
                callback(parseFloat(message.data.price));
            }
        }
    }

    /**
     * Place stop order (SL or TP)
     */
    private async placeStopOrder(
        symbol: string,
        price: number,
        size: number,
        isStopLoss: boolean
    ): Promise<void> {
        // TODO: Implement stop order placement
        // Extended might use a different mechanism for SL/TP
        console.log(`📋 Placing ${isStopLoss ? 'SL' : 'TP'} order: ${symbol} @ $${price}`);
    }

    /**
     * Update trading statistics
     */
    private updateStats(order: ExtendedOrder): void {
        this.stats.totalTrades++;
        this.stats.totalVolume += order.size * order.avgPrice;

        const isMaker = order.type === 'LIMIT';
        if (isMaker) {
            this.stats.makerTrades++;
            this.stats.fees.maker += order.size * order.avgPrice * EXTENDED_FEES.maker;
        } else {
            this.stats.takerTrades++;
            this.stats.fees.taker += order.size * order.avgPrice * EXTENDED_FEES.taker;
        }

        this.stats.fees.total = this.stats.fees.maker + this.stats.fees.taker;
    }

    /**
     * Get Extended points/rewards
     */
    private async getPoints(): Promise<ExtendedPoints> {
        try {
            if (!this.account) {
                throw new Error('Not connected');
            }

            const response = await this.apiClient.get<ExtendedResponse<ExtendedPoints>>(
                `/v1/points/${this.account.address}`
            );

            if (!response.data.success || !response.data.data) {
                throw new Error('Failed to fetch points');
            }

            return response.data.data;
        } catch (error) {
            console.error('❌ Failed to fetch points:', error);
            return {
                totalPoints: 0,
                tradingPoints: 0,
                liquidityPoints: 0,
                referralPoints: 0,
                season: 1,
            };
        }
    }

    /**
     * Normalize symbol format (BTC-USD -> BTCUSD)
     */
    private normalizeSymbol(symbol: string): string {
        return symbol.replace('-', '');
    }

    /**
     * Normalize timeframe format (15m -> 15)
     */
    private normalizeTimeframe(timeframe: string): string {
        return timeframe.replace('m', '').replace('h', '');
    }
}
