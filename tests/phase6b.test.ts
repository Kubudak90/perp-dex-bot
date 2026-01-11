// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6B TESTS
// Exit & Risk Enhancements: Partial TP, Dynamic SL, Market Regime
// ═══════════════════════════════════════════════════════════════════════════

import { IndicatorCalculator } from '../src/indicators';
import { TradingStrategy } from '../src/strategies';
import { BotConfig, Candle, Position } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// MARKET REGIME DETECTION TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Market Regime Detection', () => {
    it('should detect TRENDING market (high ADX, normal ATR)', () => {
        const regime = IndicatorCalculator.detectMarketRegime(30, 50, 25);

        expect(regime.regime).toBe('TRENDING');
        expect(regime.adxTrend).toBe(30);
        expect(regime.atrVolatility).toBe(50);
        expect(regime.confidence).toBeGreaterThan(0);
    });

    it('should detect RANGING market (low ADX, normal ATR)', () => {
        const regime = IndicatorCalculator.detectMarketRegime(15, 50, 25);

        expect(regime.regime).toBe('RANGING');
        expect(regime.adxTrend).toBe(15);
        expect(regime.confidence).toBeGreaterThan(0);
    });

    it('should detect VOLATILE market (high ATR)', () => {
        const regime = IndicatorCalculator.detectMarketRegime(30, 85, 25);

        expect(regime.regime).toBe('VOLATILE');
        expect(regime.atrVolatility).toBe(85);
        expect(regime.confidence).toBeGreaterThan(0);
    });

    it('should detect QUIET market (low ATR)', () => {
        const regime = IndicatorCalculator.detectMarketRegime(30, 15, 25);

        expect(regime.regime).toBe('QUIET');
        expect(regime.atrVolatility).toBe(15);
        expect(regime.confidence).toBeGreaterThan(0);
    });

    it('should prioritize volatility extremes over trend strength', () => {
        // Even with high ADX, very high ATR should result in VOLATILE
        const regime1 = IndicatorCalculator.detectMarketRegime(40, 90, 25);
        expect(regime1.regime).toBe('VOLATILE');

        // Even with high ADX, very low ATR should result in QUIET
        const regime2 = IndicatorCalculator.detectMarketRegime(40, 10, 25);
        expect(regime2.regime).toBe('QUIET');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// DYNAMIC STOP LOSS TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Dynamic Stop Loss', () => {
    const baseConfig: BotConfig = {
        symbol: 'BTC',
        timeframe: '15m',
        leverage: 3,
        supertrendPeriod: 10,
        supertrendMultiplier: 3,
        emaFastPeriod: 50,
        emaSlowPeriod: 200,
        adxPeriod: 14,
        adxThreshold: 20,
        fundingThreshold: 0.0005,
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

    it('should use tighter SL in low volatility', () => {
        const config = {
            ...baseConfig,
            useDynamicSl: true,
            slMultiplierLow: 1.0,
            slMultiplierHigh: 2.0
        };

        const strategy = new TradingStrategy(config);
        const entryPrice = 40000;
        const atr = 500;
        const atrPercentile = 25; // Low volatility

        const result = strategy.calculateSLTP('LONG', entryPrice, atr, atrPercentile);

        // With low volatility, SL should be tighter (1.0x ATR)
        const expectedSlDistance = atr * 1.0;
        expect(result.stopLoss).toBeCloseTo(entryPrice - expectedSlDistance, 0);
    });

    it('should use wider SL in high volatility', () => {
        const config = {
            ...baseConfig,
            useDynamicSl: true,
            slMultiplierLow: 1.0,
            slMultiplierHigh: 2.0
        };

        const strategy = new TradingStrategy(config);
        const entryPrice = 40000;
        const atr = 500;
        const atrPercentile = 75; // High volatility

        const result = strategy.calculateSLTP('LONG', entryPrice, atr, atrPercentile);

        // With high volatility, SL should be wider (2.0x ATR)
        const expectedSlDistance = atr * 2.0;
        expect(result.stopLoss).toBeCloseTo(entryPrice - expectedSlDistance, 0);
    });

    it('should use default SL in normal volatility', () => {
        const config = {
            ...baseConfig,
            useDynamicSl: true,
            slMultiplierLow: 1.0,
            slMultiplierHigh: 2.0
        };

        const strategy = new TradingStrategy(config);
        const entryPrice = 40000;
        const atr = 500;
        const atrPercentile = 50; // Normal volatility

        const result = strategy.calculateSLTP('LONG', entryPrice, atr, atrPercentile);

        // With normal volatility, SL should use default (1.5x ATR)
        const expectedSlDistance = atr * 1.5;
        expect(result.stopLoss).toBeCloseTo(entryPrice - expectedSlDistance, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// PARTIAL TAKE PROFIT TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Partial Take Profit', () => {
    const baseConfig: BotConfig = {
        symbol: 'BTC',
        timeframe: '15m',
        leverage: 3,
        supertrendPeriod: 10,
        supertrendMultiplier: 3,
        emaFastPeriod: 50,
        emaSlowPeriod: 200,
        adxPeriod: 14,
        adxThreshold: 20,
        fundingThreshold: 0.0005,
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

    it('should calculate partial TP levels for LONG', () => {
        const config = {
            ...baseConfig,
            usePartialTp: true,
            partialTpLevels: {
                level1: { rrRatio: 1.0, closePercent: 50 },
                level2: { rrRatio: 1.5, closePercent: 30 },
                level3: { rrRatio: 2.0, closePercent: 20 }
            }
        };

        const strategy = new TradingStrategy(config);
        const entryPrice = 40000;
        const atr = 500;

        const result = strategy.calculateSLTP('LONG', entryPrice, atr);

        expect(result.partialTpLevels).toBeDefined();
        expect(result.partialTpLevels!.level1).toBeGreaterThan(entryPrice);
        expect(result.partialTpLevels!.level2).toBeGreaterThan(result.partialTpLevels!.level1);
        expect(result.partialTpLevels!.level3).toBeGreaterThan(result.partialTpLevels!.level2);
    });

    it('should calculate partial TP levels for SHORT', () => {
        const config = {
            ...baseConfig,
            usePartialTp: true,
            partialTpLevels: {
                level1: { rrRatio: 1.0, closePercent: 50 },
                level2: { rrRatio: 1.5, closePercent: 30 },
                level3: { rrRatio: 2.0, closePercent: 20 }
            }
        };

        const strategy = new TradingStrategy(config);
        const entryPrice = 40000;
        const atr = 500;

        const result = strategy.calculateSLTP('SHORT', entryPrice, atr);

        expect(result.partialTpLevels).toBeDefined();
        expect(result.partialTpLevels!.level1).toBeLessThan(entryPrice);
        expect(result.partialTpLevels!.level2).toBeLessThan(result.partialTpLevels!.level1);
        expect(result.partialTpLevels!.level3).toBeLessThan(result.partialTpLevels!.level2);
    });

    it('should detect when partial TP level 1 is hit (LONG)', () => {
        const config = {
            ...baseConfig,
            usePartialTp: true,
            partialTpLevels: {
                level1: { rrRatio: 1.0, closePercent: 50 },
                level2: { rrRatio: 1.5, closePercent: 30 },
                level3: { rrRatio: 2.0, closePercent: 20 }
            }
        };

        const strategy = new TradingStrategy(config);
        const position: Position = {
            side: 'LONG',
            entryPrice: 40000,
            size: 1.0,
            stopLoss: 39500,
            takeProfit: 41000,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            partialTpLevels: []
        };

        const partialTpLevels = {
            level1: 40500,
            level2: 40750,
            level3: 41000
        };

        const currentPrice = 40550; // Above level 1
        const hit = strategy.checkPartialTP(position, currentPrice, partialTpLevels);

        expect(hit).not.toBeNull();
        expect(hit!.level).toBe(1);
    });

    it('should not detect already-hit partial TP levels', () => {
        const config = {
            ...baseConfig,
            usePartialTp: true
        };

        const strategy = new TradingStrategy(config);
        const position: Position = {
            side: 'LONG',
            entryPrice: 40000,
            size: 0.5,
            stopLoss: 39500,
            takeProfit: 41000,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            partialTpLevels: [1] // Level 1 already hit
        };

        const partialTpLevels = {
            level1: 40500,
            level2: 40750,
            level3: 41000
        };

        const currentPrice = 40550; // Above level 1, but already hit
        const hit = strategy.checkPartialTP(position, currentPrice, partialTpLevels);

        expect(hit).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────
// POSITION SIZE ADJUSTMENT TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Position Size Adjustment', () => {
    const baseConfig: BotConfig = {
        symbol: 'BTC',
        timeframe: '15m',
        leverage: 3,
        supertrendPeriod: 10,
        supertrendMultiplier: 3,
        emaFastPeriod: 50,
        emaSlowPeriod: 200,
        adxPeriod: 14,
        adxThreshold: 20,
        fundingThreshold: 0.0005,
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

    it('should reduce position size in volatile markets', () => {
        const config = {
            ...baseConfig,
            useMarketRegime: true,
            reduceInVolatile: true,
            volatileReduction: 0.5
        };

        const strategy = new TradingStrategy(config);
        const marketRegime = {
            regime: 'VOLATILE' as const,
            adxTrend: 30,
            atrVolatility: 85,
            confidence: 0.8
        };

        const multiplier = strategy.calculatePositionSizeMultiplier(marketRegime);
        expect(multiplier).toBe(0.5);
    });

    it('should use full position size in trending markets', () => {
        const config = {
            ...baseConfig,
            useMarketRegime: true,
            reduceInVolatile: true,
            volatileReduction: 0.5
        };

        const strategy = new TradingStrategy(config);
        const marketRegime = {
            regime: 'TRENDING' as const,
            adxTrend: 35,
            atrVolatility: 50,
            confidence: 0.9
        };

        const multiplier = strategy.calculatePositionSizeMultiplier(marketRegime);
        expect(multiplier).toBe(1.0);
    });

    it('should use full position size when market regime is disabled', () => {
        const config = {
            ...baseConfig,
            useMarketRegime: false
        };

        const strategy = new TradingStrategy(config);
        const marketRegime = {
            regime: 'VOLATILE' as const,
            adxTrend: 30,
            atrVolatility: 85,
            confidence: 0.8
        };

        const multiplier = strategy.calculatePositionSizeMultiplier(marketRegime);
        expect(multiplier).toBe(1.0);
    });
});
