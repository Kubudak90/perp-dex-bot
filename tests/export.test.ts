// ═══════════════════════════════════════════════════════════════════════════
// EXPORT & ANALYTICS TESTS
// ═══════════════════════════════════════════════════════════════════════════

import {
    tradesToCSV,
    tradesToJSON,
    generatePerformanceReport,
    filterTradesByDateRange,
    filterTradesBySide,
    filterTradesByStrategy
} from '../src/utils/export';
import { TradeResult } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// TEST DATA
// ─────────────────────────────────────────────────────────────────────────
const mockTrades: TradeResult[] = [
    {
        id: 'trade1',
        side: 'LONG',
        entryPrice: 50000,
        exitPrice: 52000,
        size: 0.1,
        pnl: 200,
        pnlPercent: 4,
        entryTime: Date.now() - 86400000 * 5, // 5 days ago
        exitTime: Date.now() - 86400000 * 5 + 3600000,
        duration: 3600000,
        exitReason: 'TP',
        strategy: 'SUPERTREND',
        fees: 1
    },
    {
        id: 'trade2',
        side: 'SHORT',
        entryPrice: 52000,
        exitPrice: 50000,
        size: 0.2,
        pnl: 400,
        pnlPercent: 3.85,
        entryTime: Date.now() - 86400000 * 4,
        exitTime: Date.now() - 86400000 * 4 + 7200000,
        duration: 7200000,
        exitReason: 'TP',
        strategy: 'BREAKOUT',
        fees: 2
    },
    {
        id: 'trade3',
        side: 'LONG',
        entryPrice: 51000,
        exitPrice: 49000,
        size: 0.15,
        pnl: -300,
        pnlPercent: -3.92,
        entryTime: Date.now() - 86400000 * 3,
        exitTime: Date.now() - 86400000 * 3 + 1800000,
        duration: 1800000,
        exitReason: 'SL',
        strategy: 'SUPERTREND',
        fees: 1.5
    },
    {
        id: 'trade4',
        side: 'LONG',
        entryPrice: 48000,
        exitPrice: 51000,
        size: 0.1,
        pnl: 300,
        pnlPercent: 6.25,
        entryTime: Date.now() - 86400000 * 2,
        exitTime: Date.now() - 86400000 * 2 + 10800000,
        duration: 10800000,
        exitReason: 'SIGNAL',
        strategy: 'MOMENTUM'
    },
    {
        id: 'trade5',
        side: 'SHORT',
        entryPrice: 51000,
        exitPrice: 52500,
        size: 0.1,
        pnl: -150,
        pnlPercent: -2.94,
        entryTime: Date.now() - 86400000,
        exitTime: Date.now() - 86400000 + 5400000,
        duration: 5400000,
        exitReason: 'SL',
        strategy: 'BREAKOUT'
    }
];

describe('tradesToCSV', () => {
    it('should generate CSV with headers', () => {
        const csv = tradesToCSV(mockTrades, true);
        const lines = csv.split('\n');

        expect(lines[0]).toContain('ID');
        expect(lines[0]).toContain('Side');
        expect(lines[0]).toContain('Entry Price');
    });

    it('should generate CSV without headers', () => {
        const csv = tradesToCSV(mockTrades, false);
        const lines = csv.split('\n');

        expect(lines[0]).not.toContain('ID,Side');
    });

    it('should include all trades', () => {
        const csv = tradesToCSV(mockTrades, true);
        const lines = csv.split('\n').filter(l => l.trim());

        expect(lines.length).toBe(mockTrades.length + 1); // +1 for header
    });

    it('should format prices correctly', () => {
        const csv = tradesToCSV(mockTrades, true);

        expect(csv).toContain('50000.00');
        expect(csv).toContain('52000.00');
    });

    it('should include exit reason', () => {
        const csv = tradesToCSV(mockTrades, true);

        expect(csv).toContain('TP');
        expect(csv).toContain('SL');
        expect(csv).toContain('SIGNAL');
    });

    it('should include strategy', () => {
        const csv = tradesToCSV(mockTrades, true);

        expect(csv).toContain('SUPERTREND');
        expect(csv).toContain('BREAKOUT');
    });

    it('should handle empty trades array', () => {
        const csv = tradesToCSV([], true);

        expect(csv).toBe('No trades to export');
    });

    it('should handle trades without optional fields', () => {
        const minimalTrade: TradeResult = {
            side: 'LONG',
            entryPrice: 50000,
            exitPrice: 51000,
            pnl: 100,
            pnlPercent: 2,
            duration: 3600000,
            exitReason: 'TP'
        };

        const csv = tradesToCSV([minimalTrade], true);
        expect(csv).toBeDefined();
        expect(csv.length).toBeGreaterThan(0);
    });
});

