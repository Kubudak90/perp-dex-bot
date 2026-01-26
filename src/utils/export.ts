// ═══════════════════════════════════════════════════════════════════════════
// TRADE EXPORT MODULE
// Export trade history to CSV, JSON, and generate reports
// ═══════════════════════════════════════════════════════════════════════════

import { TradeResult } from '../types';
import { Logger } from './logger';

const logger = new Logger('Export');

// ─────────────────────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────────────────────
export function tradesToCSV(trades: TradeResult[], includeHeaders: boolean = true): string {
    if (trades.length === 0) {
        return includeHeaders ? 'No trades to export' : '';
    }

    const headers = [
        'ID',
        'Side',
        'Entry Time',
        'Exit Time',
        'Entry Price',
        'Exit Price',
        'Size',
        'PnL ($)',
        'PnL (%)',
        'Exit Reason',
        'Strategy',
        'Duration (min)',
        'Fees'
    ];

    const rows = trades.map(trade => {
        const entryTime = trade.entryTime ? new Date(trade.entryTime).toISOString() : '';
        const exitTime = trade.exitTime ? new Date(trade.exitTime).toISOString() : '';
        const duration = trade.entryTime && trade.exitTime
            ? Math.round((trade.exitTime - trade.entryTime) / 60000)
            : Math.round(trade.duration / 60000);
        const pnlPercent = trade.entryPrice > 0
            ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100 * (trade.side === 'LONG' ? 1 : -1)).toFixed(2)
            : '0';

        return [
            trade.id || '',
            trade.side,
            entryTime,
            exitTime,
            trade.entryPrice.toFixed(2),
            trade.exitPrice.toFixed(2),
            (trade.size || 0).toFixed(6),
            trade.pnl.toFixed(2),
            pnlPercent,
            trade.exitReason,
            trade.strategy || 'default',
            duration.toString(),
            (trade.fees || 0).toFixed(4)
        ];
    });

    const csvContent = includeHeaders
        ? [headers, ...rows].map(row => row.join(',')).join('\n')
        : rows.map(row => row.join(',')).join('\n');

    return csvContent;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON EXPORT
// ─────────────────────────────────────────────────────────────────────────
export interface TradeExportData {
    exportedAt: string;
    totalTrades: number;
    dateRange: {
        from: string;
        to: string;
    };
    summary: {
        totalPnl: number;
        winRate: number;
        profitFactor: number;
        avgWin: number;
        avgLoss: number;
        bestTrade: number;
        worstTrade: number;
        avgDuration: number; // minutes
    };
    trades: TradeResult[];
}

export function tradesToJSON(trades: TradeResult[]): TradeExportData {
    if (trades.length === 0) {
        return {
            exportedAt: new Date().toISOString(),
            totalTrades: 0,
            dateRange: { from: '', to: '' },
            summary: {
                totalPnl: 0,
                winRate: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                bestTrade: 0,
                worstTrade: 0,
                avgDuration: 0
            },
            trades: []
        };
    }

    const sortedTrades = [...trades].sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);

    const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

    const avgDuration = trades.reduce((sum, t) => sum + ((t.exitTime || 0) - (t.entryTime || 0) || t.duration), 0) / trades.length / 60000;

    const firstEntryTime = sortedTrades[0].entryTime;
    const lastExitTime = sortedTrades[sortedTrades.length - 1].exitTime;

    return {
        exportedAt: new Date().toISOString(),
        totalTrades: trades.length,
        dateRange: {
            from: firstEntryTime ? new Date(firstEntryTime).toISOString() : '',
            to: lastExitTime ? new Date(lastExitTime).toISOString() : ''
        },
        summary: {
            totalPnl,
            winRate: (wins.length / trades.length) * 100,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
            avgWin: wins.length > 0 ? grossWin / wins.length : 0,
            avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
            bestTrade: Math.max(...trades.map(t => t.pnl)),
            worstTrade: Math.min(...trades.map(t => t.pnl)),
            avgDuration
        },
        trades: sortedTrades
    };
}

