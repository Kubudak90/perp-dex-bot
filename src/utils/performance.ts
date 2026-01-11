// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE METRICS CALCULATOR (Phase 6D)
// Calculate trading performance metrics from trade history
// ═══════════════════════════════════════════════════════════════════════════

import { TradeResult, PerformanceMetrics } from '../types';

export class PerformanceCalculator {

    /**
     * Calculate comprehensive performance metrics from trade history
     */
    static calculateMetrics(
        trades: TradeResult[],
        initialEquity: number
    ): PerformanceMetrics {
        if (trades.length === 0) {
            return this.getEmptyMetrics(initialEquity);
        }

        // Basic calculations
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl < 0);
        const winRate = (winningTrades.length / trades.length) * 100;

        // PnL calculations
        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const totalPnlPercent = (totalPnl / initialEquity) * 100;

        const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        const avgWin = winningTrades.length > 0
            ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
            : 0;
        const avgLoss = losingTrades.length > 0
            ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
            : 0;

        const largestWin = winningTrades.length > 0
            ? Math.max(...winningTrades.map(t => t.pnl))
            : 0;
        const largestLoss = losingTrades.length > 0
            ? Math.min(...losingTrades.map(t => t.pnl))
            : 0;

        // Equity curve and drawdown
        const equityCurve: number[] = [initialEquity];
        let equity = initialEquity;
        for (const trade of trades) {
            equity += trade.pnl;
            equityCurve.push(equity);
        }

        const { maxDrawdown, maxDrawdownPercent } = this.calculateDrawdown(equityCurve);
        const peakEquity = Math.max(...equityCurve);
        const finalEquity = equityCurve[equityCurve.length - 1];

        // Risk-adjusted returns
        const returns = trades.map(t => (t.pnl / initialEquity) * 100);
        const sharpeRatio = this.calculateSharpe(returns);
        const sortinoRatio = this.calculateSortino(returns);

        // Trade characteristics
        const avgHoldTime = trades.reduce((sum, t) => sum + t.duration, 0) / trades.length;
        const avgTradeDuration = avgHoldTime / (1000 * 60 * 60); // Convert to hours

        const { maxWins, maxLosses } = this.calculateStreaks(trades);

        // Advanced metrics
        const expectancy = totalPnl / trades.length;
        const recoveryFactor = maxDrawdown > 0 ? totalPnl / maxDrawdown : totalPnl > 0 ? Infinity : 0;

