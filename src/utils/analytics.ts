// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS SERVICE
// Performance tracking and statistical analysis
// ═══════════════════════════════════════════════════════════════════════════

import { TradeResult } from '../types';
import { Logger } from './logger';

export interface PerformanceStats {
    // Overall metrics
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;

    // PnL metrics
    totalPnl: number;
    totalPnlPercent: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;

    // Risk metrics
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    averageDrawdown: number;

    // Trade metrics
    averageDuration: number;
    averageWinDuration: number;
    averageLossDuration: number;

    // Streaks
    currentStreak: number;
    maxWinStreak: number;
    maxLossStreak: number;

    // Exit analysis
    exitReasonBreakdown: Record<string, number>;
}

export interface EquityCurve {
    timestamp: number;
    equity: number;
    drawdown: number;
    drawdownPercent: number;
}

// ─────────────────────────────────────────────────────────────────────────
// ANALYTICS SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class AnalyticsService {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('Analytics');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE PERFORMANCE STATS
    // ─────────────────────────────────────────────────────────────────────────
    calculatePerformanceStats(
        trades: TradeResult[],
        initialEquity: number
    ): PerformanceStats {
        if (trades.length === 0) {
            return this.getEmptyStats();
        }

        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);

        // Basic metrics
        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const totalPnlPercent = (totalPnl / initialEquity) * 100;
        const winRate = (winningTrades.length / trades.length) * 100;

        // PnL metrics
        const averageWin =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
                : 0;

        const averageLoss =
            losingTrades.length > 0
                ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
                : 0;

        const largestWin =
            winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl)) : 0;
        const largestLoss =
            losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnl)) : 0;

        const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

        // Risk metrics
        const returns = trades.map(t => t.pnlPercent);
        const sharpeRatio = this.calculateSharpeRatio(returns);
        const sortinoRatio = this.calculateSortinoRatio(returns);

        const { maxDrawdown, maxDrawdownPercent, averageDrawdown } =
            this.calculateDrawdownMetrics(trades, initialEquity);

        const calmarRatio =
            maxDrawdownPercent > 0 ? (totalPnlPercent / maxDrawdownPercent) * 100 : 0;

        // Trade duration metrics
        const averageDuration = trades.reduce((sum, t) => sum + t.duration, 0) / trades.length;
        const averageWinDuration =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.duration, 0) / winningTrades.length
                : 0;
        const averageLossDuration =
            losingTrades.length > 0
                ? losingTrades.reduce((sum, t) => sum + t.duration, 0) / losingTrades.length
                : 0;

        // Streak calculation
        const { currentStreak, maxWinStreak, maxLossStreak } = this.calculateStreaks(trades);

        // Exit reason breakdown
        const exitReasonBreakdown = this.calculateExitReasonBreakdown(trades);

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            totalPnl,
            totalPnlPercent,
            averageWin,
            averageLoss,
            largestWin,
            largestLoss,
            profitFactor,
            sharpeRatio,
            sortinoRatio,
            calmarRatio,
            maxDrawdown,
            maxDrawdownPercent,
            averageDrawdown,
            averageDuration,
            averageWinDuration,
            averageLossDuration,
            currentStreak,
            maxWinStreak,
            maxLossStreak,
            exitReasonBreakdown
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE EQUITY CURVE
    // ─────────────────────────────────────────────────────────────────────────
    calculateEquityCurve(trades: TradeResult[], initialEquity: number): EquityCurve[] {
        const curve: EquityCurve[] = [];
        let equity = initialEquity;
        let peak = initialEquity;

        curve.push({
            timestamp: Date.now() - trades.length * 86400000,
            equity,
            drawdown: 0,
            drawdownPercent: 0
        });

        trades.forEach((trade, index) => {
            equity += trade.pnl;

            if (equity > peak) {
                peak = equity;
            }

            const drawdown = peak - equity;
            const drawdownPercent = (drawdown / peak) * 100;

            curve.push({
                timestamp: Date.now() - (trades.length - index - 1) * 86400000,
                equity,
                drawdown,
                drawdownPercent
            });
        });

        return curve;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SHARPE RATIO
    // ─────────────────────────────────────────────────────────────────────────
    private calculateSharpeRatio(returns: number[]): number {
        if (returns.length === 0) return 0;

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
        );

        return stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SORTINO RATIO (downside deviation only)
    // ─────────────────────────────────────────────────────────────────────────
    private calculateSortinoRatio(returns: number[]): number {
        if (returns.length === 0) return 0;

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const negativeReturns = returns.filter(r => r < 0);

        if (negativeReturns.length === 0) return Infinity;

        const downsideDeviation = Math.sqrt(
            negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
        );

        return downsideDeviation > 0 ? (avgReturn / downsideDeviation) * Math.sqrt(252) : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DRAWDOWN METRICS
    // ─────────────────────────────────────────────────────────────────────────
    private calculateDrawdownMetrics(
        trades: TradeResult[],
        initialEquity: number
    ): {
        maxDrawdown: number;
        maxDrawdownPercent: number;
        averageDrawdown: number;
    } {
        let equity = initialEquity;
        let peak = initialEquity;
        let maxDrawdown = 0;
        const drawdowns: number[] = [];

        trades.forEach(trade => {
            equity += trade.pnl;

            if (equity > peak) {
                peak = equity;
            }

            const drawdown = peak - equity;
            drawdowns.push(drawdown);

            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        });

        const maxDrawdownPercent = (maxDrawdown / peak) * 100;
        const averageDrawdown =
            drawdowns.length > 0 ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length : 0;

        return { maxDrawdown, maxDrawdownPercent, averageDrawdown };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE STREAKS
    // ─────────────────────────────────────────────────────────────────────────
    private calculateStreaks(trades: TradeResult[]): {
        currentStreak: number;
        maxWinStreak: number;
        maxLossStreak: number;
    } {
        let currentStreak = 0;
        let maxWinStreak = 0;
        let maxLossStreak = 0;
        let currentWinStreak = 0;
        let currentLossStreak = 0;

        trades.forEach(trade => {
            if (trade.pnl > 0) {
                currentWinStreak++;
                currentLossStreak = 0;
                currentStreak = currentWinStreak;
                maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
            } else {
                currentLossStreak++;
                currentWinStreak = 0;
                currentStreak = -currentLossStreak;
                maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
            }
        });

        return { currentStreak, maxWinStreak, maxLossStreak };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXIT REASON BREAKDOWN
    // ─────────────────────────────────────────────────────────────────────────
    private calculateExitReasonBreakdown(trades: TradeResult[]): Record<string, number> {
        const breakdown: Record<string, number> = {};

        trades.forEach(trade => {
            breakdown[trade.exitReason] = (breakdown[trade.exitReason] || 0) + 1;
        });

        return breakdown;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FORMAT STATS FOR DISPLAY
    // ─────────────────────────────────────────────────────────────────────────
    formatStats(stats: PerformanceStats): string {
        return `
╔═══════════════════════════════════════════════════════════════╗
║                    PERFORMANCE ANALYTICS                      ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  OVERALL PERFORMANCE                                          ║
║  ────────────────────────────────────────────────────────────║
║  Total Trades:      ${String(stats.totalTrades).padStart(8)}                          ║
║  Winning:           ${String(stats.winningTrades).padStart(8)}                          ║
║  Losing:            ${String(stats.losingTrades).padStart(8)}                          ║
║  Win Rate:          ${stats.winRate.toFixed(2).padStart(8)}%                         ║
║                                                               ║
║  PNL METRICS                                                  ║
║  ────────────────────────────────────────────────────────────║
║  Total PnL:         $${stats.totalPnl.toFixed(2).padStart(7)} (${stats.totalPnlPercent.toFixed(2)}%)              ║
║  Average Win:       $${stats.averageWin.toFixed(2).padStart(7)}                         ║
║  Average Loss:      $${stats.averageLoss.toFixed(2).padStart(7)}                         ║
║  Largest Win:       $${stats.largestWin.toFixed(2).padStart(7)}                         ║
║  Largest Loss:      $${stats.largestLoss.toFixed(2).padStart(7)}                         ║
║  Profit Factor:     ${stats.profitFactor.toFixed(2).padStart(8)}                          ║
║                                                               ║
║  RISK METRICS                                                 ║
║  ────────────────────────────────────────────────────────────║
║  Sharpe Ratio:      ${stats.sharpeRatio.toFixed(2).padStart(8)}                          ║
║  Sortino Ratio:     ${stats.sortinoRatio.toFixed(2).padStart(8)}                          ║
║  Calmar Ratio:      ${stats.calmarRatio.toFixed(2).padStart(8)}                          ║
║  Max Drawdown:      $${stats.maxDrawdown.toFixed(2).padStart(7)} (${stats.maxDrawdownPercent.toFixed(2)}%)              ║
║  Avg Drawdown:      $${stats.averageDrawdown.toFixed(2).padStart(7)}                         ║
║                                                               ║
║  TRADE DURATION                                               ║
║  ────────────────────────────────────────────────────────────║
║  Average:           ${(stats.averageDuration / 60000).toFixed(1).padStart(8)} min                        ║
║  Avg Win:           ${(stats.averageWinDuration / 60000).toFixed(1).padStart(8)} min                        ║
║  Avg Loss:          ${(stats.averageLossDuration / 60000).toFixed(1).padStart(8)} min                        ║
║                                                               ║
║  STREAKS                                                      ║
║  ────────────────────────────────────────────────────────────║
║  Current:           ${String(stats.currentStreak).padStart(8)}                          ║
║  Max Win Streak:    ${String(stats.maxWinStreak).padStart(8)}                          ║
║  Max Loss Streak:   ${String(stats.maxLossStreak).padStart(8)}                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝`;
    }

    private getEmptyStats(): PerformanceStats {
        return {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            totalPnl: 0,
            totalPnlPercent: 0,
            averageWin: 0,
            averageLoss: 0,
            largestWin: 0,
            largestLoss: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            sortinoRatio: 0,
            calmarRatio: 0,
            maxDrawdown: 0,
            maxDrawdownPercent: 0,
            averageDrawdown: 0,
            averageDuration: 0,
            averageWinDuration: 0,
            averageLossDuration: 0,
            currentStreak: 0,
            maxWinStreak: 0,
            maxLossStreak: 0,
            exitReasonBreakdown: {}
        };
    }
}
