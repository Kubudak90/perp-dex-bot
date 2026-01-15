// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY PERFORMANCE TRACKER
// Tracks and analyzes performance of different trading strategies
// ═══════════════════════════════════════════════════════════════════════════

import { StrategyType, StrategyPerformance, TradeResult, MarketRegime } from '../types';
import { Logger } from './logger';

export interface StrategyStats {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    avgHoldTime: number;
    bestTrade: number;
    worstTrade: number;
}

export interface RegimeStats {
    regime: MarketRegime;
    trades: number;
    winRate: number;
    avgPnl: number;
    profitFactor: number;
    bestStrategy: StrategyType;
}

export class StrategyTracker {
    private logger: Logger;
    private strategyTrades: Map<StrategyType, TradeResult[]>;
    private regimeTrades: Map<MarketRegime, TradeResult[]>;

    constructor() {
        this.logger = new Logger('StrategyTracker');
        this.strategyTrades = new Map();
        this.regimeTrades = new Map();

        // Initialize maps for all strategies and regimes
        const strategies: StrategyType[] = ['SUPERTREND', 'BREAKOUT', 'MEAN_REVERSION', 'MOMENTUM', 'SCALP'];
        const regimes: MarketRegime[] = ['TRENDING', 'RANGING', 'VOLATILE', 'QUIET'];

        strategies.forEach(s => this.strategyTrades.set(s, []));
        regimes.forEach(r => this.regimeTrades.set(r, []));
    }

    /**
     * Record a completed trade
     */
    recordTrade(trade: TradeResult): void {
        // Record by strategy
        if (trade.strategy) {
            const trades = this.strategyTrades.get(trade.strategy) || [];
            trades.push(trade);
            this.strategyTrades.set(trade.strategy, trades);
        }

        // Record by market regime
        if (trade.marketRegime) {
            const trades = this.regimeTrades.get(trade.marketRegime) || [];
            trades.push(trade);
            this.regimeTrades.set(trade.marketRegime, trades);
        }
    }

    /**
     * Get performance stats for a specific strategy
     */
    getStrategyStats(strategy: StrategyType): StrategyStats {
        const trades = this.strategyTrades.get(strategy) || [];
        return this.calculateStats(trades);
    }

    /**
     * Get performance stats for all strategies
     */
    getAllStrategyStats(): Map<StrategyType, StrategyStats> {
        const stats = new Map<StrategyType, StrategyStats>();
        this.strategyTrades.forEach((trades, strategy) => {
            if (trades.length > 0) {
                stats.set(strategy, this.calculateStats(trades));
            }
        });
        return stats;
    }

    /**
     * Get performance stats for a specific market regime
     */
    getRegimeStats(regime: MarketRegime): RegimeStats {
        const trades = this.regimeTrades.get(regime) || [];
        const stats = this.calculateStats(trades);

        // Find best performing strategy in this regime
        const strategyPerf = new Map<StrategyType, number>();
        trades.forEach(t => {
            if (t.strategy) {
                const current = strategyPerf.get(t.strategy) || 0;
                strategyPerf.set(t.strategy, current + t.pnl);
            }
        });

        let bestStrategy: StrategyType = 'SUPERTREND';
        let bestPnl = -Infinity;
        strategyPerf.forEach((pnl, strategy) => {
            if (pnl > bestPnl) {
                bestPnl = pnl;
                bestStrategy = strategy;
            }
        });

        return {
            regime,
            trades: stats.totalTrades,
            winRate: stats.winRate,
            avgPnl: stats.totalPnl / Math.max(1, stats.totalTrades),
            profitFactor: stats.profitFactor,
            bestStrategy
        };
    }

    /**
     * Get all regime stats
     */
    getAllRegimeStats(): Map<MarketRegime, RegimeStats> {
        const stats = new Map<MarketRegime, RegimeStats>();
        const regimes: MarketRegime[] = ['TRENDING', 'RANGING', 'VOLATILE', 'QUIET'];

        regimes.forEach(regime => {
            const trades = this.regimeTrades.get(regime) || [];
            if (trades.length > 0) {
                stats.set(regime, this.getRegimeStats(regime));
            }
        });

        return stats;
    }