// ─────────────────────────────────────────────────────────────────────────
// PERFORMANCE REPORT
// ─────────────────────────────────────────────────────────────────────────
export interface PerformanceReport {
    period: string;
    metrics: {
        // Basic
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        winRate: number;

        // PnL
        totalPnl: number;
        grossProfit: number;
        grossLoss: number;
        netProfit: number;
        avgPnlPerTrade: number;

        // Risk
        profitFactor: number;
        sharpeRatio: number;
        sortinoRatio: number;
        maxDrawdown: number;
        maxDrawdownPercent: number;
        recoveryFactor: number;

        // Trade Analysis
        avgWin: number;
        avgLoss: number;
        largestWin: number;
        largestLoss: number;
        avgWinLossRatio: number;
        expectancy: number;

        // Streaks
        maxConsecutiveWins: number;
        maxConsecutiveLosses: number;
        currentStreak: number;

        // Time
        avgTradeDuration: number; // minutes
        shortestTrade: number;
        longestTrade: number;
        tradesPerDay: number;

        // By Side
        longWinRate: number;
        shortWinRate: number;
        longPnl: number;
        shortPnl: number;
    };
    dailyReturns: { date: string; pnl: number; trades: number }[];
    monthlyReturns: { month: string; pnl: number; trades: number }[];
    equityCurve: { time: number; equity: number }[];
    drawdownCurve: { time: number; drawdown: number }[];
}

export function generatePerformanceReport(
    trades: TradeResult[],
    initialEquity: number = 10000,
    periodLabel: string = 'All Time'
): PerformanceReport {
    if (trades.length === 0) {
        return createEmptyReport(periodLabel);
    }

    const sortedTrades = [...trades].sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));

    // Basic counts
    const wins = sortedTrades.filter(t => t.pnl > 0);
    const losses = sortedTrades.filter(t => t.pnl <= 0);
    const longTrades = sortedTrades.filter(t => t.side === 'LONG');
    const shortTrades = sortedTrades.filter(t => t.side === 'SHORT');

    // PnL calculations
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const totalPnl = grossProfit - grossLoss;
    const totalFees = sortedTrades.reduce((sum, t) => sum + (t.fees || 0), 0);
    const netProfit = totalPnl - totalFees;

    // Equity curve and drawdown
    let equity = initialEquity;
    let peak = initialEquity;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;

    const firstEntryTime = sortedTrades[0].entryTime || Date.now();
    const equityCurve: { time: number; equity: number }[] = [{ time: firstEntryTime, equity: initialEquity }];
    const drawdownCurve: { time: number; drawdown: number }[] = [];

    for (const trade of sortedTrades) {
        equity += trade.pnl;
        equityCurve.push({ time: trade.exitTime || Date.now(), equity });

        if (equity > peak) {
            peak = equity;
        }

        const drawdown = peak - equity;
        const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;

        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
            maxDrawdownPercent = drawdownPct;
        }

        drawdownCurve.push({ time: trade.exitTime || Date.now(), drawdown: drawdownPct });
    }

    // Streaks
    let currentStreak = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    for (const trade of sortedTrades) {
        if (trade.pnl > 0) {
            tempWinStreak++;
            tempLossStreak = 0;
            currentStreak = tempWinStreak;
            maxConsecutiveWins = Math.max(maxConsecutiveWins, tempWinStreak);
        } else {
            tempLossStreak++;
            tempWinStreak = 0;
            currentStreak = -tempLossStreak;
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, tempLossStreak);
        }
    }

    // Time analysis - use duration if entryTime/exitTime not available
    const durations = sortedTrades.map(t => {
        if (t.entryTime && t.exitTime) {
            return (t.exitTime - t.entryTime) / 60000;
        }
        return t.duration / 60000;
    });
    const avgTradeDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const shortestTrade = Math.min(...durations);
    const longestTrade = Math.max(...durations);

    // Days active
    const firstTradeTime = sortedTrades[0].entryTime || Date.now();
    const lastTradeTime = sortedTrades[sortedTrades.length - 1].exitTime || Date.now();
    const firstTradeDate = new Date(firstTradeTime);
    const lastTradeDate = new Date(lastTradeTime);
    const daysActive = Math.max(1, Math.ceil((lastTradeDate.getTime() - firstTradeDate.getTime()) / (1000 * 60 * 60 * 24)));
    const tradesPerDay = sortedTrades.length / daysActive;

    // Returns calculations for ratios
    const returns = sortedTrades.map(t => t.pnl / initialEquity);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const negativeReturns = returns.filter(r => r < 0);
    const downstdDev = negativeReturns.length > 0
        ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length)
        : 0;

    const riskFreeRate = 0.02 / 252; // ~2% annual, daily
    const sharpeRatio = stdDev > 0 ? ((avgReturn - riskFreeRate) / stdDev) * Math.sqrt(252) : 0;
    const sortinoRatio = downstdDev > 0 ? ((avgReturn - riskFreeRate) / downstdDev) * Math.sqrt(252) : 0;

    // Daily and monthly aggregation
    const dailyMap = new Map<string, { pnl: number; trades: number }>();
    const monthlyMap = new Map<string, { pnl: number; trades: number }>();

    for (const trade of sortedTrades) {
        const tradeTime = trade.exitTime || Date.now();
        const date = new Date(tradeTime).toISOString().split('T')[0];
        const month = date.substring(0, 7);

        const daily = dailyMap.get(date) || { pnl: 0, trades: 0 };
        daily.pnl += trade.pnl;
        daily.trades++;
        dailyMap.set(date, daily);

        const monthly = monthlyMap.get(month) || { pnl: 0, trades: 0 };
        monthly.pnl += trade.pnl;
        monthly.trades++;
        monthlyMap.set(month, monthly);
    }

    const dailyReturns = Array.from(dailyMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const monthlyReturns = Array.from(monthlyMap.entries())
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month));

    // By side analysis
    const longWins = longTrades.filter(t => t.pnl > 0);
    const shortWins = shortTrades.filter(t => t.pnl > 0);
    const longPnl = longTrades.reduce((sum, t) => sum + t.pnl, 0);
    const shortPnl = shortTrades.reduce((sum, t) => sum + t.pnl, 0);

    // Expectancy
    const winRate = wins.length / sortedTrades.length;
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Recovery factor
    const recoveryFactor = maxDrawdown > 0 ? netProfit / maxDrawdown : netProfit > 0 ? Infinity : 0;

    return {
        period: periodLabel,
        metrics: {
            totalTrades: sortedTrades.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate: winRate * 100,

            totalPnl,
            grossProfit,
            grossLoss,
            netProfit,
            avgPnlPerTrade: totalPnl / sortedTrades.length,

            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
            sharpeRatio,
            sortinoRatio,
            maxDrawdown,
            maxDrawdownPercent,
            recoveryFactor,

            avgWin,
            avgLoss,
            largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
            largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
            avgWinLossRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
            expectancy,

            maxConsecutiveWins,
            maxConsecutiveLosses,
            currentStreak,

            avgTradeDuration,
            shortestTrade,
            longestTrade,
            tradesPerDay,

            longWinRate: longTrades.length > 0 ? (longWins.length / longTrades.length) * 100 : 0,
            shortWinRate: shortTrades.length > 0 ? (shortWins.length / shortTrades.length) * 100 : 0,
            longPnl,
            shortPnl
        },
        dailyReturns,
        monthlyReturns,
        equityCurve,
        drawdownCurve
    };
}

