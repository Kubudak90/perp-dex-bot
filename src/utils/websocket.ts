// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET MANAGER
// Real-time market data feeds for faster execution
// ═══════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { Logger } from './logger';
import { NetworkError } from './errors';
import { EventEmitter } from 'events';

export interface WebSocketConfig {
    url: string;
    reconnectDelay: number;
    maxReconnectAttempts: number;
    pingInterval: number;
}

export type WebSocketEvent = 'connected' | 'disconnected' | 'error' | 'candle' | 'trade' | 'ticker';

// ─────────────────────────────────────────────────────────────────────────
// WEBSOCKET MANAGER
// ─────────────────────────────────────────────────────────────────────────
export class WebSocketManager extends EventEmitter {
    private logger: Logger;
    private config: WebSocketConfig;
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private isConnecting = false;
    private shouldReconnect = true;
    private subscriptions: Set<string> = new Set();

    constructor(config: WebSocketConfig, loggerContext: string = 'WebSocket') {
        super();
        this.logger = new Logger(loggerContext);
        this.config = config;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONNECT
    // ─────────────────────────────────────────────────────────────────────────
    async connect(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.logger.warn('WebSocket already connected');
            return;
        }

        if (this.isConnecting) {
            this.logger.warn('Connection already in progress');
            return;
        }

        this.isConnecting = true;
        this.shouldReconnect = true;

        try {
            this.logger.info(`Connecting to ${this.config.url}`);

            this.ws = new WebSocket(this.config.url);

            this.ws.on('open', () => this.handleOpen());
            this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
            this.ws.on('error', (error: Error) => this.handleError(error));
            this.ws.on('close', (code: number, reason: Buffer) =>
                this.handleClose(code, reason.toString())
            );
            this.ws.on('ping', () => this.handlePing());
            this.ws.on('pong', () => this.handlePong());

            // Wait for connection
            await this.waitForConnection();
        } catch (error) {
            this.isConnecting = false;
            throw new NetworkError(`WebSocket connection failed: ${(error as Error).message}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────────────────────────────────
    disconnect(): void {
        this.shouldReconnect = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        if (this.ws) {
            this.ws.close(1000, 'Normal closure');
            this.ws = null;
        }

        this.logger.info('WebSocket disconnected');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUBSCRIBE
    // ─────────────────────────────────────────────────────────────────────────
    subscribe(channel: string, params?: Record<string, any>): void {
        const subscription = JSON.stringify({
            method: 'subscribe',
            subscription: { type: channel, ...params }
        });

        this.subscriptions.add(subscription);

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(subscription);
            this.logger.info(`Subscribed to ${channel}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNSUBSCRIBE
    // ─────────────────────────────────────────────────────────────────────────
    unsubscribe(channel: string): void {
        const unsubscription = JSON.stringify({
            method: 'unsubscribe',
            subscription: { type: channel }
        });

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(unsubscription);
            this.logger.info(`Unsubscribed from ${channel}`);
        }

        // Remove from subscriptions
        this.subscriptions.forEach(sub => {
            if (sub.includes(channel)) {
                this.subscriptions.delete(sub);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEND
    // ─────────────────────────────────────────────────────────────────────────
    send(data: string | object): void {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            throw new NetworkError('WebSocket not connected');
        }

        const message = typeof data === 'string' ? data : JSON.stringify(data);
        this.ws.send(message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT HANDLERS
    // ─────────────────────────────────────────────────────────────────────────
    private handleOpen(): void {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.logger.success('WebSocket connected');

        // Start ping/pong
        this.startPingPong();

        // Re-subscribe to channels
        this.resubscribe();

        this.emit('connected');
    }

    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());

            // Handle different message types
            if (message.channel === 'candle') {
                this.emit('candle', message.data);
            } else if (message.channel === 'trades') {
                this.emit('trade', message.data);
            } else if (message.channel === 'ticker') {
                this.emit('ticker', message.data);
            } else {
                // Generic message event
                this.emit('message', message);
            }
        } catch (error) {
            this.logger.error('Failed to parse WebSocket message', error as Error);
        }
    }

    private handleError(error: Error): void {
        this.logger.error('WebSocket error', error);
        this.emit('error', error);
    }

    private handleClose(code: number, reason: string): void {
        this.isConnecting = false;
        this.logger.warn(`WebSocket closed: ${code} - ${reason}`);

        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        this.emit('disconnected', { code, reason });

        // Attempt reconnection
        if (this.shouldReconnect) {
            this.scheduleReconnect();
        }
    }

    private handlePing(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.pong();
        }
    }

    private handlePong(): void {
        // Connection is alive
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECONNECTION LOGIC
    // ─────────────────────────────────────────────────────────────────────────
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.logger.error('Max reconnection attempts reached');
            this.shouldReconnect = false;
            return;
        }

        const delay = Math.min(
            this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts),
            30000
        );

        this.reconnectAttempts++;
        this.logger.info(
            `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
        );

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(error => {
                this.logger.error('Reconnection failed', error as Error);
            });
        }, delay);
    }

    private resubscribe(): void {
        if (this.subscriptions.size === 0) return;

        this.logger.info(`Re-subscribing to ${this.subscriptions.size} channels`);

        this.subscriptions.forEach(subscription => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(subscription);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PING/PONG
    // ─────────────────────────────────────────────────────────────────────────
    private startPingPong(): void {
        this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, this.config.pingInterval);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private waitForConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 10000);

            this.once('connected', () => {
                clearTimeout(timeout);
                resolve();
            });

            this.once('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GETTERS
    // ─────────────────────────────────────────────────────────────────────────
    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    getState(): string {
        if (!this.ws) return 'CLOSED';

        switch (this.ws.readyState) {
            case WebSocket.CONNECTING:
                return 'CONNECTING';
            case WebSocket.OPEN:
                return 'OPEN';
            case WebSocket.CLOSING:
                return 'CLOSING';
            case WebSocket.CLOSED:
                return 'CLOSED';
            default:
                return 'UNKNOWN';
        }
    }
}