describe('tradesToJSON', () => {
    it('should return valid JSON structure', () => {
        const json = tradesToJSON(mockTrades);

        expect(json).toHaveProperty('exportedAt');
        expect(json).toHaveProperty('totalTrades');
        expect(json).toHaveProperty('dateRange');
        expect(json).toHaveProperty('summary');
        expect(json).toHaveProperty('trades');
    });

    it('should include correct total trades', () => {
        const json = tradesToJSON(mockTrades);
        expect(json.totalTrades).toBe(mockTrades.length);
    });

    it('should calculate correct total PnL', () => {
        const json = tradesToJSON(mockTrades);
        const expectedPnl = mockTrades.reduce((sum, t) => sum + t.pnl, 0);

        expect(json.summary.totalPnl).toBe(expectedPnl);
    });

    it('should calculate win rate', () => {
        const json = tradesToJSON(mockTrades);
        const wins = mockTrades.filter(t => t.pnl > 0).length;
        const expectedWinRate = (wins / mockTrades.length) * 100;

        expect(json.summary.winRate).toBeCloseTo(expectedWinRate, 1);
    });

    it('should calculate profit factor', () => {
        const json = tradesToJSON(mockTrades);
        expect(json.summary.profitFactor).toBeGreaterThan(0);
    });

    it('should include date range', () => {
        const json = tradesToJSON(mockTrades);

        expect(json.dateRange.from).toBeDefined();
        expect(json.dateRange.to).toBeDefined();
    });

    it('should include all trades', () => {
        const json = tradesToJSON(mockTrades);
        expect(json.trades).toHaveLength(mockTrades.length);
    });

    it('should handle empty trades array', () => {
        const json = tradesToJSON([]);

        expect(json.totalTrades).toBe(0);
        expect(json.trades).toHaveLength(0);
    });

    it('should calculate average win', () => {
        const json = tradesToJSON(mockTrades);
        const wins = mockTrades.filter(t => t.pnl > 0);
        const expectedAvgWin = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length;

        expect(json.summary.avgWin).toBeCloseTo(expectedAvgWin, 2);
    });

    it('should calculate average loss', () => {
        const json = tradesToJSON(mockTrades);
        const losses = mockTrades.filter(t => t.pnl <= 0);
        const expectedAvgLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0)) / losses.length;

        expect(json.summary.avgLoss).toBeCloseTo(expectedAvgLoss, 2);
    });
});

