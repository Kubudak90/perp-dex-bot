// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6D TESTS
// Performance Metrics & Optimization Tools
// ═══════════════════════════════════════════════════════════════════════════

import { PerformanceCalculator } from '../src/utils/performance';
import { TradeResult } from '../src/types';

describe('Performance Metrics Calculator', () => {
    const initialEquity = 10000;

    it('should handle empty trade list', () => {
        const metrics = PerformanceCalculator.calculateMetrics([], initialEquity);

        expect(metrics.totalTrades).toBe(0);
        expect(metrics.winRate).toBe(0);
        expect(metrics.totalPnl).toBe(0);
        expect(metrics.finalEquity).toBe(initialEquity);
        expect(metrics.maxDrawdown).toBe(0);
    });

    it('should calculate basic metrics correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 100, pnlPercent: 10, duration: 3600000, exitReason: 'TP' },
            { side: 'SHORT', entryPrice: 110, exitPrice: 105, pnl: 50, pnlPercent: 5, duration: 1800000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 105, exitPrice: 100, pnl: -50, pnlPercent: -5, duration: 900000, exitReason: 'SL' },
            { side: 'SHORT', entryPrice: 100, exitPrice: 110, pnl: -100, pnlPercent: -10, duration: 2700000, exitReason: 'SL' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        expect(metrics.totalTrades).toBe(4);
        expect(metrics.winningTrades).toBe(2);
        expect(metrics.losingTrades).toBe(2);
        expect(metrics.winRate).toBe(50);
        expect(metrics.totalPnl).toBe(0); // 100 + 50 - 50 - 100
        expect(metrics.totalPnlPercent).toBe(0);
    });

    it('should calculate profit factor correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 200, pnlPercent: 2, duration: 3600000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 110, exitPrice: 115, pnl: 100, pnlPercent: 1, duration: 1800000, exitReason: 'TP' },
            { side: 'SHORT', entryPrice: 115, exitPrice: 120, pnl: -50, pnlPercent: -0.5, duration: 900000, exitReason: 'SL' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        // Gross profit = 300, Gross loss = 50, PF = 6.0
        expect(metrics.profitFactor).toBeCloseTo(6.0, 1);
        expect(metrics.avgWin).toBeCloseTo(150, 0);
        expect(metrics.avgLoss).toBeCloseTo(-50, 0);
    });

    it('should calculate maximum drawdown correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 500, pnlPercent: 5, duration: 3600000, exitReason: 'TP' },   // 10000 -> 10500
            { side: 'LONG', entryPrice: 110, exitPrice: 105, pnl: -300, pnlPercent: -3, duration: 1800000, exitReason: 'SL' }, // 10500 -> 10200
            { side: 'SHORT', entryPrice: 105, exitPrice: 110, pnl: -400, pnlPercent: -4, duration: 900000, exitReason: 'SL' }, // 10200 -> 9800
            { side: 'LONG', entryPrice: 110, exitPrice: 115, pnl: 600, pnlPercent: 6, duration: 2700000, exitReason: 'TP' }    // 9800 -> 10400
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        // Peak = 10500, trough = 9800, drawdown = 700 (6.67%)
        expect(metrics.maxDrawdown).toBeCloseTo(700, 0);
        expect(metrics.maxDrawdownPercent).toBeCloseTo(6.67, 1);
    });

    it('should calculate Sharpe ratio correctly', () => {
        // Consistent positive returns should have good Sharpe
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 102, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 102, exitPrice: 104, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 104, exitPrice: 106, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 106, exitPrice: 108, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        expect(metrics.sharpeRatio).toBeGreaterThan(0);
        expect(metrics.totalPnl).toBe(400);
    });

    it('should calculate win/loss streaks correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },  // Win 1
            { side: 'LONG', entryPrice: 110, exitPrice: 115, pnl: 50, pnlPercent: 0.5, duration: 1800000, exitReason: 'TP' },  // Win 2
            { side: 'LONG', entryPrice: 115, exitPrice: 120, pnl: 50, pnlPercent: 0.5, duration: 900000, exitReason: 'TP' },   // Win 3
            { side: 'SHORT', entryPrice: 120, exitPrice: 125, pnl: -50, pnlPercent: -0.5, duration: 2700000, exitReason: 'SL' }, // Loss 1
            { side: 'SHORT', entryPrice: 125, exitPrice: 130, pnl: -50, pnlPercent: -0.5, duration: 1800000, exitReason: 'SL' }, // Loss 2
            { side: 'LONG', entryPrice: 130, exitPrice: 135, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' }   // Win 1
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        expect(metrics.maxConsecutiveWins).toBe(3);
        expect(metrics.maxConsecutiveLosses).toBe(2);
    });

    it('should calculate average trade duration correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },  // 1 hour
            { side: 'LONG', entryPrice: 110, exitPrice: 115, pnl: 50, pnlPercent: 0.5, duration: 7200000, exitReason: 'TP' }   // 2 hours
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        // Average = (1 + 2) / 2 = 1.5 hours
        expect(metrics.avgTradeDuration).toBeCloseTo(1.5, 1);
    });

    it('should calculate expectancy correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },
            { side: 'SHORT', entryPrice: 110, exitPrice: 115, pnl: -50, pnlPercent: -0.5, duration: 1800000, exitReason: 'SL' },
            { side: 'LONG', entryPrice: 115, exitPrice: 125, pnl: 150, pnlPercent: 1.5, duration: 2700000, exitReason: 'TP' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        // Expectancy = (100 - 50 + 150) / 3 = 66.67
        expect(metrics.expectancy).toBeCloseTo(66.67, 1);
    });

    it('should calculate Sortino ratio correctly', () => {
        // Should penalize only downside volatility
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 110, exitPrice: 120, pnl: 200, pnlPercent: 2, duration: 3600000, exitReason: 'TP' },
            { side: 'SHORT', entryPrice: 120, exitPrice: 125, pnl: -50, pnlPercent: -0.5, duration: 1800000, exitReason: 'SL' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        expect(metrics.sortinoRatio).toBeGreaterThan(0);
        // Sortino should be higher than Sharpe for strategies with positive skew
        expect(metrics.sortinoRatio).toBeGreaterThanOrEqual(metrics.sharpeRatio);
    });

    it('should calculate recovery factor correctly', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 500, pnlPercent: 5, duration: 3600000, exitReason: 'TP' },   // 10000 -> 10500
            { side: 'SHORT', entryPrice: 110, exitPrice: 115, pnl: -300, pnlPercent: -3, duration: 1800000, exitReason: 'SL' }, // 10500 -> 10200 (DD = 300 from peak)
            { side: 'LONG', entryPrice: 115, exitPrice: 120, pnl: 300, pnlPercent: 3, duration: 2700000, exitReason: 'TP' }    // 10200 -> 10500
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        // Net profit = 500, Max DD = 300, Recovery = 500/300 = 1.67
        expect(metrics.totalPnl).toBe(500);
        expect(metrics.recoveryFactor).toBeCloseTo(1.67, 1);
    });

    it('should handle all winning trades', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 110, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' },
            { side: 'LONG', entryPrice: 110, exitPrice: 120, pnl: 100, pnlPercent: 1, duration: 3600000, exitReason: 'TP' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        expect(metrics.winRate).toBe(100);
        expect(metrics.losingTrades).toBe(0);
        expect(metrics.profitFactor).toBeGreaterThan(0); // Should be Infinity or very large
    });

    it('should handle all losing trades', () => {
        const trades: TradeResult[] = [
            { side: 'LONG', entryPrice: 100, exitPrice: 90, pnl: -100, pnlPercent: -1, duration: 3600000, exitReason: 'SL' },
            { side: 'SHORT', entryPrice: 90, exitPrice: 100, pnl: -100, pnlPercent: -1, duration: 3600000, exitReason: 'SL' }
        ];

        const metrics = PerformanceCalculator.calculateMetrics(trades, initialEquity);

        expect(metrics.winRate).toBe(0);
        expect(metrics.winningTrades).toBe(0);
        expect(metrics.profitFactor).toBe(0);
        expect(metrics.totalPnl).toBe(-200);
    });
});
