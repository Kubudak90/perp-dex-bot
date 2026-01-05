// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED REST CLIENT
// HTTP client for Extended Exchange API
// ═══════════════════════════════════════════════════════════════════════════

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { RateLimiter } from './rate-limiter';
import {
    ExtendedConfig,
    ApiResponse,
    PaginatedResponse,
    Market,
    MarketStats,
    OrderBook,
    Trade,
    Candle,
    FundingRate,
    AccountInfo,
    Balance,
    Position,
    Order,
    OrderResponse,
    CreateOrderRequest,
    UserTrade,
    LeverageInfo,
    FeeInfo,
    MassCancelParams,
    OrderHistoryParams,
    TradeHistoryParams,
} from './types';

/**
 * Extended REST API Client
 */
export class ExtendedRestClient {
    private client: AxiosInstance;
    private rateLimiter: RateLimiter;
    private apiKey: string;

    constructor(config: ExtendedConfig, apiKey: string) {
        this.apiKey = apiKey;
        this.rateLimiter = new RateLimiter();

        // Create axios instance
        this.client = axios.create({
            baseURL: config.apiBaseUrl,
            timeout: 30000,
            headers: {
                'X-Api-Key': apiKey,
                'User-Agent': 'ExtendedBot/1.0',
                'Content-Type': 'application/json',
            },
        });

        // Add request interceptor for rate limiting
        this.client.interceptors.request.use(
            async (config) => {
                await this.rateLimiter.throttle();
                return config;
            },
            (error) => Promise.reject(error)
        );

        // Add response interceptor for error handling
        this.client.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response) {
                    const { status, data } = error.response;
                    console.error(`❌ API Error [${status}]:`, data);
                }
                return Promise.reject(error);
            }
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC ENDPOINTS (No API key required)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get all markets or specific markets
     */
    async getMarkets(markets?: string[]): Promise<Market[]> {
        const params = markets ? { market: markets } : {};
        const response = await this.client.get<ApiResponse<Market[]>>('/info/markets', {
            params,
        });
        return response.data.data || [];
    }

    /**
     * Get market statistics
     */
    async getMarketStats(market: string): Promise<MarketStats> {
        const response = await this.client.get<ApiResponse<MarketStats>>(
            `/info/markets/${market}/stats`
        );
        if (!response.data.data) {
            throw new Error('Market stats not found');
        }
        return response.data.data;
    }

    /**
     * Get order book for a market
     */
    async getOrderBook(market: string): Promise<OrderBook> {
        const response = await this.client.get<ApiResponse<OrderBook>>(
            `/info/markets/${market}/orderbook`
        );
        if (!response.data.data) {
            throw new Error('Order book not found');
        }
        return response.data.data;
    }

    /**
     * Get last trades for a market
     */
    async getLastTrades(market: string, limit: number = 100): Promise<Trade[]> {
        const response = await this.client.get<ApiResponse<Trade[]>>(
            `/info/markets/${market}/trades`,
            {
                params: { limit },
            }
        );
        return response.data.data || [];
    }

    /**
     * Get candles (OHLCV data)
     */
    async getCandles(
        market: string,
        candleType: 'trades' | 'mark-prices' | 'index-prices',
        interval: string,
        limit: number,
        endTime?: number
    ): Promise<Candle[]> {
        const response = await this.client.get<ApiResponse<Candle[]>>(
            `/info/candles/${market}/${candleType}`,
            {
                params: { interval, limit, endTime },
            }
        );
        return response.data.data || [];
    }

    /**
     * Get funding rate history
     */
    async getFundingHistory(
        market: string,
        startTime: number,
        endTime: number
    ): Promise<FundingRate[]> {
        const response = await this.client.get<ApiResponse<FundingRate[]>>(
            `/info/${market}/funding`,
            {
                params: { startTime, endTime },
            }
        );
        return response.data.data || [];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE ENDPOINTS (API key required)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get account information
     */
    async getAccountInfo(): Promise<AccountInfo> {
        const response = await this.client.get<ApiResponse<AccountInfo>>(
            '/user/account/info'
        );
        if (!response.data.data) {
            throw new Error('Account info not found');
        }
        return response.data.data;
    }

    /**
     * Get account balance
     */
    async getBalance(): Promise<Balance> {
        const response = await this.client.get<ApiResponse<Balance>>('/user/balance');
        if (!response.data.data) {
            throw new Error('Balance not found');
        }
        return response.data.data;
    }

    /**
     * Get positions
     */
    async getPositions(market?: string, side?: 'LONG' | 'SHORT'): Promise<Position[]> {
        const response = await this.client.get<ApiResponse<Position[]>>('/user/positions', {
            params: { market, side },
        });
        return response.data.data || [];
    }

    /**
     * Get open orders
     */
    async getOpenOrders(
        market?: string,
        type?: 'LIMIT' | 'CONDITIONAL' | 'TPSL' | 'TWAP',
        side?: 'BUY' | 'SELL'
    ): Promise<Order[]> {
        const response = await this.client.get<ApiResponse<Order[]>>('/user/orders', {
            params: { market, type, side },
        });
        return response.data.data || [];
    }

    /**
     * Get order history
     */
    async getOrderHistory(
        params: OrderHistoryParams
    ): Promise<PaginatedResponse<Order>> {
        const response = await this.client.get<PaginatedResponse<Order>>(
            '/user/orders/history',
            { params }
        );
        return response.data;
    }

    /**
     * Get trade history
     */
    async getTradeHistory(
        params: TradeHistoryParams
    ): Promise<PaginatedResponse<UserTrade>> {
        const response = await this.client.get<PaginatedResponse<UserTrade>>(
            '/user/trades',
            { params }
        );
        return response.data;
    }

    /**
     * Get leverage settings
     */
    async getLeverage(market?: string): Promise<LeverageInfo[]> {
        const response = await this.client.get<ApiResponse<LeverageInfo[]>>(
            '/user/leverage',
            {
                params: { market },
            }
        );
        return response.data.data || [];
    }

    /**
     * Update leverage
     */
    async updateLeverage(market: string, leverage: string): Promise<LeverageInfo> {
        const response = await this.client.patch<ApiResponse<LeverageInfo>>(
            '/user/leverage',
            {
                market,
                leverage,
            }
        );
        if (!response.data.data) {
            throw new Error('Failed to update leverage');
        }
        return response.data.data;
    }

    /**
     * Get fee rates
     */
    async getFees(market?: string): Promise<FeeInfo[]> {
        const response = await this.client.get<ApiResponse<FeeInfo[]>>('/user/fees', {
            params: { market },
        });
        return response.data.data || [];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ORDER MANAGEMENT (Stark signature required)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Create/edit order
     * NOTE: This requires Stark signature - implement with Python SDK or starknet.js
     */
    async createOrder(order: CreateOrderRequest): Promise<OrderResponse> {
        const response = await this.client.post<ApiResponse<OrderResponse>>(
            '/user/order',
            order
        );
        if (!response.data.data) {
            throw new Error('Failed to create order');
        }
        return response.data.data;
    }

    /**
     * Cancel order by ID
     */
    async cancelOrderById(orderId: number): Promise<void> {
        await this.client.delete(`/user/order/${orderId}`);
    }

    /**
     * Cancel order by external ID
     */
    async cancelOrderByExternalId(externalId: string): Promise<void> {
        await this.client.delete('/user/order', {
            params: { externalId },
        });
    }

    /**
     * Mass cancel orders
     */
    async massCancel(params: MassCancelParams): Promise<void> {
        await this.client.post('/user/order/massCancel', params);
    }

    /**
     * Set Dead Man's Switch
     * Auto-cancels all orders if not refreshed within countdown
     */
    async setDeadMansSwitch(countdownSeconds: number): Promise<void> {
        await this.client.post('/user/deadmanswitch', null, {
            params: { countdownTime: countdownSeconds },
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITY METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get rate limiter stats
     */
    getRateLimitStats(): { count: number; remaining: number; limit: number } {
        return {
            count: this.rateLimiter.getCount(),
            remaining: this.rateLimiter.getRemaining(),
            limit: 1000,
        };
    }

    /**
     * Reset rate limiter
     */
    resetRateLimit(): void {
        this.rateLimiter.reset();
    }
}
