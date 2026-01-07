// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED BACKTEST ENGINE V2
// Realistic simulation with fees, slippage, intra-candle execution
// ═══════════════════════════════════════════════════════════════════════════

import { BotConfig, Candle, TradeResult, BotState } from './types';
import { IndicatorCalculator } from './indicators';
import { TradingStrategy } from './strategies';
import { RiskManager } from './risk';
import { Logger } from './utils/logger';

// ─────────────────────────────────────────────────────────────────────────
// ENHANCED TYPES
// ─────────────────────────────────────────────────────────────────────────
interface ExchangeFees {
    maker: number;    // e.g., 0.0002 = 0.02%
    taker: number;    // e.g., 0.0005 = 0.05%
}

interface SlippageModel {
    baseSlippage: number;      // Base slippage %
    volumeImpact: number;      // Additional slippage per $1M volume
    liquidityFactor: number;   // 0-1, lower = more slippage
}

interface BacktestConfig extends BotConfig {
    fees: ExchangeFees;
    slippage: SlippageModel;
    useIntraCandleSLTP: boolean;  // Check high/low for SL/TP
}

interface EnhancedTradeResult extends TradeResult {
    fees: number;
    slippage: number;
    actualEntry: number;    // Entry after slippage
    actualExit: number;     // Exit after slippage
}

interface DetailedBacktestResult {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;

    // PnL
    totalPnl: number;
    totalPnlPercent: number;
    grossProfit: number;
    grossLoss: number;

    // Costs
    totalFees: number;
    totalSlippage: number;
    netPnl: number;         // After fees and slippage

    // Risk metrics
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    sortinoRatio: number;
    profitFactor: number;

    // Trade statistics
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    averageTradeDuration: number;

    // Equity curve
    equityCurve: number[];
    drawdownCurve: number[];

    // Trades
    trades: EnhancedTradeResult[];
}

// ─────────────────────────────────────────────────────────────────────────
// ENHANCED BACKTESTER
// ─────────────────────────────────────────────────────────────────────────
export class EnhancedBacktester {
    private config: BacktestConfig;
    private strategy: TradingStrategy;
    private riskManager: RiskManager;
    private logger: Logger;