    /**
     * Get the best performing strategy for a given regime
     */
    getBestStrategyForRegime(regime: MarketRegime): StrategyType {
        const regimeStats = this.getRegimeStats(regime);
        return regimeStats.bestStrategy;
    }

    /**
     * Get strategy performance summary for adaptive selection
     */
    getStrategyPerformance(): StrategyPerformance[] {
        const performances: StrategyPerformance[] = [];

        this.strategyTrades.forEach((trades, strategy) => {
            if (trades.length === 0) return;

            const stats = this.calculateStats(trades);
            const lastTrade = trades[trades.length - 1];

            performances.push({
                strategy,
                trades: stats.totalTrades,
                winRate: stats.winRate,
                avgPnl: stats.totalPnl / stats.totalTrades,
                profitFactor: stats.profitFactor,
                lastUsed: Date.now() // Would need actual timestamp tracking
            });
        });

        return performances.sort((a, b) => b.profitFactor - a.profitFactor);
    }

    /**
     * Generate a performance report
     */
    generateReport(): string {
        let report = `
╔═══════════════════════════════════════════════════════════════════════════╗
║                    STRATEGY PERFORMANCE REPORT                             ║
╚═══════════════════════════════════════════════════════════════════════════╝

`;

        // Strategy breakdown
        report += '📊 STRATEGY BREAKDOWN\n';
        report += '─────────────────────────────────────────────────────────────────\n';

        const allStats = this.getAllStrategyStats();
        allStats.forEach((stats, strategy) => {
            report += `
${strategy}:
  Trades: ${stats.totalTrades} (${stats.winningTrades}W / ${stats.losingTrades}L)
  Win Rate: ${(stats.winRate * 100).toFixed(1)}%
  Total PnL: $${stats.totalPnl.toFixed(2)}
  Profit Factor: ${stats.profitFactor.toFixed(2)}
  Avg Win: $${stats.avgWin.toFixed(2)} | Avg Loss: $${stats.avgLoss.toFixed(2)}
  Best: $${stats.bestTrade.toFixed(2)} | Worst: $${stats.worstTrade.toFixed(2)}
`;
        });

        // Regime breakdown
        report += '\n🌡️ MARKET REGIME BREAKDOWN\n';
        report += '─────────────────────────────────────────────────────────────────\n';

        const regimeStats = this.getAllRegimeStats();
        regimeStats.forEach((stats, regime) => {
            report += `
${regime}:
  Trades: ${stats.trades}
  Win Rate: ${(stats.winRate * 100).toFixed(1)}%
  Avg PnL: $${stats.avgPnl.toFixed(2)}
  Best Strategy: ${stats.bestStrategy}
`;
        });

        // Recommendations
        report += '\n💡 RECOMMENDATIONS\n';
        report += '─────────────────────────────────────────────────────────────────\n';

        const regimes: MarketRegime[] = ['TRENDING', 'RANGING', 'VOLATILE', 'QUIET'];
        regimes.forEach(regime => {
            const best = this.getBestStrategyForRegime(regime);
            const regimeStat = regimeStats.get(regime);
            if (regimeStat && regimeStat.trades >= 5) {
                report += `  ${regime} markets: Use ${best} (${(regimeStat.winRate * 100).toFixed(0)}% win rate)\n`;
            }
        });

        return report;
    }