function createEmptyReport(period: string): PerformanceReport {
    return {
        period,
        metrics: {
            totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
            totalPnl: 0, grossProfit: 0, grossLoss: 0, netProfit: 0, avgPnlPerTrade: 0,
            profitFactor: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, maxDrawdownPercent: 0, recoveryFactor: 0,
            avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0, avgWinLossRatio: 0, expectancy: 0,
            maxConsecutiveWins: 0, maxConsecutiveLosses: 0, currentStreak: 0,
            avgTradeDuration: 0, shortestTrade: 0, longestTrade: 0, tradesPerDay: 0,
            longWinRate: 0, shortWinRate: 0, longPnl: 0, shortPnl: 0
        },
        dailyReturns: [],
        monthlyReturns: [],
        equityCurve: [],
        drawdownCurve: []
    };
}

// ─────────────────────────────────────────────────────────────────────────
// FILTER HELPERS
// ─────────────────────────────────────────────────────────────────────────
export function filterTradesByDateRange(
    trades: TradeResult[],
    startDate?: Date,
    endDate?: Date
): TradeResult[] {
    return trades.filter(trade => {
        if (!trade.entryTime) return true; // Include if no timestamp
        const tradeDate = new Date(trade.entryTime);
        if (startDate && tradeDate < startDate) return false;
        if (endDate && tradeDate > endDate) return false;
        return true;
    });
}

export function filterTradesBySide(trades: TradeResult[], side: 'LONG' | 'SHORT'): TradeResult[] {
    return trades.filter(trade => trade.side === side);
}

export function filterTradesByStrategy(trades: TradeResult[], strategy: string): TradeResult[] {
    return trades.filter(trade => trade.strategy === strategy);
}

export function filterProfitableTrades(trades: TradeResult[]): TradeResult[] {
    return trades.filter(trade => trade.pnl > 0);
}

export function filterLosingTrades(trades: TradeResult[]): TradeResult[] {
    return trades.filter(trade => trade.pnl <= 0);
}