        // Calmar = Annual return / Max DD%
        const totalDays = (trades[trades.length - 1].duration - trades[0].duration) / (1000 * 60 * 60 * 24);
        const annualReturn = totalDays > 0 ? (totalPnlPercent / totalDays) * 365 : 0;
        const calmarRatio = maxDrawdownPercent > 0 ? annualReturn / maxDrawdownPercent : annualReturn > 0 ? Infinity : 0;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            totalPnl,
            totalPnlPercent,
            avgWin,
            avgLoss,
            largestWin,
            largestLoss,
            profitFactor,
            maxDrawdown,
            maxDrawdownPercent,
            sharpeRatio,
            sortinoRatio,
            avgHoldTime,
            avgTradeDuration,
            maxConsecutiveWins: maxWins,
            maxConsecutiveLosses: maxLosses,
            finalEquity,
            peakEquity,
            returnOnInvestment: totalPnlPercent,
            expectancy,
            recoveryFactor,
            calmarRatio
        };
    }

    /**
     * Calculate maximum drawdown from equity curve
     */
    private static calculateDrawdown(equityCurve: number[]): { maxDrawdown: number; maxDrawdownPercent: number } {
        let maxDrawdown = 0;
        let maxDrawdownPercent = 0;
        let peak = equityCurve[0];

        for (let i = 1; i < equityCurve.length; i++) {
            const equity = equityCurve[i];
            if (equity > peak) {
                peak = equity;
            } else {
                const drawdown = peak - equity;
                const drawdownPct = (drawdown / peak) * 100;
                if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                    maxDrawdownPercent = drawdownPct;
                }
            }
        }

        return { maxDrawdown, maxDrawdownPercent };
    }

    /**
     * Calculate Sharpe ratio (risk-adjusted return)
     * Assumes risk-free rate = 0 for simplicity
     */
    private static calculateSharpe(returns: number[]): number {
        if (returns.length === 0) return 0;

        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);

        return stdDev > 0 ? avgReturn / stdDev : avgReturn > 0 ? Infinity : 0;
    }

    /**
     * Calculate Sortino ratio (downside risk-adjusted return)
     * Only penalizes downside volatility
     */
    private static calculateSortino(returns: number[]): number {
        if (returns.length === 0) return 0;

        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const negativeReturns = returns.filter(r => r < 0);

        if (negativeReturns.length === 0) {
            return avgReturn > 0 ? Infinity : 0;
        }

        const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
        const downsideStdDev = Math.sqrt(downsideVariance);

        return downsideStdDev > 0 ? avgReturn / downsideStdDev : avgReturn > 0 ? Infinity : 0;
    }

    /**
     * Calculate max consecutive wins and losses
     */
    private static calculateStreaks(trades: TradeResult[]): { maxWins: number; maxLosses: number } {
        let maxWins = 0;
        let maxLosses = 0;
        let currentWins = 0;
        let currentLosses = 0;

        for (const trade of trades) {
            if (trade.pnl > 0) {
                currentWins++;
                currentLosses = 0;
                maxWins = Math.max(maxWins, currentWins);
            } else {
                currentLosses++;
                currentWins = 0;
                maxLosses = Math.max(maxLosses, currentLosses);
            }
        }

        return { maxWins, maxLosses };
    }

    /**
     * Get empty metrics for zero trades
     */
    private static getEmptyMetrics(initialEquity: number): PerformanceMetrics {
        return {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            totalPnl: 0,
            totalPnlPercent: 0,
            avgWin: 0,
            avgLoss: 0,
            largestWin: 0,
            largestLoss: 0,
            profitFactor: 0,
            maxDrawdown: 0,
            maxDrawdownPercent: 0,
            sharpeRatio: 0,
            sortinoRatio: 0,
            avgHoldTime: 0,
            avgTradeDuration: 0,
            maxConsecutiveWins: 0,
            maxConsecutiveLosses: 0,
            finalEquity: initialEquity,
            peakEquity: initialEquity,
            returnOnInvestment: 0,
            expectancy: 0,
            recoveryFactor: 0,
            calmarRatio: 0
        };
    }

    /**
     * Format metrics for display
     */
    static formatMetrics(metrics: PerformanceMetrics): string {
        return `
┌─────────────────────────────────────────────────────────────┐
│                   PERFORMANCE SUMMARY                        │
├─────────────────────────────────────────────────────────────┤
│ Total Trades:       ${metrics.totalTrades.toString().padEnd(40)} │
│ Win Rate:           ${metrics.winRate.toFixed(2)}%${' '.repeat(37)} │
│ Winning Trades:     ${metrics.winningTrades.toString().padEnd(40)} │
│ Losing Trades:      ${metrics.losingTrades.toString().padEnd(40)} │
├─────────────────────────────────────────────────────────────┤
│ Total PnL:          $${metrics.totalPnl.toFixed(2).padEnd(39)} │
│ Total Return:       ${metrics.totalPnlPercent.toFixed(2)}%${' '.repeat(37)} │
│ Profit Factor:      ${metrics.profitFactor.toFixed(2).padEnd(40)} │
│ Expectancy:         $${metrics.expectancy.toFixed(2).padEnd(39)} │
├─────────────────────────────────────────────────────────────┤
│ Max Drawdown:       $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(2)}%)${' '.repeat(20)} │
│ Sharpe Ratio:       ${metrics.sharpeRatio.toFixed(2).padEnd(40)} │
│ Sortino Ratio:      ${metrics.sortinoRatio.toFixed(2).padEnd(40)} │
│ Recovery Factor:    ${metrics.recoveryFactor.toFixed(2).padEnd(40)} │
├─────────────────────────────────────────────────────────────┤
│ Avg Win:            $${metrics.avgWin.toFixed(2).padEnd(39)} │
│ Avg Loss:           $${metrics.avgLoss.toFixed(2).padEnd(39)} │
│ Largest Win:        $${metrics.largestWin.toFixed(2).padEnd(39)} │
│ Largest Loss:       $${metrics.largestLoss.toFixed(2).padEnd(39)} │
├─────────────────────────────────────────────────────────────┤
│ Avg Trade Duration: ${metrics.avgTradeDuration.toFixed(2)} hours${' '.repeat(31)} │
│ Max Consecutive Wins:  ${metrics.maxConsecutiveWins.toString().padEnd(37)} │
│ Max Consecutive Losses: ${metrics.maxConsecutiveLosses.toString().padEnd(36)} │
└─────────────────────────────────────────────────────────────┘
        `.trim();
    }
}
