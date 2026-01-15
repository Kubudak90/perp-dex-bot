// ═══════════════════════════════════════════════════════════════════════════
// ADAPTIVE STRATEGIES TESTS
// Tests for market regime-based strategy selection and execution
// ═══════════════════════════════════════════════════════════════════════════

import {
    StrategySelector,
    BreakoutStrategy,
    MeanReversionStrategy,
    MomentumStrategy,
    ScalpStrategy,
    StrategyFactory
} from '../src/strategies/adaptive-strategies';
import { StrategyTracker } from '../src/utils/strategy-tracker';
import { BotConfig, Indicators, Position, TradeResult, MarketRegime } from '../src/types';

// Mock config for tests
const mockConfig: BotConfig = {
    symbol: 'BTC',
    timeframe: '15m',
    leverage: 3,
    supertrendPeriod: 10,
    supertrendMultiplier: 3,
    emaFastPeriod: 50,
    emaSlowPeriod: 200,
    adxPeriod: 14,
    adxThreshold: 20,
    fundingThreshold: 0.05,
    useFundingFilter: true,
    atrPeriod: 14,
    atrLookback: 100,
    minAtrPercentile: 20,
    maxAtrPercentile: 90,
    risk: {
        maxPositionSize: 20,
        maxDailyLoss: 3,
        maxDailyTrades: 3,
        riskRewardRatio: 1.5,
        stopLossAtrMultiplier: 1.5,
        cooldownMinutes: 30
    }
};

// Mock indicators for different regimes
const createIndicators = (regime: MarketRegime): Indicators => {
    const baseIndicators: Indicators = {
        supertrend: {
            trend: 'LONG',
            value: 50000,
            upperBand: 51000,
            lowerBand: 49000
        },
        ema50: 50500,
        ema200: 50000,
        adx: 25,
        atr: 500,
        fundingRate: 0.0001,
        atrPercentile: 50,
        volume: {
            current: 1000,
            sma20: 800,
            ratio: 1.25,
            isSurge: false,
            isAbnormal: false
        },
        marketRegime: {
            regime,
            adxTrend: 25,
            atrVolatility: 50,
            confidence: 0.8
        }
    };

    // Adjust based on regime
    switch (regime) {
        case 'TRENDING':
            baseIndicators.adx = 30;
            baseIndicators.atrPercentile = 55;
            break;
        case 'RANGING':
            baseIndicators.adx = 15;
            baseIndicators.atrPercentile = 40;
            break;
        case 'VOLATILE':
            baseIndicators.adx = 22;
            baseIndicators.atrPercentile = 80;
            baseIndicators.atr = 1000;
            break;
        case 'QUIET':
            baseIndicators.adx = 12;
            baseIndicators.atrPercentile = 15;
            baseIndicators.atr = 200;
            break;
    }

    return baseIndicators;
};

describe('StrategySelector', () => {
    let selector: StrategySelector;

    beforeEach(() => {
        selector = new StrategySelector(mockConfig);
    });

    test('selects SUPERTREND for trending markets with normal volume', () => {
        const indicators = createIndicators('TRENDING');
        indicators.volume!.ratio = 1.0;

        const selection = selector.selectStrategy(indicators);

        expect(selection.strategy).toBe('SUPERTREND');
        expect(selection.confidence).toBeGreaterThan(0.5);
        expect(selection.suggestedSizeMultiplier).toBe(1.0);
    });

    test('selects BREAKOUT for trending markets with high volume', () => {
        const indicators = createIndicators('TRENDING');
        indicators.adx = 30;
        indicators.volume!.ratio = 2.0;
        indicators.atrPercentile = 60;

        const selection = selector.selectStrategy(indicators);

        expect(selection.strategy).toBe('BREAKOUT');
        expect(selection.suggestedSizeMultiplier).toBe(1.2);
    });

    test('selects MEAN_REVERSION for ranging markets', () => {
        const indicators = createIndicators('RANGING');

        const selection = selector.selectStrategy(indicators);

        expect(selection.strategy).toBe('MEAN_REVERSION');
        expect(selection.suggestedSizeMultiplier).toBe(0.7);
        expect(selection.suggestedLeverage).toBeLessThan(mockConfig.leverage);
    });

    test('selects MOMENTUM for volatile markets', () => {
        const indicators = createIndicators('VOLATILE');

        const selection = selector.selectStrategy(indicators);

        expect(selection.strategy).toBe('MOMENTUM');
        expect(selection.suggestedSizeMultiplier).toBe(0.5);
    });

    test('selects SCALP for quiet markets', () => {
        const indicators = createIndicators('QUIET');

        const selection = selector.selectStrategy(indicators);

        expect(selection.strategy).toBe('SCALP');
        expect(selection.suggestedSizeMultiplier).toBe(0.6);
    });
});

