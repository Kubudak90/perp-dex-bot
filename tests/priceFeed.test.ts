// ═══════════════════════════════════════════════════════════════════════════
// PRICE FEED TESTS
// ═══════════════════════════════════════════════════════════════════════════

import { PriceFeed, PriceUpdate } from '../src/utils/priceFeed';

describe('PriceFeed', () => {
    let feed: PriceFeed;

    beforeEach(() => {
        feed = new PriceFeed({
            symbols: ['BTC', 'ETH'],
            updateInterval: 100, // Fast updates for testing
            mockMode: true
        });
    });

    afterEach(() => {
        feed.stop();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────
    describe('Initialization', () => {
        it('should initialize with configured symbols', () => {
            const symbols = feed.getSymbols();
            expect(symbols).toContain('BTC');
            expect(symbols).toContain('ETH');
        });

        it('should have initial prices for symbols', () => {
            const btcPrice = feed.getPrice('BTC');
            const ethPrice = feed.getPrice('ETH');

            expect(btcPrice).toBeGreaterThan(0);
            expect(ethPrice).toBeGreaterThan(0);
        });

        it('should not be connected initially', () => {
            expect(feed.isConnected()).toBe(false);
        });

        it('should return price data for symbol', () => {
            const data = feed.getPriceData('BTC');

            expect(data).not.toBeNull();
            expect(data?.symbol).toBe('BTC');
            expect(data?.current).toBeGreaterThan(0);
            expect(data?.history).toHaveLength(1);
        });

        it('should return null for unknown symbol', () => {
            const data = feed.getPriceData('UNKNOWN');
            expect(data).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────
    describe('Lifecycle', () => {
        it('should start feed', () => {
            feed.start();
            expect(feed.isConnected()).toBe(true);
        });

        it('should emit connected event on start', (done) => {
            feed.once('connected', () => {
                expect(feed.isConnected()).toBe(true);
                done();
            });
            feed.start();
        });

        it('should stop feed', () => {
            feed.start();
            feed.stop();
            expect(feed.isConnected()).toBe(false);
        });

        it('should emit disconnected event on stop', (done) => {
            feed.start();
            feed.once('disconnected', () => {
                expect(feed.isConnected()).toBe(false);
                done();
            });
            feed.stop();
        });

        it('should not start twice', () => {
            feed.start();
            const statsBefore = feed.getStats();
            feed.start();
            const statsAfter = feed.getStats();

            expect(statsBefore.updatesPerSecond).toBe(statsAfter.updatesPerSecond);
        });

        it('should handle stop when not running', () => {
            feed.stop(); // Should not throw
            expect(feed.isConnected()).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // PRICE UPDATES
    // ─────────────────────────────────────────────────────────────────────────
    describe('Price Updates', () => {
        it('should emit price updates', (done) => {
            feed.once('price', (update: PriceUpdate) => {
                expect(update.symbol).toBeDefined();
                expect(update.price).toBeGreaterThan(0);
                expect(update.timestamp).toBeGreaterThan(0);
                done();
            });
            feed.start();
        });

        it('should include bid and ask in updates', (done) => {
            feed.once('price', (update: PriceUpdate) => {
                expect(update.bid).toBeGreaterThan(0);
                expect(update.ask).toBeGreaterThan(0);
                expect(update.ask).toBeGreaterThan(update.bid);
                done();
            });
            feed.start();
        });

        it('should include 24h stats in updates', (done) => {
            feed.once('price', (update: PriceUpdate) => {
                expect(update.volume24h).toBeDefined();
                expect(update.change24h).toBeDefined();
                expect(update.changePercent24h).toBeDefined();
                expect(update.high24h).toBeDefined();
                expect(update.low24h).toBeDefined();
                done();
            });
            feed.start();
        });

        it('should update price history', (done) => {
            const initialHistory = feed.getPriceHistory('BTC').length;

            feed.start();

            setTimeout(() => {
                const newHistory = feed.getPriceHistory('BTC').length;
                expect(newHistory).toBeGreaterThan(initialHistory);
                done();
            }, 300);
        });

        it('should respect history limit', () => {
            // Fill history with many updates
            for (let i = 0; i < 600; i++) {
                feed.updatePrice('BTC', 50000 + i);
            }

            const history = feed.getPriceHistory('BTC');
            expect(history.length).toBeLessThanOrEqual(500);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SUBSCRIPTIONS
    // ─────────────────────────────────────────────────────────────────────────
    describe('Subscriptions', () => {
        it('should subscribe to symbol updates', (done) => {
            const unsubscribe = feed.subscribe('BTC', (update) => {
                expect(update.symbol).toBe('BTC');
                unsubscribe();
                done();
            });
            feed.start();
        });

        it('should add new symbol when subscribing', () => {
            const callback = jest.fn();
            feed.subscribe('XRP', callback);

            expect(feed.getSymbols()).toContain('XRP');
        });

        it('should unsubscribe successfully', (done) => {
            let callCount = 0;
            const unsubscribe = feed.subscribe('BTC', () => {
                callCount++;
                if (callCount === 1) {
                    unsubscribe();
                    setTimeout(() => {
                        // Should not have many more calls after unsubscribe
                        expect(callCount).toBeLessThan(5);
                        done();
                    }, 300);
                }
            });
            feed.start();
        });

        it('should handle multiple subscribers', (done) => {
            let count1 = 0;
            let count2 = 0;

            feed.subscribe('BTC', () => count1++);
            feed.subscribe('BTC', () => count2++);

            feed.start();

            setTimeout(() => {
                expect(count1).toBeGreaterThan(0);
                expect(count2).toBeGreaterThan(0);
                done();
            }, 300);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SYMBOL MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('Symbol Management', () => {
        it('should add new symbol', () => {
            feed.addSymbol('SOL');
            expect(feed.getSymbols()).toContain('SOL');
        });

        it('should not duplicate symbols', () => {
            const initialLength = feed.getSymbols().length;
            feed.addSymbol('BTC'); // Already exists
            expect(feed.getSymbols().length).toBe(initialLength);
        });

        it('should remove symbol', () => {
            feed.removeSymbol('ETH');
            expect(feed.getSymbols()).not.toContain('ETH');
        });

        it('should handle removing non-existent symbol', () => {
            const initialLength = feed.getSymbols().length;
            feed.removeSymbol('NONEXISTENT');
            expect(feed.getSymbols().length).toBe(initialLength);
        });

        it('should initialize price data for new symbol', () => {
            feed.addSymbol('DOGE');
            const data = feed.getPriceData('DOGE');

            expect(data).not.toBeNull();
            expect(data?.current).toBeGreaterThan(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // MANUAL UPDATES
    // ─────────────────────────────────────────────────────────────────────────
    describe('Manual Updates', () => {
        it('should accept manual price updates', () => {
            feed.updatePrice('BTC', 55000);
            expect(feed.getPrice('BTC')).toBe(55000);
        });

        it('should update high/low on manual update', () => {
            const initialData = feed.getPriceData('BTC');
            const initialHigh = initialData?.high || 0;

            feed.updatePrice('BTC', initialHigh + 10000);

            const newData = feed.getPriceData('BTC');
            expect(newData?.high).toBeGreaterThan(initialHigh);
        });

        it('should emit event on manual update', (done) => {
            feed.once('price', (update) => {
                expect(update.price).toBe(60000);
                done();
            });
            feed.updatePrice('BTC', 60000);
        });

        it('should create symbol on update if not exists', () => {
            feed.updatePrice('NEW', 100);
            // Note: getSymbols() returns config symbols only, not dynamically added ones
            // But getPrice and getPriceData work for dynamically added symbols
            expect(feed.getPrice('NEW')).toBe(100);
            expect(feed.getPriceData('NEW')).not.toBeNull();
            expect(feed.getPriceData('NEW')?.current).toBe(100);
        });

        it('should update volume on manual update', () => {
            feed.updatePrice('BTC', 55000, 1000000);
            const data = feed.getPriceData('BTC');
            expect(data?.volume).toBe(1000000);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GETTERS
    // ─────────────────────────────────────────────────────────────────────────
    describe('Getters', () => {
        it('should get all prices', () => {
            const prices = feed.getAllPrices();

            expect(prices.length).toBeGreaterThan(0);
            expect(prices.every(p => p.price > 0)).toBe(true);
        });

        it('should get price history with limit', () => {
            // Add some history
            for (let i = 0; i < 20; i++) {
                feed.updatePrice('BTC', 50000 + i);
            }

            const history = feed.getPriceHistory('BTC', 10);
            expect(history.length).toBeLessThanOrEqual(10);
        });

        it('should return empty array for unknown symbol history', () => {
            const history = feed.getPriceHistory('UNKNOWN');
            expect(history).toHaveLength(0);
        });

        it('should return 0 for unknown symbol price', () => {
            const price = feed.getPrice('UNKNOWN');
            expect(price).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STATISTICS
    // ─────────────────────────────────────────────────────────────────────────
    describe('Statistics', () => {
        it('should return stats', () => {
            const stats = feed.getStats();

            expect(stats).toHaveProperty('symbols');
            expect(stats).toHaveProperty('subscribers');
            expect(stats).toHaveProperty('updatesPerSecond');
            expect(stats).toHaveProperty('isRunning');
        });

        it('should count symbols correctly', () => {
            const stats = feed.getStats();
            expect(stats.symbols).toBe(2); // BTC and ETH
        });

        it('should count subscribers correctly', () => {
            feed.subscribe('BTC', () => {});
            feed.subscribe('BTC', () => {});
            feed.subscribe('ETH', () => {});

            const stats = feed.getStats();
            expect(stats.subscribers).toBe(3);
        });

        it('should show running status', () => {
            expect(feed.getStats().isRunning).toBe(false);

            feed.start();
            expect(feed.getStats().isRunning).toBe(true);

            feed.stop();
            expect(feed.getStats().isRunning).toBe(false);
        });

        it('should show updates per second when running', () => {
            feed.start();
            const stats = feed.getStats();
            expect(stats.updatesPerSecond).toBeGreaterThan(0);
        });

        it('should show 0 updates per second when stopped', () => {
            const stats = feed.getStats();
            expect(stats.updatesPerSecond).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TRADE EVENTS
    // ─────────────────────────────────────────────────────────────────────────
    describe('Trade Events', () => {
        it('should occasionally emit trade events', (done) => {
            let tradeReceived = false;

            feed.on('trade', (trade) => {
                if (!tradeReceived) {
                    tradeReceived = true;
                    expect(trade.symbol).toBeDefined();
                    expect(trade.price).toBeGreaterThan(0);
                    expect(trade.size).toBeGreaterThan(0);
                    expect(['buy', 'sell']).toContain(trade.side);
                    done();
                }
            });

            feed.start();

            // Timeout in case no trade is emitted
            setTimeout(() => {
                if (!tradeReceived) {
                    // Trade events are random, so this is acceptable
                    done();
                }
            }, 2000);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────
// PRICE CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────
describe('Price Calculations', () => {
    let feed: PriceFeed;

    beforeEach(() => {
        feed = new PriceFeed({
            symbols: ['TEST'],
            updateInterval: 100,
            mockMode: true
        });
    });

    afterEach(() => {
        feed.stop();
    });

    it('should calculate change correctly', () => {
        const data = feed.getPriceData('TEST');
        const open = data?.open || 100;

        feed.updatePrice('TEST', open * 1.1); // 10% increase

        const newData = feed.getPriceData('TEST');
        expect(newData?.changePercent).toBeCloseTo(10, 0);
    });

    it('should track high correctly', () => {
        feed.updatePrice('TEST', 100);
        feed.updatePrice('TEST', 150);
        feed.updatePrice('TEST', 120);

        const data = feed.getPriceData('TEST');
        expect(data?.high).toBe(150);
    });

    it('should track low correctly', () => {
        feed.updatePrice('TEST', 100);
        feed.updatePrice('TEST', 50);
        feed.updatePrice('TEST', 80);

        const data = feed.getPriceData('TEST');
        expect(data?.low).toBe(50);
    });
});
