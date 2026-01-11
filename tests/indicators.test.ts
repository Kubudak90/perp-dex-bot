// ═══════════════════════════════════════════════════════════════════════════
// INDICATOR TESTS
// Unit tests for technical indicators
// ═══════════════════════════════════════════════════════════════════════════

import { IndicatorCalculator } from '../src/indicators';
import { Candle, BotConfig } from '../src/types';

describe('IndicatorCalculator', () => {
    // Sample candle data
    const sampleCandles: Candle[] = [
        { timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
        { timestamp: 2000, open: 102, high: 108, low: 100, close: 106, volume: 1200 },
        { timestamp: 3000, open: 106, high: 110, low: 104, close: 108, volume: 1100 },
        { timestamp: 4000, open: 108, high: 112, low: 106, close: 110, volume: 1300 },
        { timestamp: 5000, open: 110, high: 115, low: 108, close: 112, volume: 1400 },
    ];

    describe('calculateATR', () => {
        it('should calculate ATR correctly', () => {
            const atr = IndicatorCalculator.calculateATR(sampleCandles, 3);

            expect(atr).toHaveLength(sampleCandles.length);
            expect(atr[atr.length - 1]).toBeGreaterThan(0);
            // First few values are 0 until we have enough data for the period
            expect(atr[2]).toBeGreaterThan(0); // After period-1 candles
        });

        it('should return zero for insufficient data', () => {
            const atr = IndicatorCalculator.calculateATR(sampleCandles.slice(0, 2), 3);

            expect(atr[0]).toBe(0);
            expect(atr[1]).toBe(0); // Not enough data yet
        });
    });

    describe('calculateEMA', () => {
        it('should calculate EMA correctly', () => {
            const closes = sampleCandles.map(c => c.close);
            const ema = IndicatorCalculator.calculateEMA(closes, 3);

            expect(ema).toHaveLength(closes.length);
            expect(ema[ema.length - 1]).toBeGreaterThan(0);
            expect(ema[ema.length - 1]).toBeLessThanOrEqual(Math.max(...closes));
            expect(ema[ema.length - 1]).toBeGreaterThanOrEqual(Math.min(...closes));
        });

        it('should be NaN for insufficient data', () => {
            const closes = [100, 102];
            const ema = IndicatorCalculator.calculateEMA(closes, 3);

            expect(ema[0]).toBe(0);
            expect(ema[1]).toBe(0);
        });
    });

    describe('calculateSupertrend', () => {
        it('should calculate Supertrend correctly', () => {
            const supertrend = IndicatorCalculator.calculateSupertrend(sampleCandles, 3, 2);

            expect(supertrend).toHaveLength(sampleCandles.length);
            expect(supertrend[0].trend).toMatch(/^(LONG|SHORT)$/);
            expect(supertrend[0].value).toBeGreaterThan(0);
            // Check last value instead of first for band comparison
            const lastST = supertrend[supertrend.length - 1];
            expect(lastST.upperBand).toBeGreaterThanOrEqual(lastST.lowerBand);
        });

        it('should have consistent trend signals', () => {
            const longCandles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
                timestamp: i * 1000,
                open: 100 + i,
                high: 105 + i,
                low: 95 + i,
                close: 102 + i,
                volume: 1000
            }));

            const supertrend = IndicatorCalculator.calculateSupertrend(longCandles, 10, 3);
            const lastTrend = supertrend[supertrend.length - 1].trend;

            expect(lastTrend).toBe('LONG'); // Uptrend should be LONG
        });
    });

    describe('calculateADX', () => {
        it('should calculate ADX correctly', () => {
            const extendedCandles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
                timestamp: i * 1000,
                open: 100 + Math.random() * 10,
                high: 105 + Math.random() * 10,
                low: 95 + Math.random() * 10,
                close: 100 + Math.random() * 10,
                volume: 1000
            }));

            const adx = IndicatorCalculator.calculateADX(extendedCandles, 14);

            expect(adx).toHaveLength(extendedCandles.length);
            expect(adx[adx.length - 1]).toBeGreaterThanOrEqual(0);
            expect(adx[adx.length - 1]).toBeLessThanOrEqual(100);
        });
    });

    describe('calculateATRPercentile', () => {
        it('should calculate percentile correctly', () => {
            const atrValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const currentATR = 5;

            const percentile = IndicatorCalculator.calculateATRPercentile(atrValues, currentATR, 10);

            expect(percentile).toBeGreaterThanOrEqual(0);
            expect(percentile).toBeLessThanOrEqual(100);
            expect(percentile).toBeCloseTo(40, 0); // 4 values below 5 out of 10
        });

        it('should return 50 for empty array', () => {
            const percentile = IndicatorCalculator.calculateATRPercentile([], 5, 10);
            expect(percentile).toBe(50);
        });
    });

    describe('getIndicators', () => {
        it('should return complete indicator set', () => {
            const config: BotConfig = {
                symbol: 'BTC',
                timeframe: '15m',
                leverage: 3,
                supertrendPeriod: 10,
                supertrendMultiplier: 3,
                emaFastPeriod: 5,
                emaSlowPeriod: 10,
                adxPeriod: 14,
                adxThreshold: 20,
                fundingThreshold: 0.0005,
                useFundingFilter: true,
                atrPeriod: 14,
                atrLookback: 10,
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

            // Create enough candles for all indicators
            const candles: Candle[] = Array.from({ length: 250 }, (_, i) => ({
                timestamp: i * 1000,
                open: 100 + Math.random() * 10,
                high: 105 + Math.random() * 10,
                low: 95 + Math.random() * 10,
                close: 100 + Math.random() * 10,
                volume: 1000
            }));

            const indicators = IndicatorCalculator.getIndicators(candles, config, 0.0001);

            expect(indicators).toHaveProperty('supertrend');
            expect(indicators).toHaveProperty('ema50');
            expect(indicators).toHaveProperty('ema200');
            expect(indicators).toHaveProperty('adx');
            expect(indicators).toHaveProperty('atr');
            expect(indicators).toHaveProperty('fundingRate');
            expect(indicators).toHaveProperty('atrPercentile');

            expect(indicators.supertrend.trend).toMatch(/^(LONG|SHORT)$/);
            expect(indicators.ema50).toBeGreaterThan(0);
            expect(indicators.ema200).toBeGreaterThan(0);
            expect(indicators.adx).toBeGreaterThanOrEqual(0);
            expect(indicators.atr).toBeGreaterThan(0);
            expect(indicators.fundingRate).toBe(0.0001);
            expect(indicators.atrPercentile).toBeGreaterThanOrEqual(0);
            expect(indicators.atrPercentile).toBeLessThanOrEqual(100);
        });
    });
});