describe('BreakoutStrategy', () => {
    let strategy: BreakoutStrategy;

    beforeEach(() => {
        strategy = new BreakoutStrategy(mockConfig);
    });

    test('generates LONG signal on breakout above recent high', () => {
        const indicators = createIndicators('TRENDING');
        indicators.supertrend.trend = 'LONG';
        indicators.volume!.ratio = 1.5;

        const signal = strategy.generateSignal(
            indicators,
            null,
            52000, // Price above recent high
            [51000, 50500], // Recent highs
            [49000, 49500]  // Recent lows
        );

        expect(signal).toBe('LONG');
    });

    test('generates SHORT signal on breakdown below recent low', () => {
        const indicators = createIndicators('TRENDING');
        indicators.supertrend.trend = 'SHORT';
        indicators.ema50 = 49500;
        indicators.volume!.ratio = 1.5;

        const signal = strategy.generateSignal(
            indicators,
            null,
            48500, // Price below recent low
            [51000, 50500], // Recent highs
            [49000, 49500]  // Recent lows
        );

        expect(signal).toBe('SHORT');
    });

    test('returns NONE when ADX too low', () => {
        const indicators = createIndicators('TRENDING');
        indicators.adx = 15; // Below threshold

        const signal = strategy.generateSignal(
            indicators,
            null,
            52000,
            [51000],
            [49000]
        );

        expect(signal).toBe('NONE');
    });

    test('calculates wider SL/TP for breakouts', () => {
        const { stopLoss, takeProfit } = strategy.calculateSLTP('LONG', 50000, 500);

        const slDistance = 50000 - stopLoss;
        const tpDistance = takeProfit - 50000;

        // Should use 2x ATR for SL
        expect(slDistance).toBeCloseTo(1000, 0);
        // Should have 2:1 RR ratio
        expect(tpDistance / slDistance).toBeCloseTo(2, 1);
    });
});

describe('MeanReversionStrategy', () => {
    let strategy: MeanReversionStrategy;

    beforeEach(() => {
        strategy = new MeanReversionStrategy(mockConfig);
    });

    test('generates LONG signal when price below mean', () => {
        const indicators = createIndicators('RANGING');
        indicators.ema50 = 50000;
        indicators.supertrend.trend = 'SHORT';
        indicators.supertrend.lowerBand = 49000;
        indicators.atr = 500;

        // Price significantly below EMA (oversold)
        const signal = strategy.generateSignal(
            indicators,
            null,
            48500 // ~3% below EMA
        );

        expect(signal).toBe('LONG');
    });

    test('generates SHORT signal when price above mean', () => {
        const indicators = createIndicators('RANGING');
        indicators.ema50 = 50000;
        indicators.supertrend.trend = 'LONG';
        indicators.supertrend.upperBand = 51000;
        indicators.atr = 500;

        // Price significantly above EMA (overbought)
        const signal = strategy.generateSignal(
            indicators,
            null,
            51500 // ~3% above EMA
        );

        expect(signal).toBe('SHORT');
    });

    test('returns NONE when ADX too high (trending market)', () => {
        const indicators = createIndicators('RANGING');
        indicators.adx = 30; // Too high for mean reversion

        const signal = strategy.generateSignal(
            indicators,
            null,
            48500
        );

        expect(signal).toBe('NONE');
    });

    test('generates CLOSE signal when price returns to mean', () => {
        const indicators = createIndicators('RANGING');
        indicators.ema50 = 50000;

        const position: Position = {
            side: 'LONG',
            entryPrice: 48500,
            size: 0.1,
            stopLoss: 48000,
            takeProfit: 50500,
            entryTime: Date.now() - 3600000,
            unrealizedPnl: 150
        };

        // Price returned to mean
        const signal = strategy.generateSignal(
            indicators,
            position,
            50000
        );

        expect(signal).toBe('CLOSE');
    });

    test('calculates tight SL/TP for mean reversion', () => {
        const { stopLoss, takeProfit } = strategy.calculateSLTP('LONG', 50000, 500);

        const slDistance = 50000 - stopLoss;
        const tpDistance = takeProfit - 50000;

        // Should use 1x ATR for SL
        expect(slDistance).toBeCloseTo(500, 0);
        // Should have 1:1 RR ratio
        expect(tpDistance / slDistance).toBeCloseTo(1, 1);
    });
});

