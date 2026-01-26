// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET PRICE FEED
// Real-time price streaming for dashboard and trading
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { Logger } from './logger';

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────
export interface PriceUpdate {
    symbol: string;
    price: number;
    bid: number;
    ask: number;
    volume24h: number;
    change24h: number;
    changePercent24h: number;
    high24h: number;
    low24h: number;
    timestamp: number;
}

export interface OrderBookUpdate {
    symbol: string;
    bids: [number, number][]; // [price, size][]
    asks: [number, number][];
    timestamp: number;
}

export interface TradeUpdate {
    symbol: string;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    timestamp: number;
}

export interface PriceFeedConfig {
    symbols: string[];
    updateInterval: number; // ms
    mockMode: boolean;
}

export interface PriceData {
    symbol: string;
    current: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    change: number;
    changePercent: number;
    lastUpdate: number;
    history: { time: number; price: number }[];
}

type PriceFeedEvents = {
    price: [PriceUpdate];
    orderbook: [OrderBookUpdate];
    trade: [TradeUpdate];
    connected: [];
    disconnected: [];
    error: [Error];
};

// ─────────────────────────────────────────────────────────────────────────
// PRICE FEED SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class PriceFeed extends EventEmitter {
    private logger: Logger;
    private config: PriceFeedConfig;
    private prices: Map<string, PriceData> = new Map();
    private isRunning: boolean = false;
    private updateTimer: NodeJS.Timeout | null = null;
    private subscribers: Map<string, Set<(update: PriceUpdate) => void>> = new Map();

    // Simulated base prices for mock mode
    private basePrices: Record<string, number> = {
        'BTC': 95000,
        'ETH': 3200,
        'SOL': 180,
        'BNB': 600,
        'XRP': 2.5,
        'ADA': 0.85,
        'AVAX': 35,
        'DOGE': 0.32,
        'DOT': 7,
        'LINK': 22
    };

    constructor(config: Partial<PriceFeedConfig> = {}) {
        super();
        this.logger = new Logger('PriceFeed');
        this.config = {
            symbols: config.symbols || ['BTC', 'ETH', 'SOL'],
            updateInterval: config.updateInterval || 1000,
            mockMode: config.mockMode ?? true
        };

        // Initialize prices
        for (const symbol of this.config.symbols) {
            this.initializePrice(symbol);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────
    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.logger.info(`Price feed started for ${this.config.symbols.join(', ')}`);
        this.emit('connected');

        if (this.config.mockMode) {
            this.startMockFeed();
        } else {
            // Real WebSocket connection would go here
            this.startMockFeed(); // Fallback to mock for now
        }
    }

    stop(): void {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }

        this.logger.info('Price feed stopped');
        this.emit('disconnected');
    }

    // ─────────────────────────────────────────────────────────────────────
    // MOCK FEED
    // ─────────────────────────────────────────────────────────────────────
    private startMockFeed(): void {
        this.updateTimer = setInterval(() => {
            for (const symbol of this.config.symbols) {
                this.generateMockUpdate(symbol);
            }
        }, this.config.updateInterval);
    }

    private generateMockUpdate(symbol: string): void {
        const data = this.prices.get(symbol);
        if (!data) return;

        // Generate realistic price movement
        const volatility = 0.0001 + Math.random() * 0.0003;
        const direction = Math.random() > 0.5 ? 1 : -1;
        const change = data.current * volatility * direction;

        const newPrice = Math.max(data.current + change, data.current * 0.9);

        // Update high/low
        const high = Math.max(data.high, newPrice);
        const low = Math.min(data.low, newPrice);

        // Calculate 24h change
        const changeFromOpen = newPrice - data.open;
        const changePercent = (changeFromOpen / data.open) * 100;

        // Add to history
        data.history.push({ time: Date.now(), price: newPrice });
        if (data.history.length > 500) {
            data.history = data.history.slice(-500);
        }

        // Update data
        data.current = newPrice;
        data.high = high;
        data.low = low;
        data.change = changeFromOpen;
        data.changePercent = changePercent;
        data.lastUpdate = Date.now();

        // Create update
        const update: PriceUpdate = {
            symbol,
            price: newPrice,
            bid: newPrice * 0.9999,
            ask: newPrice * 1.0001,
            volume24h: data.volume,
            change24h: changeFromOpen,
            changePercent24h: changePercent,
            high24h: high,
            low24h: low,
            timestamp: Date.now()
        };

        // Emit events
        this.emit('price', update);

        // Notify subscribers
        const subs = this.subscribers.get(symbol);
        if (subs) {
            for (const callback of subs) {
                callback(update);
            }
        }

        // Occasionally emit a trade
        if (Math.random() > 0.7) {
            this.emit('trade', {
                symbol,
                price: newPrice,
                size: Math.random() * 10,
                side: Math.random() > 0.5 ? 'buy' : 'sell',
                timestamp: Date.now()
            });
        }
    }

    private initializePrice(symbol: string): void {
        const basePrice = this.basePrices[symbol] || 100;
        const variance = basePrice * 0.02; // 2% variance
        const currentPrice = basePrice + (Math.random() - 0.5) * variance;

        this.prices.set(symbol, {
            symbol,
            current: currentPrice,
            open: currentPrice * (1 - (Math.random() - 0.5) * 0.02),
            high: currentPrice * (1 + Math.random() * 0.03),
            low: currentPrice * (1 - Math.random() * 0.03),
            volume: Math.random() * 1000000000,
            change: 0,
            changePercent: 0,
            lastUpdate: Date.now(),
            history: [{ time: Date.now(), price: currentPrice }]
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUBSCRIPTIONS
    // ─────────────────────────────────────────────────────────────────────
    subscribe(symbol: string, callback: (update: PriceUpdate) => void): () => void {
        if (!this.subscribers.has(symbol)) {
            this.subscribers.set(symbol, new Set());
        }
        this.subscribers.get(symbol)!.add(callback);

        // Add symbol if not already tracked
        if (!this.config.symbols.includes(symbol)) {
            this.config.symbols.push(symbol);
            this.initializePrice(symbol);
        }

        this.logger.info(`Subscribed to ${symbol} price updates`);

        // Return unsubscribe function
        return () => {
            const subs = this.subscribers.get(symbol);
            if (subs) {
                subs.delete(callback);
                if (subs.size === 0) {
                    this.subscribers.delete(symbol);
                }
            }
        };
    }

    addSymbol(symbol: string): void {
        if (this.config.symbols.includes(symbol)) return;

        this.config.symbols.push(symbol);
        this.initializePrice(symbol);
        this.logger.info(`Symbol added: ${symbol}`);
    }

    removeSymbol(symbol: string): void {
        const index = this.config.symbols.indexOf(symbol);
        if (index === -1) return;

        this.config.symbols.splice(index, 1);
        this.prices.delete(symbol);
        this.subscribers.delete(symbol);
        this.logger.info(`Symbol removed: ${symbol}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GETTERS
    // ─────────────────────────────────────────────────────────────────────
    getPrice(symbol: string): number {
        return this.prices.get(symbol)?.current || 0;
    }

    getPriceData(symbol: string): PriceData | null {
        return this.prices.get(symbol) || null;
    }

    getAllPrices(): PriceUpdate[] {
        const updates: PriceUpdate[] = [];
        for (const [symbol, data] of this.prices) {
            updates.push({
                symbol,
                price: data.current,
                bid: data.current * 0.9999,
                ask: data.current * 1.0001,
                volume24h: data.volume,
                change24h: data.change,
                changePercent24h: data.changePercent,
                high24h: data.high,
                low24h: data.low,
                timestamp: data.lastUpdate
            });
        }
        return updates;
    }

    getPriceHistory(symbol: string, limit: number = 100): { time: number; price: number }[] {
        const data = this.prices.get(symbol);
        if (!data) return [];
        return data.history.slice(-limit);
    }

    getSymbols(): string[] {
        return [...this.config.symbols];
    }

    isConnected(): boolean {
        return this.isRunning;
    }

    // ─────────────────────────────────────────────────────────────────────
    // MANUAL UPDATE (for integration with exchanges)
    // ─────────────────────────────────────────────────────────────────────
    updatePrice(symbol: string, price: number, volume?: number): void {
        let data = this.prices.get(symbol);

        if (!data) {
            this.basePrices[symbol] = price;
            this.initializePrice(symbol);
            data = this.prices.get(symbol)!;
        }

        const changeFromOpen = price - data.open;
        const changePercent = (changeFromOpen / data.open) * 100;

        data.current = price;
        data.high = Math.max(data.high, price);
        data.low = Math.min(data.low, price);
        data.change = changeFromOpen;
        data.changePercent = changePercent;
        data.lastUpdate = Date.now();
        if (volume !== undefined) {
            data.volume = volume;
        }

        data.history.push({ time: Date.now(), price });
        if (data.history.length > 500) {
            data.history = data.history.slice(-500);
        }

        const update: PriceUpdate = {
            symbol,
            price,
            bid: price * 0.9999,
            ask: price * 1.0001,
            volume24h: data.volume,
            change24h: changeFromOpen,
            changePercent24h: changePercent,
            high24h: data.high,
            low24h: data.low,
            timestamp: Date.now()
        };

        this.emit('price', update);

        const subs = this.subscribers.get(symbol);
        if (subs) {
            for (const callback of subs) {
                callback(update);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STATISTICS
    // ─────────────────────────────────────────────────────────────────────
    getStats(): {
        symbols: number;
        subscribers: number;
        updatesPerSecond: number;
        isRunning: boolean;
    } {
        let totalSubs = 0;
        for (const subs of this.subscribers.values()) {
            totalSubs += subs.size;
        }

        return {
            symbols: this.config.symbols.length,
            subscribers: totalSubs,
            updatesPerSecond: this.isRunning ? 1000 / this.config.updateInterval : 0,
            isRunning: this.isRunning
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT SINGLETON
// ─────────────────────────────────────────────────────────────────────────
export const priceFeed = new PriceFeed({
    symbols: ['BTC', 'ETH', 'SOL', 'BNB'],
    updateInterval: 1000,
    mockMode: true
});
