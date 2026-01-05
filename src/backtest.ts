// ═══════════════════════════════════════════════════════════════════════════
// BACKTEST ENGINE
// Historical data testing for strategy validation
// ═══════════════════════════════════════════════════════════════════════════

import { BotConfig, Candle, TradeResult, BotState } from './types';
import { IndicatorCalculator } from './indicators';
import { TradingStrategy } from './strategies';
import { RiskManager } from './risk';
import { Logger } from './utils/logger';

interface BacktestResult {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    totalPnlPercent: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    profitFactor: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    averageTradeDuration: number;
    trades: TradeResult[];
}

export class Backtester {
    private config: BotConfig;
    private strategy: TradingStrategy;
    private riskManager: RiskManager;
    private logger: Logger;

    constructor(config: BotConfig) {
        this.config = config;
        this.logger = new Logger('Backtest');
        this.strategy = new TradingStrategy(config);
        this.riskManager = new RiskManager(config.risk, this.logger);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RUN BACKTEST
    // ─────────────────────────────────────────────────────────────────────────
    run(candles: Candle[], initialEquity: number): BacktestResult {
        this.logger.info(`Starting backtest with ${candles.length} candles`);
        this.logger.info(`Initial equity: $${initialEquity}`);

        const trades: TradeResult[] = [];
        const equityCurve: number[] = [initialEquity];

        let state: BotState = {
            position: null,
            dailyPnl: 0,
            dailyTrades: 0,
            lastTradeTime: 0,
            lastLossTime: 0,
            isActive: true,
            equity: initialEquity,
            trades: []
        };

        let maxEquity = initialEquity;
        let maxDrawdown = 0;
        let currentDay = 0;

        // Need at least 200 candles for EMA200
        const startIndex = 200;

        for (let i = startIndex; i < candles.length; i++) {
            const candleSlice = candles.slice(0, i + 1);
            const currentCandle = candles[i];
            const currentPrice = currentCandle.close;

            // Reset daily stats at new day
            const candleDay = new Date(currentCandle.timestamp).getUTCDate();
            if (candleDay !== currentDay) {
                state = this.riskManager.resetDailyStats(state);
                currentDay = candleDay;
            }

            // Generate funding (simulated - random between -0.01% to 0.01%)
            const fundingRate = (Math.random() - 0.5) * 0.0002;

            // Calculate indicators
            const indicators = IndicatorCalculator.getIndicators(candleSlice, this.config, fundingRate);

            // Check SL/TP if position exists
            if (state.position) {
                const sltpCheck = this.riskManager.checkSLTP(state.position, currentPrice);

                if (sltpCheck.hit) {
                    const { pnl, pnlPercent } = this.riskManager.calculatePnl(
                        state.position,
                        currentPrice,
                        this.config.leverage
                    );

                    const tradeResult: TradeResult = {
                        side: state.position.side,
                        entryPrice: state.position.entryPrice,
                        exitPrice: currentPrice,
                        pnl,
                        pnlPercent,
                        duration: currentCandle.timestamp - state.position.entryTime,
                        exitReason: sltpCheck.type!
                    };

                    trades.push(tradeResult);
                    state = this.riskManager.updateStateAfterTrade(state, tradeResult);
                }
            }

            // Generate signal
            const signal = this.strategy.generateSignal(indicators, state.position, currentPrice);

            // Execute signal
            if (signal === 'LONG' || signal === 'SHORT') {
                const riskCheck = this.riskManager.canOpenPosition(state);

                if (riskCheck.allowed) {
                    const { stopLoss, takeProfit } = this.strategy.calculateSLTP(
                        signal,
                        currentPrice,
                        indicators.atr
                    );

                    const positionSize = this.riskManager.calculatePositionSize(
                        state.equity,
                        currentPrice,
                        stopLoss,
                        this.config.leverage
                    );

                    state.position = {
                        side: signal,
                        entryPrice: currentPrice,
                        size: positionSize,
                        stopLoss,
                        takeProfit,
                        entryTime: currentCandle.timestamp,
                        unrealizedPnl: 0
                    };
                }
            } else if (signal === 'CLOSE' && state.position) {
                const { pnl, pnlPercent } = this.riskManager.calculatePnl(
                    state.position,
                    currentPrice,
                    this.config.leverage
                );

                const tradeResult: TradeResult = {
                    side: state.position.side,
                    entryPrice: state.position.entryPrice,
                    exitPrice: currentPrice,
                    pnl,
                    pnlPercent,
                    duration: currentCandle.timestamp - state.position.entryTime,
                    exitReason: 'SIGNAL'
                };

                trades.push(tradeResult);
                state = this.riskManager.updateStateAfterTrade(state, tradeResult);
            }

            // Track equity curve and drawdown
            equityCurve.push(state.equity);

            if (state.equity > maxEquity) {
                maxEquity = state.equity;
            }

            const currentDrawdown = maxEquity - state.equity;
            if (currentDrawdown > maxDrawdown) {
                maxDrawdown = currentDrawdown;
            }
        }

        // Calculate results
        return this.calculateResults(trades, initialEquity, state.equity, maxDrawdown);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE RESULTS
    // ─────────────────────────────────────────────────────────────────────────
    private calculateResults(
        trades: TradeResult[],
        initialEquity: number,
        finalEquity: number,
        maxDrawdown: number
    ): BacktestResult {
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);

        const totalPnl = finalEquity - initialEquity;
        const totalPnlPercent = (totalPnl / initialEquity) * 100;
        const maxDrawdownPercent = (maxDrawdown / initialEquity) * 100;

        const winRate = trades.length > 0
            ? (winningTrades.length / trades.length) * 100
            : 0;

        const averageWin = winningTrades.length > 0
            ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
            : 0;

        const averageLoss = losingTrades.length > 0
            ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losingTrades.length
            : 0;

        const largestWin = winningTrades.length > 0
            ? Math.max(...winningTrades.map(t => t.pnl))
            : 0;

        const largestLoss = losingTrades.length > 0
            ? Math.min(...losingTrades.map(t => t.pnl))
            : 0;

        const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        const averageTradeDuration = trades.length > 0
            ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length
            : 0;

        // Simplified Sharpe (using daily returns would be more accurate)
        const returns = trades.map(t => t.pnlPercent);
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdDev = returns.length > 0
            ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
            : 1;
        const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            totalPnl,
            totalPnlPercent,
            maxDrawdown,
            maxDrawdownPercent,
            sharpeRatio,
            profitFactor,
            averageWin,
            averageLoss,
            largestWin,
            largestLoss,
            averageTradeDuration,
            trades
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRINT RESULTS
    // ─────────────────────────────────────────────────────────────────────────
    printResults(results: BacktestResult): void {
        console.log(`
    ╔═══════════════════════════════════════════════════════════════════════╗
    ║                        BACKTEST RESULTS                               ║
    ╠═══════════════════════════════════════════════════════════════════════╣
    ║                                                                       ║
    ║  PERFORMANCE                                                          ║
    ║  ──────────────────────────────────────────────────────────────────   ║
    ║  Total PnL:          $${results.totalPnl.toFixed(2).padStart(12)} (${results.totalPnlPercent.toFixed(2)}%)
    ║  Max Drawdown:       $${results.maxDrawdown.toFixed(2).padStart(12)} (${results.maxDrawdownPercent.toFixed(2)}%)
    ║  Sharpe Ratio:       ${results.sharpeRatio.toFixed(2).padStart(12)}
    ║  Profit Factor:      ${results.profitFactor.toFixed(2).padStart(12)}
    ║                                                                       ║
    ║  TRADES                                                               ║
    ║  ──────────────────────────────────────────────────────────────────   ║
    ║  Total Trades:       ${String(results.totalTrades).padStart(12)}
    ║  Winning:            ${String(results.winningTrades).padStart(12)}
    ║  Losing:             ${String(results.losingTrades).padStart(12)}
    ║  Win Rate:           ${results.winRate.toFixed(1).padStart(11)}%
    ║                                                                       ║
    ║  Average Win:        $${results.averageWin.toFixed(2).padStart(12)}
    ║  Average Loss:       $${results.averageLoss.toFixed(2).padStart(12)}
    ║  Largest Win:        $${results.largestWin.toFixed(2).padStart(12)}
    ║  Largest Loss:       $${results.largestLoss.toFixed(2).padStart(12)}
    ║                                                                       ║
    ║  Avg Trade Duration: ${(results.averageTradeDuration / 3600000).toFixed(1).padStart(11)}h
    ║                                                                       ║
    ╚═══════════════════════════════════════════════════════════════════════╝
    `);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// SAMPLE DATA GENERATOR (for testing)
// Replace with real historical data
// ─────────────────────────────────────────────────────────────────────────
function generateSampleData(days: number): Candle[] {
    const candles: Candle[] = [];
    const candlesPerDay = 96; // 15m timeframe
    const totalCandles = days * candlesPerDay;

    let price = 40000; // Starting BTC price
    const timestamp = Date.now() - (totalCandles * 15 * 60 * 1000);

    for (let i = 0; i < totalCandles; i++) {
        // Random walk with trend
        const trend = Math.sin(i / 500) * 0.001; // Slow trend
        const volatility = 0.002 + Math.random() * 0.003;
        const change = (Math.random() - 0.5 + trend) * volatility;

        price = price * (1 + change);

        const high = price * (1 + Math.random() * 0.005);
        const low = price * (1 - Math.random() * 0.005);
        const open = price * (1 + (Math.random() - 0.5) * 0.003);
        const close = price;
        const volume = 1000000 + Math.random() * 5000000;

        candles.push({
            timestamp: timestamp + (i * 15 * 60 * 1000),
            open,
            high,
            low,
            close,
            volume
        });
    }

    return candles;
}

// ─────────────────────────────────────────────────────────────────────────
// RUN BACKTEST
// ─────────────────────────────────────────────────────────────────────────
async function main() {
    const config: BotConfig = {
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

    console.log('Generating sample data (90 days)...');
    const candles = generateSampleData(90);

    console.log('Running backtest...');
    const backtester = new Backtester(config);
    const results = backtester.run(candles, 10000);

    backtester.printResults(results);

    // Show some sample trades
    console.log('\n📊 Sample Trades (last 10):');
    console.log('─'.repeat(80));

    const lastTrades = results.trades.slice(-10);
    for (const trade of lastTrades) {
        const emoji = trade.pnl >= 0 ? '✅' : '❌';
        console.log(
            `${emoji} ${trade.side.padEnd(5)} | ` +
            `Entry: $${trade.entryPrice.toFixed(2)} | ` +
            `Exit: $${trade.exitPrice.toFixed(2)} | ` +
            `PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%) | ` +
            `${trade.exitReason}`
        );
    }
}

main().catch(console.error);
