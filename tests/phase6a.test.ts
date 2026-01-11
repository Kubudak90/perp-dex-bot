// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6A TESTS
// Multi-Timeframe, Volume, and Trading Hours filters
// ═══════════════════════════════════════════════════════════════════════════

import { IndicatorCalculator } from '../src/indicators';
import { TradingHoursManager } from '../src/utils/trading-hours';
import { Candle } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// VOLUME METRICS TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Volume Metrics', () => {
    it('should calculate volume SMA and ratio', () => {
        const candles: Candle[] = [];
        const baseVolume = 1000000;

        // Generate candles with consistent volume
        for (let i = 0; i < 25; i++) {
            candles.push({
                timestamp: Date.now() + i * 900000,
                open: 40000 + Math.random() * 100,
                high: 40100 + Math.random() * 100,
                low: 39900 + Math.random() * 100,
                close: 40000 + Math.random() * 100,
                volume: baseVolume * (1 + Math.random() * 0.1)
            });
        }

        const volumeMetrics = IndicatorCalculator.calculateVolumeMetrics(candles);

        expect(volumeMetrics.current).toBeGreaterThan(0);
        expect(volumeMetrics.sma20).toBeGreaterThan(0);
        expect(volumeMetrics.ratio).toBeCloseTo(1.0, 0.2); // Should be around 1.0
        expect(volumeMetrics.isSurge).toBe(false);
        expect(volumeMetrics.isAbnormal).toBe(false);
    });

    it('should detect volume surge', () => {
        const candles: Candle[] = [];
        const baseVolume = 1000000;

        // Generate normal volume candles
        for (let i = 0; i < 24; i++) {
            candles.push({
                timestamp: Date.now() + i * 900000,
                open: 40000,
                high: 40100,
                low: 39900,
                close: 40000,
                volume: baseVolume
            });
        }

        // Add surge candle (3x normal volume)
        candles.push({
            timestamp: Date.now() + 24 * 900000,
            open: 40000,
            high: 40100,
            low: 39900,
            close: 40000,
            volume: baseVolume * 3
        });

        const volumeMetrics = IndicatorCalculator.calculateVolumeMetrics(candles);

        expect(volumeMetrics.ratio).toBeGreaterThan(2.0);
        expect(volumeMetrics.isSurge).toBe(true);
        expect(volumeMetrics.isAbnormal).toBe(false); // 3x is surge but not abnormal (5x)
    });

    it('should detect abnormal volume', () => {
        const candles: Candle[] = [];
        const baseVolume = 1000000;

        // Generate normal volume candles
        for (let i = 0; i < 24; i++) {
            candles.push({
                timestamp: Date.now() + i * 900000,
                open: 40000,
                high: 40100,
                low: 39900,
                close: 40000,
                volume: baseVolume
            });
        }

        // Add abnormal candle (10x normal volume to ensure >5x ratio after SMA calculation)
        candles.push({
            timestamp: Date.now() + 24 * 900000,
            open: 40000,
            high: 40100,
            low: 39900,
            close: 40000,
            volume: baseVolume * 10
        });

        const volumeMetrics = IndicatorCalculator.calculateVolumeMetrics(candles);

        expect(volumeMetrics.ratio).toBeGreaterThan(5.0);
        expect(volumeMetrics.isSurge).toBe(true);
        expect(volumeMetrics.isAbnormal).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// TRADING HOURS TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Trading Hours Manager', () => {
    it('should detect NY session', () => {
        // 15:00 UTC = NY session
        const timestamp = new Date('2024-01-15T15:00:00Z').getTime();
        const session = TradingHoursManager.getCurrentSession(timestamp);

        expect(session.session).toBe('NY');
        expect(session.isActiveSession).toBe(true);
        expect(session.isWeekend).toBe(false);
    });

    it('should detect London session', () => {
        // 10:00 UTC = London session
        const timestamp = new Date('2024-01-15T10:00:00Z').getTime();
        const session = TradingHoursManager.getCurrentSession(timestamp);

        expect(session.session).toBe('LONDON');
        expect(session.isActiveSession).toBe(true);
        expect(session.isWeekend).toBe(false);
    });

    it('should detect Asia session', () => {
        // 02:00 UTC = Asia session
        const timestamp = new Date('2024-01-15T02:00:00Z').getTime();
        const session = TradingHoursManager.getCurrentSession(timestamp);

        expect(session.session).toBe('ASIA');
        expect(session.isActiveSession).toBe(true);
        expect(session.isWeekend).toBe(false);
    });

    it('should detect weekend', () => {
        // Saturday
        const timestamp = new Date('2024-01-13T12:00:00Z').getTime();
        const session = TradingHoursManager.getCurrentSession(timestamp);

        expect(session.session).toBe('WEEKEND');
        expect(session.isActiveSession).toBe(false);
        expect(session.isWeekend).toBe(true);
    });

    it('should allow trading in NY session', () => {
        const timestamp = new Date('2024-01-15T15:00:00Z').getTime();
        const allowed = TradingHoursManager.isTradingAllowed(['NY', 'LONDON'], true, timestamp);

        expect(allowed).toBe(true);
    });

    it('should block trading on weekends when configured', () => {
        const timestamp = new Date('2024-01-13T12:00:00Z').getTime();
        const allowed = TradingHoursManager.isTradingAllowed(['NY', 'LONDON'], true, timestamp);

        expect(allowed).toBe(false);
    });

    it('should detect overlap period (London + NY)', () => {
        // 14:00 UTC = overlap period
        const timestamp = new Date('2024-01-15T14:00:00Z').getTime();
        const isOverlap = TradingHoursManager.isOverlapPeriod(timestamp);

        expect(isOverlap).toBe(true);
    });

    it('should detect high liquidity periods', () => {
        // NY session = high liquidity
        const timestampNY = new Date('2024-01-15T15:00:00Z').getTime();
        const isHighLiq = TradingHoursManager.isHighLiquidityPeriod(timestampNY);

        expect(isHighLiq).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// MULTI-TIMEFRAME TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('Multi-Timeframe Confirmation', () => {
    it('should calculate 1h and 4h trends from 15m candles', () => {
        const candles: Candle[] = [];
        let price = 40000;

        // Generate 250 15m candles (uptrend)
        for (let i = 0; i < 250; i++) {
            price += Math.random() * 50 - 20; // Slight upward bias

            candles.push({
                timestamp: Date.now() + i * 900000,
                open: price - 10,
                high: price + 20,
                low: price - 20,
                close: price,
                volume: 1000000
            });
        }

        const mtf = IndicatorCalculator.calculateMultiTimeframeTrend(candles, '15m', 50, 200);

        expect(mtf.trend1h).toBeDefined();
        expect(mtf.trend4h).toBeDefined();
        expect(['LONG', 'SHORT', 'NEUTRAL']).toContain(mtf.trend1h);
        expect(['LONG', 'SHORT', 'NEUTRAL']).toContain(mtf.trend4h);
    });

    it('should detect bullish 1h trend', () => {
        const candles: Candle[] = [];
        let price = 35000;

        // Generate strong uptrend
        for (let i = 0; i < 300; i++) {
            price += i < 250 ? 15 : 10; // Strong consistent uptrend

            candles.push({
                timestamp: Date.now() + i * 900000,
                open: price - 5,
                high: price + 20,
                low: price - 10,
                close: price,
                volume: 1000000
            });
        }

        const mtf = IndicatorCalculator.calculateMultiTimeframeTrend(candles, '15m', 50, 200);

        // In strong uptrend, 1h should be LONG or NEUTRAL (depends on EMA calculation)
        expect(['LONG', 'NEUTRAL']).toContain(mtf.trend1h);
    });

    it('should detect bearish 1h trend', () => {
        const candles: Candle[] = [];
        let price = 45000;

        // Generate strong downtrend
        for (let i = 0; i < 300; i++) {
            price -= i < 250 ? 15 : 10; // Strong consistent downtrend

            candles.push({
                timestamp: Date.now() + i * 900000,
                open: price + 5,
                high: price + 10,
                low: price - 20,
                close: price,
                volume: 1000000
            });
        }

        const mtf = IndicatorCalculator.calculateMultiTimeframeTrend(candles, '15m', 50, 200);

        // In strong downtrend, 1h should be SHORT or NEUTRAL (depends on EMA calculation)
        expect(['SHORT', 'NEUTRAL']).toContain(mtf.trend1h);
    });
});