    constructor(config: BacktestConfig) {
        this.config = config;
        this.logger = new Logger('EnhancedBacktest');
        this.strategy = new TradingStrategy(config);
        this.riskManager = new RiskManager(config.risk, this.logger);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN BACKTEST ENGINE
    // ─────────────────────────────────────────────────────────────────────────
    run(candles: Candle[], initialEquity: number): DetailedBacktestResult {
        this.logger.info(`Starting ENHANCED backtest with ${candles.length} candles`);
        this.logger.info(`Fees: Maker ${this.config.fees.maker * 100}%, Taker ${this.config.fees.taker * 100}%`);
        this.logger.info(`Slippage: Base ${this.config.slippage.baseSlippage * 100}%`);

        const trades: EnhancedTradeResult[] = [];
        const equityCurve: number[] = [initialEquity];
        const drawdownCurve: number[] = [0];

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
        let totalFees = 0;
        let totalSlippage = 0;

        // Need at least 200 candles for EMA200
        const startIndex = 200;

        for (let i = startIndex; i < candles.length; i++) {
            const candleSlice = candles.slice(0, i + 1);
            const currentCandle = candles[i];

            // Reset daily stats at new day
            const candleDay = new Date(currentCandle.timestamp).getUTCDate();
            if (candleDay !== currentDay) {
                state = this.riskManager.resetDailyStats(state);
                currentDay = candleDay;
            }

            // Calculate funding rate (more realistic simulation)
            const fundingRate = this.simulateFundingRate(candles, i);

            // Calculate indicators
            const indicators = IndicatorCalculator.getIndicators(
                candleSlice,
                this.config,
                fundingRate
            );

            // ═══════════════════════════════════════════════════════════════
            // INTRA-CANDLE SL/TP CHECK (using candle high/low)
            // ═══════════════════════════════════════════════════════════════
            if (state.position && this.config.useIntraCandleSLTP) {
                const slHit = this.checkIntraCandleSL(state.position, currentCandle);
                const tpHit = this.checkIntraCandleTP(state.position, currentCandle);

                if (slHit || tpHit) {
                    const exitPrice = slHit ? state.position.stopLoss : state.position.takeProfit;
                    const exitReason = slHit ? 'SL' : 'TP';

                    const tradeResult = this.closeTrade(
                        state.position,
                        exitPrice,
                        exitReason,
                        currentCandle.timestamp,
                        currentCandle.volume
                    );

                    trades.push(tradeResult);
                    totalFees += tradeResult.fees;
                    totalSlippage += tradeResult.slippage;

                    state.equity += tradeResult.pnl;
                    state.dailyPnl += tradeResult.pnl;
                    state.dailyTrades += 1;
                    state.position = null;
                    state.lastTradeTime = currentCandle.timestamp;

                    if (tradeResult.pnl < 0) {
                        state.lastLossTime = currentCandle.timestamp;
                    }

                    this.logger.debug(
                        `${exitReason} Hit: ${tradeResult.side} @ $${exitPrice.toFixed(2)} | ` +
                        `PnL: $${tradeResult.pnl.toFixed(2)} | Fees: $${tradeResult.fees.toFixed(2)}`
                    );
                }
            }

            // Skip signal generation if we just closed a position
            if (state.position) {
                // Update equity curve
                equityCurve.push(state.equity);
                if (state.equity > maxEquity) maxEquity = state.equity;
                const dd = maxEquity - state.equity;
                if (dd > maxDrawdown) maxDrawdown = dd;
                drawdownCurve.push(dd);
                continue;
            }

            // ═══════════════════════════════════════════════════════════════
            // SIGNAL GENERATION
            // ═══════════════════════════════════════════════════════════════
            const signal = this.strategy.generateSignal(
                indicators,
                state.position,
                currentCandle.close
            );

            // ═══════════════════════════════════════════════════════════════
            // ENTRY LOGIC
            // ═══════════════════════════════════════════════════════════════
            if (signal === 'LONG' || signal === 'SHORT') {
                const riskCheck = this.riskManager.canOpenPosition(state);

                if (riskCheck.allowed) {
                    const { stopLoss, takeProfit } = this.strategy.calculateSLTP(
                        signal,
                        currentCandle.close,
                        indicators.atr
                    );

                    const positionSize = this.riskManager.calculatePositionSize(
                        state.equity,
                        currentCandle.close,
                        stopLoss,
                        this.config.leverage
                    );

                    // Calculate slippage and fees
                    const slippage = this.calculateSlippage(
                        currentCandle.close,
                        positionSize,
                        currentCandle.volume
                    );

                    const actualEntry = signal === 'LONG'
                        ? currentCandle.close * (1 + slippage)
                        : currentCandle.close * (1 - slippage);

                    const fee = this.calculateFee(
                        positionSize * actualEntry,
                        'taker' // Assume market orders
                    );

                    // Adjust entry for fees
                    state.equity -= fee;
                    totalFees += fee;
                    totalSlippage += positionSize * actualEntry * slippage;

                    state.position = {
                        side: signal,
                        entryPrice: actualEntry,
                        size: positionSize,
                        stopLoss,
                        takeProfit,
                        entryTime: currentCandle.timestamp,
                        unrealizedPnl: 0
                    };

                    this.logger.debug(
                        `Entry: ${signal} @ $${actualEntry.toFixed(2)} | ` +
                        `Size: ${positionSize.toFixed(4)} | SL: $${stopLoss.toFixed(2)} | ` +
                        `TP: $${takeProfit.toFixed(2)} | Fee: $${fee.toFixed(2)}`
                    );
                }
            }

            // Update equity curve
            equityCurve.push(state.equity);
            if (state.equity > maxEquity) maxEquity = state.equity;
            const dd = maxEquity - state.equity;
            if (dd > maxDrawdown) maxDrawdown = dd;
            drawdownCurve.push(dd);
        }

        // Close any remaining position at last candle
        if (state.position) {
            const lastCandle = candles[candles.length - 1];
            const tradeResult = this.closeTrade(
                state.position,
                lastCandle.close,
                'SIGNAL',
                lastCandle.timestamp,
                lastCandle.volume
            );
            trades.push(tradeResult);
            totalFees += tradeResult.fees;
            totalSlippage += tradeResult.slippage;
            state.equity += tradeResult.pnl;
        }

        // Calculate detailed results
        return this.calculateDetailedResults(
            trades,
            initialEquity,
            state.equity,
            maxDrawdown,
            totalFees,
            totalSlippage,
            equityCurve,
            drawdownCurve
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTRA-CANDLE SL/TP CHECKS
    // ─────────────────────────────────────────────────────────────────────────
    private checkIntraCandleSL(position: any, candle: Candle): boolean {
        if (position.side === 'LONG') {
            return candle.low <= position.stopLoss;
        } else {
            return candle.high >= position.stopLoss;
        }
    }

    private checkIntraCandleTP(position: any, candle: Candle): boolean {
        if (position.side === 'LONG') {
            return candle.high >= position.takeProfit;
        } else {
            return candle.low <= position.takeProfit;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLOSE TRADE WITH FEES AND SLIPPAGE
    // ─────────────────────────────────────────────────────────────────────────
    private closeTrade(
        position: any,
        exitPrice: number,
        exitReason: 'SL' | 'TP' | 'SIGNAL',
        timestamp: number,
        volume: number
    ): EnhancedTradeResult {
        // Calculate slippage
        const slippage = this.calculateSlippage(exitPrice, position.size, volume);
        const actualExit = position.side === 'LONG'
            ? exitPrice * (1 - slippage)  // Sell at worse price
            : exitPrice * (1 + slippage); // Buy back at worse price

        // Calculate gross PnL
        const { pnl: grossPnl, pnlPercent } = this.riskManager.calculatePnl(
            position,
            actualExit,
            this.config.leverage
        );

        // Calculate exit fee
        const exitFee = this.calculateFee(
            position.size * actualExit,
            'taker'
        );

        // Calculate slippage cost
        const slippageCost = position.size * Math.abs(exitPrice - actualExit);

        // Net PnL after fees and slippage
        const netPnl = grossPnl - exitFee - slippageCost;

        return {
            side: position.side,
            entryPrice: position.entryPrice,
            exitPrice: actualExit,
            actualEntry: position.entryPrice,
            actualExit,
            pnl: netPnl,
            pnlPercent,
            fees: exitFee,
            slippage: slippageCost,
            duration: timestamp - position.entryTime,
            exitReason
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SLIPPAGE MODEL
    // ─────────────────────────────────────────────────────────────────────────
    private calculateSlippage(price: number, size: number, volume: number): number {
        const { baseSlippage, volumeImpact, liquidityFactor } = this.config.slippage;

        // Position value
        const positionValue = price * size;

        // Volume impact (larger trades = more slippage)
        const volumeRatio = positionValue / (volume * price);
        const additionalSlippage = volumeRatio * volumeImpact;

        // Total slippage (adjusted by liquidity)
        const totalSlippage = (baseSlippage + additionalSlippage) / liquidityFactor;

        return Math.min(totalSlippage, 0.01); // Cap at 1%
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FEE CALCULATION
    // ─────────────────────────────────────────────────────────────────────────
    private calculateFee(positionValue: number, type: 'maker' | 'taker'): number {
        const feeRate = type === 'maker' ? this.config.fees.maker : this.config.fees.taker;
        return positionValue * feeRate;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REALISTIC FUNDING RATE SIMULATION
    // ─────────────────────────────────────────────────────────────────────────
    private simulateFundingRate(candles: Candle[], currentIndex: number): number {
        // More realistic: funding correlates with trend
        const lookback = 24; // 24 candles (6h for 15m candles)
        if (currentIndex < lookback) return 0;

        const recentCandles = candles.slice(currentIndex - lookback, currentIndex);
        const priceChange = (recentCandles[lookback - 1].close - recentCandles[0].close) /
            recentCandles[0].close;

        // Funding tends to follow trend
        // Strong uptrend = positive funding (longs pay shorts)
        // Strong downtrend = negative funding (shorts pay longs)
        const baseFunding = priceChange * 0.1; // 10% of price change
        const noise = (Math.random() - 0.5) * 0.0001; // Small random noise

        return Math.max(-0.001, Math.min(0.001, baseFunding + noise));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DETAILED RESULTS CALCULATION
    // ─────────────────────────────────────────────────────────────────────────
    private calculateDetailedResults(
        trades: EnhancedTradeResult[],
        initialEquity: number,
        finalEquity: number,
        maxDrawdown: number,
        totalFees: number,
        totalSlippage: number,
        equityCurve: number[],
        drawdownCurve: number[]
    ): DetailedBacktestResult {
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);

        const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

        const totalPnl = finalEquity - initialEquity;
        const netPnl = totalPnl; // Already includes fees/slippage

        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

        // Risk metrics
        const returns = trades.map(t => t.pnlPercent);
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

        // Sharpe Ratio
        const stdDev = returns.length > 0
            ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
            : 1;
        const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

        // Sortino Ratio (only downside volatility)
        const downsideReturns = returns.filter(r => r < 0);
        const downsideStdDev = downsideReturns.length > 0
            ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length)
            : 1;
        const sortinoRatio = downsideStdDev > 0 ? (avgReturn / downsideStdDev) * Math.sqrt(252) : 0;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,

            totalPnl,
            totalPnlPercent: (totalPnl / initialEquity) * 100,
            grossProfit,
            grossLoss,

            totalFees,
            totalSlippage,
            netPnl,

            maxDrawdown,
            maxDrawdownPercent: (maxDrawdown / initialEquity) * 100,
            sharpeRatio,
            sortinoRatio,
            profitFactor,

            averageWin: winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
                : 0,
            averageLoss: losingTrades.length > 0
                ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
                : 0,
            largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl)) : 0,
            largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnl)) : 0,
            averageTradeDuration: trades.length > 0
                ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length
                : 0,

            equityCurve,
            drawdownCurve,
            trades
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRINT ENHANCED RESULTS
    // ─────────────────────────────────────────────────────────────────────────
    printResults(results: DetailedBacktestResult): void {
        console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                   ENHANCED BACKTEST RESULTS V2                        ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  PERFORMANCE                                                          ║
║  ──────────────────────────────────────────────────────────────────   ║
║  Gross PnL:          $${results.totalPnl.toFixed(2).padStart(12)} (${results.totalPnlPercent.toFixed(2)}%)
║  Total Fees:         $${results.totalFees.toFixed(2).padStart(12)}
║  Total Slippage:     $${results.totalSlippage.toFixed(2).padStart(12)}
║  Net PnL:            $${results.netPnl.toFixed(2).padStart(12)} (${((results.netPnl / (results.totalPnl - results.netPnl + results.netPnl)) * 100).toFixed(2)}%)
║                                                                       ║
║  RISK METRICS                                                         ║
║  ──────────────────────────────────────────────────────────────────   ║
║  Max Drawdown:       $${results.maxDrawdown.toFixed(2).padStart(12)} (${results.maxDrawdownPercent.toFixed(2)}%)
║  Sharpe Ratio:       ${results.sharpeRatio.toFixed(2).padStart(12)}
║  Sortino Ratio:      ${results.sortinoRatio.toFixed(2).padStart(12)}
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
║  Avg Duration:       ${(results.averageTradeDuration / 3600000).toFixed(1).padStart(11)}h
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
        `);

        // Cost breakdown
        const totalCosts = results.totalFees + results.totalSlippage;
        const feePercent = (results.totalFees / totalCosts) * 100;
        const slippagePercent = (results.totalSlippage / totalCosts) * 100;

        console.log(`
📊 Cost Breakdown:
   Total Costs: $${totalCosts.toFixed(2)}
   ├─ Fees:     $${results.totalFees.toFixed(2)} (${feePercent.toFixed(1)}%)
   └─ Slippage: $${results.totalSlippage.toFixed(2)} (${slippagePercent.toFixed(1)}%)

💡 Cost Impact: ${((totalCosts / Math.abs(results.totalPnl)) * 100).toFixed(1)}% of gross PnL
        `);
    }
}
