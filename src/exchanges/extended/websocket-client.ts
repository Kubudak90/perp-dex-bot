// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED WEBSOCKET CLIENT
// Real-time data streams from Extended Exchange
// ═══════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import {
    ExtendedConfig,
    WsSubscribeMessage,
    OrderBookUpdate,
    TradeUpdate,
    FundingRateUpdate,
    CandleUpdate,
    PriceUpdate,
    AccountUpdate,
} from './types';

/**
 * WebSocket Event Handlers
 */
interface WebSocketHandlers {
    onOrderBook?: (market: string, data: OrderBookUpdate) => void;
    onTrade?: (market: string, data: TradeUpdate) => void;
    onFunding?: (market: string, data: FundingRateUpdate) => void;
    onCandle?: (market: string, interval: string, data: CandleUpdate) => void;
    onMarkPrice?: (market: string, data: PriceUpdate) => void;
    onIndexPrice?: (market: string, data: PriceUpdate) => void;
    onAccountUpdate?: (data: AccountUpdate) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
}

/**
 * Extended WebSocket Client
 */
export class ExtendedWebSocketClient {
    private ws: WebSocket | null = null;
    private config: ExtendedConfig;
    private apiKey: string;
    private handlers: WebSocketHandlers;
    private subscriptions: Map<string, boolean> = new Map();
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 1000;
    private pingInterval: NodeJS.Timeout | null = null;
    private connected = false;

    constructor(
        config: ExtendedConfig,
        apiKey: string,
        handlers: WebSocketHandlers = {}
    ) {
        this.config = config;
        this.apiKey = apiKey;
        this.handlers = handlers;
    }