describe('generatePerformanceReport', () => {
    it('should generate valid report structure', () => {
        const report = generatePerformanceReport(mockTrades, 10000);

        expect(report).toHaveProperty('period');
        expect(report).toHaveProperty('metrics');
        expect(report).toHaveProperty('equityCurve');
        expect(report).toHaveProperty('drawdownCurve');
    });

    it('should calculate correct metrics', () => {
        const report = generatePerformanceReport(mockTrades, 10000);

        expect(report.metrics.totalTrades).toBe(mockTrades.length);
        expect(report.metrics.winRate).toBeGreaterThan(0);
        expect(report.metrics.winRate).toBeLessThan(100);
    });

    it('should calculate win/loss counts', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        const wins = mockTrades.filter(t => t.pnl > 0).length;
        const losses = mockTrades.filter(t => t.pnl <= 0).length;

        expect(report.metrics.winningTrades).toBe(wins);
        expect(report.metrics.losingTrades).toBe(losses);
    });

    it('should track long/short PnL', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        const longPnl = mockTrades.filter(t => t.side === 'LONG').reduce((sum, t) => sum + t.pnl, 0);
        const shortPnl = mockTrades.filter(t => t.side === 'SHORT').reduce((sum, t) => sum + t.pnl, 0);

        expect(report.metrics.longPnl).toBe(longPnl);
        expect(report.metrics.shortPnl).toBe(shortPnl);
    });

    it('should calculate max drawdown', () => {
        const report = generatePerformanceReport(mockTrades, 10000);

        expect(report.metrics.maxDrawdown).toBeDefined();
        expect(report.metrics.maxDrawdownPercent).toBeDefined();
    });

    it('should calculate Sharpe ratio', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        expect(report.metrics.sharpeRatio).toBeDefined();
    });

    it('should calculate Sortino ratio', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        expect(report.metrics.sortinoRatio).toBeDefined();
    });

    it('should calculate profit factor', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        expect(report.metrics.profitFactor).toBeGreaterThan(0);
    });

    it('should track consecutive wins/losses', () => {
        const report = generatePerformanceReport(mockTrades, 10000);

        expect(report.metrics.maxConsecutiveWins).toBeDefined();
        expect(report.metrics.maxConsecutiveLosses).toBeDefined();
    });

    it('should calculate expectancy', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        expect(report.metrics.expectancy).toBeDefined();
    });

    it('should calculate average trade duration', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        expect(report.metrics.avgTradeDuration).toBeGreaterThan(0);
    });

    it('should include equity curve', () => {
        const report = generatePerformanceReport(mockTrades, 10000);

        expect(report.equityCurve).toBeDefined();
        expect(report.equityCurve.length).toBeGreaterThan(0);
    });

    it('should calculate final equity correctly', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        const totalPnl = mockTrades.reduce((sum, t) => sum + t.pnl, 0);
        const finalEquity = report.equityCurve[report.equityCurve.length - 1].equity;

        expect(finalEquity).toBeCloseTo(10000 + totalPnl, 2);
    });

    it('should handle custom period label', () => {
        const report = generatePerformanceReport(mockTrades, 10000, 'Last 7 Days');
        expect(report.period).toBe('Last 7 Days');
    });

    it('should handle empty trades', () => {
        const report = generatePerformanceReport([], 10000);

        expect(report.metrics.totalTrades).toBe(0);
        expect(report.metrics.winRate).toBe(0);
        expect(report.equityCurve).toHaveLength(0);
    });

    it('should calculate total PnL', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        const totalPnl = mockTrades.reduce((sum, t) => sum + t.pnl, 0);

        expect(report.metrics.totalPnl).toBeCloseTo(totalPnl, 2);
    });

    it('should track largest win and loss', () => {
        const report = generatePerformanceReport(mockTrades, 10000);

        expect(report.metrics.largestWin).toBe(400);
        expect(report.metrics.largestLoss).toBe(-300);
    });

    it('should track equity curve', () => {
        const report = generatePerformanceReport(mockTrades, 10000);
        const peakEquity = Math.max(...report.equityCurve.map(e => e.equity));
        expect(peakEquity).toBeGreaterThanOrEqual(10000);
    });
});

describe('filterTradesByDateRange', () => {
    it('should filter trades within date range', () => {
        const startDate = new Date(Date.now() - 86400000 * 4);
        const endDate = new Date(Date.now() - 86400000 * 2);

        const filtered = filterTradesByDateRange(mockTrades, startDate, endDate);

        expect(filtered.length).toBeLessThan(mockTrades.length);
        expect(filtered.length).toBeGreaterThan(0);
    });

    it('should include all trades when no dates specified', () => {
        const filtered = filterTradesByDateRange(mockTrades);
        expect(filtered.length).toBe(mockTrades.length);
    });

    it('should filter with only start date', () => {
        const startDate = new Date(Date.now() - 86400000 * 2);
        const filtered = filterTradesByDateRange(mockTrades, startDate);

        filtered.forEach(trade => {
            if (trade.entryTime) {
                expect(trade.entryTime).toBeGreaterThanOrEqual(startDate.getTime());
            }
        });
    });

    it('should filter with only end date', () => {
        const endDate = new Date(Date.now() - 86400000 * 3);
        const filtered = filterTradesByDateRange(mockTrades, undefined, endDate);

        filtered.forEach(trade => {
            if (trade.entryTime) {
                expect(trade.entryTime).toBeLessThanOrEqual(endDate.getTime());
            }
        });
    });

    it('should return empty array when no trades match', () => {
        const startDate = new Date(Date.now() + 86400000); // Future
        const filtered = filterTradesByDateRange(mockTrades, startDate);

        expect(filtered.length).toBe(0);
    });

    it('should include trades without entryTime', () => {
        const tradesWithMissingTime: TradeResult[] = [
            ...mockTrades,
            {
                side: 'LONG',
                entryPrice: 50000,
                exitPrice: 51000,
                pnl: 100,
                pnlPercent: 2,
                duration: 3600000,
                exitReason: 'TP'
                // No entryTime
            }
        ];

        const filtered = filterTradesByDateRange(tradesWithMissingTime, new Date());
        expect(filtered.some(t => !t.entryTime)).toBe(true);
    });
});