    /**
     * Calculate stats from a list of trades
     */
    private calculateStats(trades: TradeResult[]): StrategyStats {
        if (trades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnl: 0,
                avgWin: 0,
                avgLoss: 0,
                profitFactor: 0,
                avgHoldTime: 0,
                bestTrade: 0,
                worstTrade: 0
            };
        }

        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);

        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const grossWin = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

        const avgWin = winningTrades.length > 0
            ? grossWin / winningTrades.length
            : 0;
        const avgLoss = losingTrades.length > 0
            ? grossLoss / losingTrades.length
            : 0;

        const avgHoldTime = trades.reduce((sum, t) => sum + t.duration, 0) / trades.length;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: winningTrades.length / trades.length,
            totalPnl,
            avgWin,
            avgLoss,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
            avgHoldTime,
            bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
            worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0
        };
    }

    /**
     * Get strategy recommendation based on historical performance
     */
    recommendStrategy(regime: MarketRegime): { strategy: StrategyType; confidence: number } {
        const regimeTradeList = this.regimeTrades.get(regime) || [];

        // If not enough data, use defaults
        if (regimeTradeList.length < 10) {
            const defaults: Record<MarketRegime, StrategyType> = {
                'TRENDING': 'SUPERTREND',
                'RANGING': 'MEAN_REVERSION',
                'VOLATILE': 'MOMENTUM',
                'QUIET': 'SCALP'
            };
            return {
                strategy: defaults[regime],
                confidence: 0.5 // Low confidence due to insufficient data
            };
        }

        // Calculate performance by strategy in this regime
        const strategyPerf = new Map<StrategyType, { pnl: number; trades: number; wins: number }>();

        regimeTradeList.forEach(trade => {
            if (!trade.strategy) return;

            const current = strategyPerf.get(trade.strategy) || { pnl: 0, trades: 0, wins: 0 };
            current.pnl += trade.pnl;
            current.trades += 1;
            if (trade.pnl > 0) current.wins += 1;
            strategyPerf.set(trade.strategy, current);
        });

        // Find best strategy by profit factor
        let bestStrategy: StrategyType = 'SUPERTREND';
        let bestScore = -Infinity;

        strategyPerf.forEach((perf, strategy) => {
            if (perf.trades < 5) return; // Need minimum trades

            const winRate = perf.wins / perf.trades;
            const avgPnl = perf.pnl / perf.trades;
            // Score = combination of win rate and average PnL
            const score = winRate * 0.5 + (avgPnl > 0 ? 0.5 : avgPnl / 100);

            if (score > bestScore) {
                bestScore = score;
                bestStrategy = strategy;
            }
        });

        // Calculate confidence based on sample size and consistency
        const bestPerf = strategyPerf.get(bestStrategy);
        const confidence = bestPerf
            ? Math.min(0.9, 0.5 + (bestPerf.trades / 50) * 0.4) // More trades = higher confidence
            : 0.5;

        return { strategy: bestStrategy, confidence };
    }

    /**
     * Export data for analysis
     */
    exportData(): {
        strategyTrades: Record<string, TradeResult[]>;
        regimeTrades: Record<string, TradeResult[]>;
    } {
        const strategyTrades: Record<string, TradeResult[]> = {};
        const regimeTrades: Record<string, TradeResult[]> = {};

        this.strategyTrades.forEach((trades, strategy) => {
            strategyTrades[strategy] = trades;
        });

        this.regimeTrades.forEach((trades, regime) => {
            regimeTrades[regime] = trades;
        });

        return { strategyTrades, regimeTrades };
    }

    /**
     * Import data from previous session
     */
    importData(data: {
        strategyTrades: Record<string, TradeResult[]>;
        regimeTrades: Record<string, TradeResult[]>;
    }): void {
        Object.entries(data.strategyTrades).forEach(([strategy, trades]) => {
            this.strategyTrades.set(strategy as StrategyType, trades);
        });

        Object.entries(data.regimeTrades).forEach(([regime, trades]) => {
            this.regimeTrades.set(regime as MarketRegime, trades);
        });

        this.logger.info(`Imported ${Object.values(data.strategyTrades).flat().length} trades`);
    }

    /**
     * Clear all recorded data
     */
    reset(): void {
        this.strategyTrades.forEach((_, key) => this.strategyTrades.set(key, []));
        this.regimeTrades.forEach((_, key) => this.regimeTrades.set(key, []));
        this.logger.info('Strategy tracker reset');
    }
}

// Export singleton instance
export const strategyTracker = new StrategyTracker();