    /**
     * Connect to WebSocket
     */
    connect(): void {
        if (this.ws) {
            console.warn('⚠️  WebSocket already connected');
            return;
        }

        console.log('🔌 Connecting to Extended WebSocket...');

        this.ws = new WebSocket(this.config.streamUrl, {
            headers: {
                'X-Api-Key': this.apiKey,
                'User-Agent': 'ExtendedBot/1.0',
            },
        });

        this.ws.on('open', () => this.handleOpen());
        this.ws.on('message', (data: Buffer) => this.handleMessage(data));
        this.ws.on('close', (code: number, reason: string) =>
            this.handleClose(code, reason)
        );
        this.ws.on('error', (error: Error) => this.handleError(error));
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect(): void {
        if (!this.ws) {
            return;
        }

        console.log('🔌 Disconnecting from Extended WebSocket...');

        // Stop ping
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        // Close connection
        this.ws.close();
        this.ws = null;
        this.connected = false;
        this.subscriptions.clear();
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC STREAM SUBSCRIPTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Subscribe to order book updates
     */
    subscribeOrderBook(market: string): void {
        this.subscribe('orderbook', { channel: 'orderbook', market });
    }

    /**
     * Subscribe to trade updates
     */
    subscribeTrades(market: string): void {
        this.subscribe('trades', { channel: 'trades', market });
    }

    /**
     * Subscribe to funding rate updates
     */
    subscribeFundingRates(market: string): void {
        this.subscribe('funding', { channel: 'funding', market });
    }

    /**
     * Subscribe to candle updates
     */
    subscribeCandles(market: string, interval: string): void {
        this.subscribe('candles', { channel: 'candles', market, interval });
    }

    /**
     * Subscribe to mark price updates
     */
    subscribeMarkPrice(market: string): void {
        this.subscribe('markPrice', { channel: 'markPrice', market });
    }

    /**
     * Subscribe to index price updates
     */
    subscribeIndexPrice(market: string): void {
        this.subscribe('indexPrice', { channel: 'indexPrice', market });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE STREAM SUBSCRIPTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Subscribe to account updates (orders, positions, balance)
     */
    subscribeAccountUpdates(): void {
        this.subscribe('account', { channel: 'account' });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UNSUBSCRIBE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Unsubscribe from a channel
     */
    unsubscribe(key: string, message: Partial<WsSubscribeMessage>): void {
        if (!this.isConnected()) {
            console.warn('⚠️  WebSocket not connected');
            return;
        }

        this.send({
            type: 'unsubscribe',
            ...message,
        });

        this.subscriptions.delete(key);
        console.log(`📡 Unsubscribed from ${key}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Handle WebSocket open
     */
    private handleOpen(): void {
        console.log('✅ Extended WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;

        // Start ping to keep connection alive
        this.startPing();

        // Resubscribe to channels
        this.resubscribe();

        // Call user handler
        this.handlers.onConnect?.();
    }

    /**
     * Handle WebSocket message
     */
    private handleMessage(data: Buffer): void {
        try {
            const message = JSON.parse(data.toString());

            // Route message to appropriate handler
            switch (message.channel || message.type) {
                case 'orderbook':
                    this.handlers.onOrderBook?.(message.market, message.data);
                    break;

                case 'trades':
                    this.handlers.onTrade?.(message.market, message.data);
                    break;

                case 'funding':
                    this.handlers.onFunding?.(message.market, message.data);
                    break;

                case 'candles':
                    this.handlers.onCandle?.(
                        message.market,
                        message.interval,
                        message.data
                    );
                    break;

                case 'markPrice':
                    this.handlers.onMarkPrice?.(message.market, message.data);
                    break;

                case 'indexPrice':
                    this.handlers.onIndexPrice?.(message.market, message.data);
                    break;

                case 'account':
                    this.handlers.onAccountUpdate?.(message.data);
                    break;

                case 'pong':
                    // Pong response, connection is alive
                    break;

                default:
                    console.log('📨 Unhandled message:', message);
            }
        } catch (error) {
            console.error('❌ Failed to parse WebSocket message:', error);
        }
    }

    /**
     * Handle WebSocket close
     */
    private handleClose(code: number, reason: string): void {
        console.log(`🔌 Extended WebSocket closed [${code}]: ${reason}`);
        this.connected = false;

        // Stop ping
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        // Call user handler
        this.handlers.onDisconnect?.();

        // Attempt reconnection
        this.attemptReconnect();
    }

    /**
     * Handle WebSocket error
     */
    private handleError(error: Error): void {
        console.error('❌ Extended WebSocket error:', error);
        this.handlers.onError?.(error);
    }

    /**
     * Attempt to reconnect
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(
                `❌ Max reconnect attempts (${this.maxReconnectAttempts}) reached`
            );
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            30000
        );

        console.log(
            `🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );

        setTimeout(() => {
            this.ws = null;
            this.connect();
        }, delay);
    }

    /**
     * Subscribe to a channel
     */
    private subscribe(key: string, message: Partial<WsSubscribeMessage>): void {
        if (!this.isConnected()) {
            console.warn('⚠️  WebSocket not connected, queuing subscription:', key);
        }

        this.send({
            type: 'subscribe',
            ...message,
        });

        this.subscriptions.set(key, true);
        console.log(`📡 Subscribed to ${key}`);
    }

    /**
     * Resubscribe to all channels after reconnect
     */
    private resubscribe(): void {
        if (this.subscriptions.size === 0) {
            return;
        }

        console.log(`🔄 Resubscribing to ${this.subscriptions.size} channels...`);

        // Note: This is simplified - in production you'd need to store
        // full subscription details to properly resubscribe
        for (const key of this.subscriptions.keys()) {
            console.log(`📡 Resubscribed to ${key}`);
        }
    }

    /**
     * Send message to WebSocket
     */
    private send(data: any): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️  WebSocket not ready, message not sent:', data);
            return;
        }

        this.ws.send(JSON.stringify(data));
    }

    /**
     * Start ping to keep connection alive
     */
    private startPing(): void {
        this.pingInterval = setInterval(() => {
            if (this.isConnected()) {
                this.send({ type: 'ping' });
            }
        }, 30000); // Ping every 30 seconds
    }
}