describe('filterTradesBySide', () => {
    it('should filter LONG trades', () => {
        const filtered = filterTradesBySide(mockTrades, 'LONG');

        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every(t => t.side === 'LONG')).toBe(true);
    });

    it('should filter SHORT trades', () => {
        const filtered = filterTradesBySide(mockTrades, 'SHORT');

        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every(t => t.side === 'SHORT')).toBe(true);
    });

    it('should return correct count of LONG trades', () => {
        const filtered = filterTradesBySide(mockTrades, 'LONG');
        const expected = mockTrades.filter(t => t.side === 'LONG').length;

        expect(filtered.length).toBe(expected);
    });

    it('should return empty array for side with no trades', () => {
        const onlyLongs: TradeResult[] = mockTrades.filter(t => t.side === 'LONG');
        const filtered = filterTradesBySide(onlyLongs, 'SHORT');

        expect(filtered.length).toBe(0);
    });
});

describe('filterTradesByStrategy', () => {
    it('should filter by strategy', () => {
        const filtered = filterTradesByStrategy(mockTrades, 'SUPERTREND');

        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every(t => t.strategy === 'SUPERTREND')).toBe(true);
    });

    it('should return correct count for strategy', () => {
        const filtered = filterTradesByStrategy(mockTrades, 'BREAKOUT');
        const expected = mockTrades.filter(t => t.strategy === 'BREAKOUT').length;

        expect(filtered.length).toBe(expected);
    });

    it('should return empty for non-existent strategy', () => {
        const filtered = filterTradesByStrategy(mockTrades, 'NONEXISTENT');
        expect(filtered.length).toBe(0);
    });
});

describe('Edge Cases', () => {
    it('should handle all winning trades', () => {
        const winningTrades: TradeResult[] = mockTrades
            .filter(t => t.pnl > 0)
            .map(t => ({ ...t }));

        const report = generatePerformanceReport(winningTrades, 10000);

        expect(report.metrics.winRate).toBe(100);
        expect(report.metrics.losingTrades).toBe(0);
    });

    it('should handle all losing trades', () => {
        const losingTrades: TradeResult[] = mockTrades
            .filter(t => t.pnl <= 0)
            .map(t => ({ ...t }));

        const report = generatePerformanceReport(losingTrades, 10000);

        expect(report.metrics.winRate).toBe(0);
        expect(report.metrics.winningTrades).toBe(0);
    });

    it('should handle single trade', () => {
        const singleTrade: TradeResult[] = [mockTrades[0]];

        const report = generatePerformanceReport(singleTrade, 10000);

        expect(report.metrics.totalTrades).toBe(1);
        expect(report.metrics.maxConsecutiveWins).toBe(1);
    });

    it('should handle very large PnL values', () => {
        const largeTrade: TradeResult = {
            ...mockTrades[0],
            pnl: 1000000,
            pnlPercent: 100
        };

        const report = generatePerformanceReport([largeTrade], 10000);
        const finalEquity = report.equityCurve[report.equityCurve.length - 1].equity;
        expect(finalEquity).toBe(1010000);
    });

    it('should handle zero initial equity', () => {
        const report = generatePerformanceReport(mockTrades, 0);
        // Should not throw, ROI might be Infinity
        expect(report).toBeDefined();
    });
});
