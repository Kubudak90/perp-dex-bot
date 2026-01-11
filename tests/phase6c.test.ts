// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6C TESTS
// External Data Integration: Liquidations, Order Book, Large Orders
// ═══════════════════════════════════════════════════════════════════════════

import { ExternalDataAnalyzer } from '../src/utils/external-data';
import {
    LiquidationHeatmap,
    OrderBookSnapshot,
    LargeOrder,
    ExternalData
} from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// LIQUIDATION HEATMAP TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Liquidation Heatmap Analysis', () => {
    const mockLiqHeatmap: LiquidationHeatmap = {
        timestamp: Date.now(),
        levels: [
            { price: 42000, amount: 2000000, side: 'LONG' },   // $2M long liqs below
            { price: 41000, amount: 500000, side: 'LONG' },    // $500k long liqs
            { price: 43000, amount: 1500000, side: 'SHORT' },  // $1.5M short liqs above
            { price: 44000, amount: 300000, side: 'SHORT' }    // $300k short liqs
        ],
        nearestLong: 42000,
        nearestShort: 43000,
        intensityLong: 2500000,
        intensityShort: 1800000
    };

    it('should allow LONG entry when no major SHORT liquidations nearby', () => {
        const result = ExternalDataAnalyzer.isLiquidationSafe(
            'LONG',
            40000,  // Entry far below SHORT liq levels
            mockLiqHeatmap,
            0.02,   // 2% avoid distance
            1000000 // $1M threshold
        );

        expect(result.safe).toBe(true);
    });

    it('should block LONG entry when major SHORT liquidations nearby', () => {
        const result = ExternalDataAnalyzer.isLiquidationSafe(
            'LONG',
            42800,  // Entry within 2% of $1.5M SHORT liq at 43000
            mockLiqHeatmap,
            0.02,
            1000000
        );

        expect(result.safe).toBe(false);
        expect(result.reason).toContain('SHORT liquidations');
        expect(result.nearestLiq).toBe(43000);
    });

    it('should allow SHORT entry when no major LONG liquidations nearby', () => {
        const result = ExternalDataAnalyzer.isLiquidationSafe(
            'SHORT',
            45000,  // Entry far above LONG liq levels
            mockLiqHeatmap,
            0.02,
            1000000
        );

        expect(result.safe).toBe(true);
    });

    it('should block SHORT entry when major LONG liquidations nearby', () => {
        const result = ExternalDataAnalyzer.isLiquidationSafe(
            'SHORT',
            42100,  // Entry within 2% of $2M LONG liq at 42000
            mockLiqHeatmap,
            0.02,
            1000000
        );

        expect(result.safe).toBe(false);
        expect(result.reason).toContain('LONG liquidations');
        expect(result.nearestLiq).toBe(42000);
    });

    it('should ignore small liquidation clusters', () => {
        const result = ExternalDataAnalyzer.isLiquidationSafe(
            'SHORT',
            41100,  // Near $500k LONG liq (below $1M threshold)
            mockLiqHeatmap,
            0.02,
            1000000
        );

        expect(result.safe).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// ORDER BOOK ANALYSIS TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Order Book Analysis', () => {
    const mockGoodOB: OrderBookSnapshot = {
        timestamp: Date.now(),
        bids: [
            { price: 40000, size: 10, total: 10 },
            { price: 39900, size: 20, total: 30 }
        ],
        asks: [
            { price: 40010, size: 12, total: 12 },
            { price: 40100, size: 18, total: 30 }
        ],
        spread: 10,
        spreadPercent: 0.00025,  // 0.025%
        midPrice: 40005,
        bidDepth1pct: 150000,
        askDepth1pct: 140000,
        imbalance: 0.03  // Slight bid bias
    };

    it('should approve good order book conditions', () => {
        const result = ExternalDataAnalyzer.analyzeOrderBook(
            mockGoodOB,
            0.001,  // Max 0.1% spread
            100000, // Min $100k depth
            0.7     // Max 70% imbalance
        );

        expect(result.tradeable).toBe(true);
        expect(result.quality).toBe('EXCELLENT');
    });

    it('should reject wide spread', () => {
        const wideSpreadOB = {
            ...mockGoodOB,
            spreadPercent: 0.002  // 0.2% spread (too wide)
        };

        const result = ExternalDataAnalyzer.analyzeOrderBook(
            wideSpreadOB,
            0.001,
            100000,
            0.7
        );

        expect(result.tradeable).toBe(false);
        expect(result.reason).toContain('Spread too wide');
        expect(result.quality).toBe('POOR');
    });

    it('should reject low depth', () => {
        const lowDepthOB = {
            ...mockGoodOB,
            bidDepth1pct: 30000,
            askDepth1pct: 40000  // Total $70k (below $100k)
        };

        const result = ExternalDataAnalyzer.analyzeOrderBook(
            lowDepthOB,
            0.001,
            100000,
            0.7
        );

        expect(result.tradeable).toBe(false);
        expect(result.reason).toContain('Insufficient depth');
    });

    it('should reject high imbalance', () => {
        const imbalancedOB = {
            ...mockGoodOB,
            imbalance: 0.8  // 80% one-sided (too imbalanced)
        };

        const result = ExternalDataAnalyzer.analyzeOrderBook(
            imbalancedOB,
            0.001,
            100000,
            0.7
        );

        expect(result.tradeable).toBe(false);
        expect(result.reason).toContain('imbalanced');
    });

    it('should detect order book walls', () => {
        const wallOB: OrderBookSnapshot = {
            ...mockGoodOB,
            bids: [
                { price: 40000, size: 60000, total: 60000 },  // $60k wall
                { price: 39900, size: 10000, total: 70000 }
            ],
            asks: [
                { price: 40010, size: 80000, total: 80000 },  // $80k wall
                { price: 40100, size: 10000, total: 90000 }
            ]
        };

        const walls = ExternalDataAnalyzer.detectOrderBookWalls(wallOB, 50000);

        expect(walls.bidWalls).toHaveLength(1);
        expect(walls.askWalls).toHaveLength(1);
        expect(walls.bidWalls[0]).toBe(40000);
        expect(walls.askWalls[0]).toBe(40010);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// LARGE ORDER TRACKING TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Large Order Tracking', () => {
    const now = Date.now();
    const mockLargeOrders: LargeOrder[] = [
        { timestamp: now - 2 * 60000, side: 'SELL', price: 40000, size: 150000, type: 'MARKET' },  // 2min ago
        { timestamp: now - 10 * 60000, side: 'BUY', price: 39900, size: 200000, type: 'MARKET' },  // 10min ago
        { timestamp: now - 30 * 60000, side: 'SELL', price: 40100, size: 80000, type: 'LIMIT' }   // 30min ago
    ];

    it('should block LONG entry after recent large SELL order', () => {
        const result = ExternalDataAnalyzer.isLargeOrderSafe(
            'LONG',
            mockLargeOrders,
            5,      // Avoid for 5min
            100000  // $100k threshold
        );

        expect(result.safe).toBe(false);
        expect(result.reason).toContain('Large SELL order');
        expect(result.lastContraOrder).toBeDefined();
        expect(result.lastContraOrder!.size).toBe(150000);
    });

    it('should allow LONG entry after large SELL order expires', () => {
        const result = ExternalDataAnalyzer.isLargeOrderSafe(
            'LONG',
            mockLargeOrders,
            1,      // Only avoid for 1min
            100000
        );

        expect(result.safe).toBe(true);  // 2min old SELL is past 1min window
    });

    it('should allow SHORT entry (no recent large BUY)', () => {
        const result = ExternalDataAnalyzer.isLargeOrderSafe(
            'SHORT',
            mockLargeOrders,
            5,
            100000
        );

        expect(result.safe).toBe(true);  // Last large BUY was 10min ago
    });

    it('should ignore small orders', () => {
        const smallOrders: LargeOrder[] = [
            { timestamp: now - 1 * 60000, side: 'SELL', price: 40000, size: 50000, type: 'MARKET' }
        ];

        const result = ExternalDataAnalyzer.isLargeOrderSafe(
            'LONG',
            smallOrders,
            5,
            100000  // $100k threshold - order is only $50k
        );

        expect(result.safe).toBe(true);
    });

    it('should detect accumulation trend', () => {
        const accumulationOrders: LargeOrder[] = [
            { timestamp: now - 10 * 60000, side: 'BUY', price: 40000, size: 200000, type: 'MARKET' },
            { timestamp: now - 15 * 60000, side: 'BUY', price: 39900, size: 150000, type: 'MARKET' },
            { timestamp: now - 20 * 60000, side: 'BUY', price: 39800, size: 300000, type: 'MARKET' },
            { timestamp: now - 25 * 60000, side: 'SELL', price: 40100, size: 100000, type: 'MARKET' }
        ];

        const activity = ExternalDataAnalyzer.detectWhaleActivity(accumulationOrders, 60);

        expect(activity.trend).toBe('ACCUMULATING');
        expect(activity.buyVolume).toBe(650000);
        expect(activity.sellVolume).toBe(100000);
    });

    it('should detect distribution trend', () => {
        const distributionOrders: LargeOrder[] = [
            { timestamp: now - 5 * 60000, side: 'SELL', price: 40000, size: 200000, type: 'MARKET' },
            { timestamp: now - 10 * 60000, side: 'SELL', price: 40100, size: 250000, type: 'MARKET' },
            { timestamp: now - 15 * 60000, side: 'BUY', price: 39900, size: 80000, type: 'MARKET' }
        ];

        const activity = ExternalDataAnalyzer.detectWhaleActivity(distributionOrders, 60);

        expect(activity.trend).toBe('DISTRIBUTING');
        expect(activity.buyVolume).toBe(80000);
        expect(activity.sellVolume).toBe(450000);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// COMBINED EXTERNAL DATA ANALYSIS
// ─────────────────────────────────────────────────────────────────────────
describe('Combined External Data Analysis', () => {
    it('should pass all checks with good external data', () => {
        const externalData: ExternalData = {
            liquidations: {
                timestamp: Date.now(),
                levels: [
                    { price: 45000, amount: 1500000, side: 'SHORT' }  // Far away
                ],
                nearestLong: 38000,
                nearestShort: 45000,
                intensityLong: 1000000,
                intensityShort: 1500000
            },
            orderBook: {
                timestamp: Date.now(),
                bids: [{ price: 40000, size: 10, total: 10 }],
                asks: [{ price: 40010, size: 10, total: 10 }],
                spread: 10,
                spreadPercent: 0.00025,
                midPrice: 40005,
                bidDepth1pct: 150000,
                askDepth1pct: 140000,
                imbalance: 0.03
            },
            recentLargeOrders: []
        };

        const result = ExternalDataAnalyzer.analyzeExternalData(
            'LONG',
            40000,
            externalData,
            {
                liqAvoidDistance: 0.02,
                liqIntensityThreshold: 1000000,
                maxSpreadPercent: 0.001,
                minOrderBookDepth: 100000,
                imbalanceThreshold: 0.7,
                avoidAfterLargeOrder: 5,
                largeOrderThreshold: 100000
            }
        );

        expect(result.safe).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    it('should fail on multiple issues', () => {
        const externalData: ExternalData = {
            liquidations: {
                timestamp: Date.now(),
                levels: [
                    { price: 40500, amount: 2000000, side: 'SHORT' }  // Too close
                ],
                nearestLong: 38000,
                nearestShort: 40500,
                intensityLong: 1000000,
                intensityShort: 2000000
            },
            orderBook: {
                timestamp: Date.now(),
                bids: [{ price: 40000, size: 10, total: 10 }],
                asks: [{ price: 40010, size: 10, total: 10 }],
                spread: 10,
                spreadPercent: 0.002,  // Too wide
                midPrice: 40005,
                bidDepth1pct: 50000,   // Too low
                askDepth1pct: 40000,
                imbalance: 0.1
            },
            recentLargeOrders: [
                { timestamp: Date.now() - 60000, side: 'SELL', price: 40000, size: 150000, type: 'MARKET' }
            ]
        };

        const result = ExternalDataAnalyzer.analyzeExternalData(
            'LONG',
            40000,
            externalData,
            {
                liqAvoidDistance: 0.02,
                liqIntensityThreshold: 1000000,
                maxSpreadPercent: 0.001,
                minOrderBookDepth: 100000,
                imbalanceThreshold: 0.7,
                avoidAfterLargeOrder: 5,
                largeOrderThreshold: 100000
            }
        );

        expect(result.safe).toBe(false);
        expect(result.issues.length).toBeGreaterThan(0);
    });
});