describe('MomentumStrategy', () => {
    let strategy: MomentumStrategy;

    beforeEach(() => {
        strategy = new MomentumStrategy(mockConfig);
    });

    test('generates LONG signal on bullish momentum', () => {
        const indicators = createIndicators('VOLATILE');
        indicators.supertrend.trend = 'LONG';
        indicators.volume!.ratio = 2.0;

        // 3 bullish candles
        const candles = [
            { open: 49000, close: 49500, high: 49600, low: 48900 },
            { open: 49500, close: 50000, high: 50100, low: 49400 },
            { open: 50000, close: 50800, high: 51000, low: 49900 }
        ];

        const signal = strategy.generateSignal(
            indicators,
            null,
            50800,
            candles
        );

        expect(signal).toBe('LONG');
    });

    test('generates SHORT signal on bearish momentum', () => {
        const indicators = createIndicators('VOLATILE');
        indicators.supertrend.trend = 'SHORT';
        indicators.ema50 = 50500;
        indicators.volume!.ratio = 2.0;

        // 3 bearish candles
        const candles = [
            { open: 51000, close: 50500, high: 51100, low: 50400 },
            { open: 50500, close: 50000, high: 50600, low: 49900 },
            { open: 50000, close: 49200, high: 50100, low: 49100 }
        ];

        const signal = strategy.generateSignal(
            indicators,
            null,
            49200,
            candles
        );

        expect(signal).toBe('SHORT');
    });

    test('calculates wider SL for volatile conditions', () => {
        const { stopLoss, takeProfit } = strategy.calculateSLTP('LONG', 50000, 1000);

        const slDistance = 50000 - stopLoss;

        // Should use 2.5x ATR for SL in momentum strategy
        expect(slDistance).toBeCloseTo(2500, 0);
    });
});

describe('ScalpStrategy', () => {
    let strategy: ScalpStrategy;

    beforeEach(() => {
        strategy = new ScalpStrategy(mockConfig);
    });

    test('generates LONG signal near lower band', () => {
        const indicators = createIndicators('QUIET');
        // Narrow band width (<2%)
        indicators.supertrend.lowerBand = 49600;
        indicators.supertrend.upperBand = 50400; // ~1.6% band width
        indicators.ema50 = 50000;
        indicators.ema200 = 50050; // EMAs close together

        // Price near lower band
        const signal = strategy.generateSignal(
            indicators,
            null,
            49620 // Within 0.5% of lower band (49600 * 1.005 = 49848)
        );

        expect(signal).toBe('LONG');
    });

    test('returns NONE when bands too wide', () => {
        const indicators = createIndicators('QUIET');
        indicators.supertrend.lowerBand = 48000;
        indicators.supertrend.upperBand = 52000; // >2% band width
        indicators.adx = 15;

        const signal = strategy.generateSignal(
            indicators,
            null,
            48100
        );

        expect(signal).toBe('NONE');
    });

    test('calculates tight SL/TP for scalping', () => {
        const { stopLoss, takeProfit } = strategy.calculateSLTP('LONG', 50000, 200);

        const slDistance = 50000 - stopLoss;
        const tpDistance = takeProfit - 50000;

        // Should use 0.75x ATR for SL
        expect(slDistance).toBeCloseTo(150, 0);
        // 0.75:1 RR ratio
        expect(tpDistance / slDistance).toBeCloseTo(0.75, 1);
    });
});

describe('StrategyFactory', () => {
    test('creates BreakoutStrategy', () => {
        const strategy = StrategyFactory.create('BREAKOUT', mockConfig);
        expect(strategy).toBeInstanceOf(BreakoutStrategy);
    });

    test('creates MeanReversionStrategy', () => {
        const strategy = StrategyFactory.create('MEAN_REVERSION', mockConfig);
        expect(strategy).toBeInstanceOf(MeanReversionStrategy);
    });

    test('creates MomentumStrategy', () => {
        const strategy = StrategyFactory.create('MOMENTUM', mockConfig);
        expect(strategy).toBeInstanceOf(MomentumStrategy);
    });

    test('creates ScalpStrategy', () => {
        const strategy = StrategyFactory.create('SCALP', mockConfig);
        expect(strategy).toBeInstanceOf(ScalpStrategy);
    });

    test('returns null for SUPERTREND (uses default)', () => {
        const strategy = StrategyFactory.create('SUPERTREND', mockConfig);
        expect(strategy).toBeNull();
    });
});

describe('StrategyTracker', () => {
    let tracker: StrategyTracker;

    beforeEach(() => {
        tracker = new StrategyTracker();
    });

    test('records and retrieves trade by strategy', () => {
        const trade: TradeResult = {
            side: 'LONG',
            entryPrice: 50000,
            exitPrice: 51000,
            pnl: 100,
            pnlPercent: 2,
            duration: 3600000,
            exitReason: 'TP',
            strategy: 'SUPERTREND',
            marketRegime: 'TRENDING'
        };

        tracker.recordTrade(trade);
        const stats = tracker.getStrategyStats('SUPERTREND');

        expect(stats.totalTrades).toBe(1);
        expect(stats.winningTrades).toBe(1);
        expect(stats.totalPnl).toBe(100);
    });

    test('calculates win rate correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 50000, exitPrice: 51000, pnl: 100, pnlPercent: 2, duration: 3600000, exitReason: 'TP', strategy: 'BREAKOUT', marketRegime: 'TRENDING' },
            { side: 'SHORT', entryPrice: 51000, exitPrice: 51500, pnl: -50, pnlPercent: -1, duration: 1800000, exitReason: 'SL', strategy: 'BREAKOUT', marketRegime: 'TRENDING' },
            { side: 'LONG', entryPrice: 49000, exitPrice: 50500, pnl: 150, pnlPercent: 3, duration: 7200000, exitReason: 'TP', strategy: 'BREAKOUT', marketRegime: 'TRENDING' }
        ];

        trades.forEach(t => tracker.recordTrade(t));
        const stats = tracker.getStrategyStats('BREAKOUT');

        expect(stats.totalTrades).toBe(3);
        expect(stats.winningTrades).toBe(2);
        expect(stats.losingTrades).toBe(1);
        expect(stats.winRate).toBeCloseTo(0.667, 2);
    });

    test('tracks trades by market regime', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 50000, exitPrice: 51000, pnl: 100, pnlPercent: 2, duration: 3600000, exitReason: 'TP', strategy: 'SUPERTREND', marketRegime: 'TRENDING' },
            { side: 'LONG', entryPrice: 49000, exitPrice: 49500, pnl: 50, pnlPercent: 1, duration: 1800000, exitReason: 'TP', strategy: 'MEAN_REVERSION', marketRegime: 'RANGING' }
        ];

        trades.forEach(t => tracker.recordTrade(t));

        const trendingStats = tracker.getRegimeStats('TRENDING');
        const rangingStats = tracker.getRegimeStats('RANGING');

        expect(trendingStats.trades).toBe(1);
        expect(rangingStats.trades).toBe(1);
    });

    test('identifies best strategy for regime', () => {
        // Record multiple trades with different strategies in same regime
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 50000, exitPrice: 51000, pnl: 100, pnlPercent: 2, duration: 3600000, exitReason: 'TP', strategy: 'SUPERTREND', marketRegime: 'TRENDING' },
            { side: 'LONG', entryPrice: 50000, exitPrice: 50500, pnl: 50, pnlPercent: 1, duration: 1800000, exitReason: 'TP', strategy: 'SUPERTREND', marketRegime: 'TRENDING' },
            { side: 'SHORT', entryPrice: 51000, exitPrice: 50000, pnl: -100, pnlPercent: -2, duration: 3600000, exitReason: 'SL', strategy: 'BREAKOUT', marketRegime: 'TRENDING' }
        ];

        trades.forEach(t => tracker.recordTrade(t));

        const regimeStats = tracker.getRegimeStats('TRENDING');
        expect(regimeStats.bestStrategy).toBe('SUPERTREND');
    });

    test('generates performance report', () => {
        const trade: TradeResult = {
            side: 'LONG',
            entryPrice: 50000,
            exitPrice: 51000,
            pnl: 100,
            pnlPercent: 2,
            duration: 3600000,
            exitReason: 'TP',
            strategy: 'SUPERTREND',
            marketRegime: 'TRENDING'
        };

        tracker.recordTrade(trade);
        const report = tracker.generateReport();

        expect(report).toContain('STRATEGY PERFORMANCE REPORT');
        expect(report).toContain('SUPERTREND');
        expect(report).toContain('TRENDING');
    });

    test('exports and imports data', () => {
        const trade: TradeResult = {
            side: 'LONG',
            entryPrice: 50000,
            exitPrice: 51000,
            pnl: 100,
            pnlPercent: 2,
            duration: 3600000,
            exitReason: 'TP',
            strategy: 'SUPERTREND',
            marketRegime: 'TRENDING'
        };

        tracker.recordTrade(trade);
        const exported = tracker.exportData();

        // Create new tracker and import
        const newTracker = new StrategyTracker();
        newTracker.importData(exported);

        const stats = newTracker.getStrategyStats('SUPERTREND');
        expect(stats.totalTrades).toBe(1);
    });

    test('provides strategy recommendation', () => {
        // Add enough trades for recommendations
        for (let i = 0; i < 12; i++) {
            tracker.recordTrade({
                side: 'LONG',
                entryPrice: 50000,
                exitPrice: 50500,
                pnl: i % 3 === 0 ? -50 : 100,
                pnlPercent: i % 3 === 0 ? -1 : 2,
                duration: 3600000,
                exitReason: i % 3 === 0 ? 'SL' : 'TP',
                strategy: 'SUPERTREND',
                marketRegime: 'TRENDING'
            });
        }

        const recommendation = tracker.recommendStrategy('TRENDING');
        expect(recommendation.strategy).toBe('SUPERTREND');
        expect(recommendation.confidence).toBeGreaterThan(0.5);
    });
});
