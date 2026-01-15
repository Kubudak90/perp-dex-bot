// ═══════════════════════════════════════════════════════════════════════════
// PERP DEX BOT - MAIN ENGINE
// Coordinates strategy, risk, and exchange
// ═══════════════════════════════════════════════════════════════════════════

import { BotConfig, BotState, Signal, TradeResult, StrategyType, MarketRegime } from './types';
import type { Position } from './types';
import { IndicatorCalculator } from './indicators';
import { TradingStrategy } from './strategies';
import { RiskManager } from './risk';
import { Logger } from './utils/logger';
import { IExchange } from './utils/exchange';
import { NotificationService } from './utils/notifications';
import { DatabaseService } from './utils/database';
import { AnalyticsService } from './utils/analytics';

export interface BotServices {
    notifications?: NotificationService;
    database?: DatabaseService;
    analytics?: AnalyticsService;
}

export class PerpBot {
    private config: BotConfig;
    private state: BotState;
    private strategy: TradingStrategy;
    private riskManager: RiskManager;
    private exchange: IExchange;
    private logger: Logger;
    private isRunning: boolean = false;

    // Phase 3 services (optional)
    private notificationService?: NotificationService;
    private databaseService?: DatabaseService;
    private analyticsService?: AnalyticsService;

    constructor(config: BotConfig, exchange: IExchange, services?: BotServices) {
        this.config = config;
        this.exchange = exchange;
        this.logger = new Logger('PerpBot');
        this.strategy = new TradingStrategy(config);
        this.riskManager = new RiskManager(config.risk, this.logger);

        // Optional services
        this.notificationService = services?.notifications;
        this.databaseService = services?.database;
        this.analyticsService = services?.analytics;

        this.state = {
            position: null,
            dailyPnl: 0,
            dailyTrades: 0,
            lastTradeTime: 0,
            lastLossTime: 0,
            isActive: true,
            equity: 0,
            trades: [],
            // Phase 2 advanced fields
            consecutiveLosses: 0,
            peakPrice: undefined,
            portfolioHeat: 0
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZE BOT
    // ─────────────────────────────────────────────────────────────────────────
    async initialize(): Promise<void> {
        this.logger.info('═══════════════════════════════════════════════════════');
        this.logger.info('PERP DEX BOT - Initializing...');
        this.logger.info('═══════════════════════════════════════════════════════');

        await this.exchange.connect();

        // Get initial balance
        this.state.equity = await this.exchange.getBalance();
        this.logger.info(`Initial equity: $${this.state.equity.toFixed(2)}`);

        // Check for existing position
        const existingPosition = await this.exchange.getPosition(this.config.symbol);
        if (existingPosition) {
            this.state.position = existingPosition;
            this.logger.info(`Existing position found: ${existingPosition.side} @ ${existingPosition.entryPrice}`);
        }

        this.logger.info('Bot initialized successfully');
        this.logConfig();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN LOOP
    // ─────────────────────────────────────────────────────────────────────────
    async start(): Promise<void> {
        this.isRunning = true;
        this.logger.info('🚀 Bot started');

        while (this.isRunning) {
            try {
                await this.tick();
                await this.sleep(this.getTickInterval());
            } catch (error) {
                this.logger.error('Error in main loop', error as Error);

                // Notify about error
                if (this.notificationService) {
                    await this.notificationService.notifyError(
                        error as Error,
                        'Main trading loop'
                    ).catch(err => this.logger.error('Failed to send error notification', err as Error));
                }

                await this.sleep(5000);
            }
        }
    }

    stop(): void {
        this.isRunning = false;
        this.logger.info('🛑 Bot stopped');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SINGLE TICK (one decision cycle)
    // ─────────────────────────────────────────────────────────────────────────
    async tick(): Promise<void> {
        // 1. Fetch market data
        const candles = await this.exchange.getCandles(
            this.config.symbol,
            this.config.timeframe,
            250 // Need enough for EMA200
        );

        if (candles.length < 200) {
            this.logger.warn('Not enough candles for indicators');
            return;
        }

        const fundingRate = await this.exchange.getFundingRate(this.config.symbol);
        const currentPrice = await this.exchange.getMarkPrice(this.config.symbol);

        // 2. Calculate indicators
        const indicators = IndicatorCalculator.getIndicators(candles, this.config, fundingRate);

        // 3. Update position PnL if exists
        if (this.state.position) {
            this.updatePositionPnl(currentPrice);

            // Phase 2: Update trailing stop if enabled
            if (this.config.risk.useTrailingStop && this.state.peakPrice !== undefined) {
                const { newStopLoss, newPeakPrice } = this.riskManager.updateTrailingStop(
                    this.state.position,
                    currentPrice,
                    this.state.peakPrice
                );
                if (newStopLoss !== this.state.position.stopLoss) {
                    this.state.position.stopLoss = newStopLoss;
                    this.state.peakPrice = newPeakPrice;
                    await this.exchange.setStopLoss(this.config.symbol, newStopLoss);
                    this.logger.info(`📊 Trailing SL updated: ${newStopLoss.toFixed(2)}`);
                }
            }

            // Phase 2: Check if position should be force-closed (max hold time)
            if (this.riskManager.shouldForceClose(this.state.position)) {
                this.logger.warn('⏰ Max hold time reached - Force closing position');
                await this.executeClose(currentPrice, 'FORCE_CLOSE');
                return;
            }

            // Phase 6B: Check partial TP levels
            if (this.config.usePartialTp && this.state.position.partialTpPrices) {
                const partialTpCheck = this.strategy.checkPartialTP(
                    this.state.position,
                    currentPrice,
                    this.state.position.partialTpPrices
                );

                if (partialTpCheck && partialTpCheck.hit) {
                    await this.executePartialClose(currentPrice, partialTpCheck.level);
                }
            }

            // Check SL/TP
            const sltpCheck = this.riskManager.checkSLTP(this.state.position, currentPrice);
            if (sltpCheck.hit) {
                await this.executeClose(currentPrice, sltpCheck.type!);
                return;
            }
        }

        // 4. Generate signal (with market regime info for strategy selection)
        const signal = this.strategy.generateSignal(indicators, this.state.position, currentPrice);

        // 5. Execute signal (pass indicators for dynamic SL and regime-based sizing)
        await this.executeSignal(signal, currentPrice, indicators.atr, indicators);

        // Debug output (every tick)
        this.logger.debug(this.strategy.getStateDebug(indicators));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTE SIGNAL
    // ─────────────────────────────────────────────────────────────────────────
    private async executeSignal(
        signal: Signal,
        currentPrice: number,
        atr: number,
        indicators?: { atrPercentile?: number; marketRegime?: { regime: MarketRegime; confidence: number } }
    ): Promise<void> {
        if (signal === 'NONE') return;

        if (signal === 'CLOSE' && this.state.position) {
            await this.executeClose(currentPrice, 'SIGNAL');
            return;
        }

        if (signal === 'LONG' || signal === 'SHORT') {
            // Check risk limits (includes consecutive losses check)
            const riskCheck = this.riskManager.canOpenPosition(this.state);
            if (!riskCheck.allowed) {
                this.logger.warn(`Trade blocked: ${riskCheck.reason}`);
                return;
            }

            await this.executeOpen(signal, currentPrice, atr, indicators);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OPEN POSITION
    // ─────────────────────────────────────────────────────────────────────────
    private async executeOpen(
        side: 'LONG' | 'SHORT',
        currentPrice: number,
        atr: number,
        indicators?: { atrPercentile?: number; marketRegime?: { regime: MarketRegime; confidence: number } }
    ): Promise<void> {
        // Calculate SL/TP with dynamic SL based on volatility (Phase 6B)
        const sltpResult = this.strategy.calculateSLTP(side, currentPrice, atr, indicators?.atrPercentile);
        const { stopLoss, takeProfit, partialTpLevels } = sltpResult;

        // Calculate position size
        let positionSize = this.riskManager.calculatePositionSize(
            this.state.equity,
            currentPrice,
            stopLoss,
            this.config.leverage
        );

        // Phase 6B: Adjust position size based on market regime
        const sizeMultiplier = this.strategy.calculatePositionSizeMultiplier(indicators?.marketRegime);
        if (sizeMultiplier !== 1.0) {
            positionSize = positionSize * sizeMultiplier;
            this.logger.info(`📊 Position size adjusted by ${(sizeMultiplier * 100).toFixed(0)}% due to ${indicators?.marketRegime?.regime} regime`);
        }

        // Execute order
        const result = await this.exchange.openPosition(
            this.config.symbol,
            side,
            positionSize,
            this.config.leverage
        );

        // Determine current strategy type based on market regime
        const currentStrategy: StrategyType = this.determineStrategyType(indicators?.marketRegime?.regime);

        // Update state with all tracking fields
        this.state.position = {
            side,
            entryPrice: result.avgPrice,
            size: positionSize,
            stopLoss,
            takeProfit,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            // Phase 6B: Partial TP tracking
            initialSize: positionSize,
            remainingSize: positionSize,
            partialTpLevels: [],
            partialTpPrices: partialTpLevels,
            // Strategy tracking
            strategy: currentStrategy,
            marketRegimeAtEntry: indicators?.marketRegime?.regime
        };

        // Phase 2: Initialize peak price for trailing stop
        if (this.config.risk.useTrailingStop) {
            this.state.peakPrice = result.avgPrice;
        }

        // Phase 2: Update portfolio heat
        if (this.config.risk.maxPortfolioHeat) {
            this.state.portfolioHeat = this.riskManager.calculatePortfolioHeat(
                this.state.position,
                this.state.equity
            );
        }

        // Set SL/TP orders
        await this.exchange.setStopLoss(this.config.symbol, stopLoss);
        await this.exchange.setTakeProfit(this.config.symbol, takeProfit);

        const regimeInfo = indicators?.marketRegime ? ` | Regime: ${indicators.marketRegime.regime}` : '';
        this.logger.trade(side, result.avgPrice, `SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)}${regimeInfo}`);

        // Phase 3: Send notification
        if (this.notificationService) {
            await this.notificationService.notifyTradeOpened(
                side,
                this.config.symbol,
                result.avgPrice,
                positionSize,
                stopLoss,
                takeProfit
            ).catch(err => this.logger.error('Failed to send trade notification', err as Error));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DETERMINE STRATEGY TYPE based on market regime
    // ─────────────────────────────────────────────────────────────────────────
    private determineStrategyType(regime?: MarketRegime): StrategyType {
        if (!regime) return 'SUPERTREND';

        switch (regime) {
            case 'TRENDING':
                return 'SUPERTREND';  // Trend following works best
            case 'VOLATILE':
                return 'MOMENTUM';     // Quick momentum plays in volatility
            case 'RANGING':
                return 'MEAN_REVERSION'; // Buy low, sell high in ranges
            case 'QUIET':
                return 'SCALP';        // Small moves, tight stops
            default:
                return 'SUPERTREND';
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PARTIAL CLOSE (Phase 6B)
    // ─────────────────────────────────────────────────────────────────────────
    private async executePartialClose(currentPrice: number, tpLevel: number): Promise<void> {
        if (!this.state.position || !this.config.partialTpLevels) return;

        // Determine how much to close based on level
        const levelConfig = tpLevel === 1
            ? this.config.partialTpLevels.level1
            : tpLevel === 2
                ? this.config.partialTpLevels.level2
                : this.config.partialTpLevels.level3;

        if (!levelConfig) return;

        const closePercent = levelConfig.closePercent / 100;
        const initialSize = this.state.position.initialSize || this.state.position.size;
        const closeSize = initialSize * closePercent;

        // Calculate PnL for this partial close
        const { pnl, pnlPercent } = this.riskManager.calculatePnl(
            { ...this.state.position, size: closeSize },
            currentPrice,
            this.config.leverage
        );

        // Update position
        this.state.position.size -= closeSize;
        this.state.position.remainingSize = this.state.position.size;
        this.state.position.partialTpLevels = [
            ...(this.state.position.partialTpLevels || []),
            tpLevel
        ];

        // Update equity
        this.state.equity += pnl;
        this.state.dailyPnl += pnl;

        this.logger.info(
            `📈 Partial TP Level ${tpLevel} hit! Closed ${(closePercent * 100).toFixed(0)}% @ ${currentPrice.toFixed(2)} | ` +
            `PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | Remaining: ${(this.state.position.size * 100 / initialSize).toFixed(0)}%`
        );

        // Move stop loss to breakeven after first partial TP
        if (tpLevel === 1 && this.state.position.entryPrice) {
            const breakEvenSL = this.state.position.side === 'LONG'
                ? this.state.position.entryPrice * 1.001  // Slightly above entry
                : this.state.position.entryPrice * 0.999; // Slightly below entry

            if ((this.state.position.side === 'LONG' && breakEvenSL > this.state.position.stopLoss) ||
                (this.state.position.side === 'SHORT' && breakEvenSL < this.state.position.stopLoss)) {
                this.state.position.stopLoss = breakEvenSL;
                await this.exchange.setStopLoss(this.config.symbol, breakEvenSL);
                this.logger.info(`🛡️ Stop loss moved to breakeven: ${breakEvenSL.toFixed(2)}`);
            }
        }

        // Send notification
        if (this.notificationService) {
            await this.notificationService.notifyRiskAlert(
                `Partial TP ${tpLevel}/3 hit! PnL: $${pnl.toFixed(2)}`,
                'info'
            ).catch(err => this.logger.error('Failed to send partial TP notification', err as Error));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLOSE POSITION
    // ─────────────────────────────────────────────────────────────────────────
    private async executeClose(
        _currentPrice: number,
        reason: 'SL' | 'TP' | 'SIGNAL' | 'FORCE_CLOSE'
    ): Promise<void> {
        if (!this.state.position) return;

        const result = await this.exchange.closePosition(
            this.config.symbol,
            this.state.position
        );

        // Calculate PnL
        const { pnl, pnlPercent } = this.riskManager.calculatePnl(
            this.state.position,
            result.avgPrice,
            this.config.leverage
        );

        // Create trade result
        const tradeResult: TradeResult = {
            side: this.state.position.side,
            entryPrice: this.state.position.entryPrice,
            exitPrice: result.avgPrice,
            pnl,
            pnlPercent,
            duration: Date.now() - this.state.position.entryTime,
            exitReason: reason
        };

        // Phase 3: Save to database
        if (this.databaseService) {
            try {
                this.databaseService.saveTrade(
                    tradeResult,
                    this.config.symbol,
                    this.config.leverage,
                    this.state.position.size,
                    this.state.equity,
                    this.state.dailyPnl
                );
            } catch (err) {
                this.logger.error('Failed to save trade to database', err as Error);
            }
        }

        // Phase 3: Send notification
        if (this.notificationService) {
            await this.notificationService.notifyTradeClosed(
                tradeResult,
                this.config.symbol
            ).catch(err => this.logger.error('Failed to send trade notification', err as Error));
        }

        // Phase 2: Update state with advanced risk tracking
        if (this.config.risk.maxConsecutiveLosses || this.config.risk.maxPortfolioHeat) {
            this.state = this.riskManager.updateStateAfterTradeEnhanced(this.state, tradeResult);

            // Check consecutive losses and send alert
            if (this.state.consecutiveLosses && this.state.consecutiveLosses >= (this.config.risk.maxConsecutiveLosses || 3)) {
                if (this.notificationService) {
                    await this.notificationService.notifyRiskAlert(
                        `⚠️ Consecutive losses: ${this.state.consecutiveLosses}. Bot may pause trading.`,
                        'error'
                    ).catch(err => this.logger.error('Failed to send risk alert', err as Error));
                }
            }
        } else {
            // Standard state update
            this.state = this.riskManager.updateStateAfterTrade(this.state, tradeResult);
        }

        // Reset peak price after closing position
        this.state.peakPrice = undefined;
        this.state.portfolioHeat = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE POSITION PNL
    // ─────────────────────────────────────────────────────────────────────────
    private updatePositionPnl(currentPrice: number): void {
        if (!this.state.position) return;

        const { pnl } = this.riskManager.calculatePnl(
            this.state.position,
            currentPrice,
            this.config.leverage
        );

        this.state.position.unrealizedPnl = pnl;

        // Phase 2: Update peak price for trailing stop
        if (this.config.risk.useTrailingStop && this.state.peakPrice !== undefined) {
            if (this.state.position.side === 'LONG' && currentPrice > this.state.peakPrice) {
                this.state.peakPrice = currentPrice;
            } else if (this.state.position.side === 'SHORT' && currentPrice < this.state.peakPrice) {
                this.state.peakPrice = currentPrice;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private getTickInterval(): number {
        // Tick at candle close + small buffer
        const map: Record<string, number> = {
            '1m': 60000,
            '5m': 300000,
            '15m': 900000,
            '30m': 1800000,
            '1h': 3600000,
            '4h': 14400000
        };
        return map[this.config.timeframe] || 60000;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private logConfig(): void {
        this.logger.info(`
    ┌─────────────────────────────────────────┐
    │ BOT CONFIGURATION                       │
    ├─────────────────────────────────────────┤
    │ Symbol:       ${this.config.symbol}
    │ Timeframe:    ${this.config.timeframe}
    │ Leverage:     ${this.config.leverage}x
    │ Supertrend:   ${this.config.supertrendPeriod} / ${this.config.supertrendMultiplier}
    │ EMA:          ${this.config.emaFastPeriod} / ${this.config.emaSlowPeriod}
    │ ADX:          ${this.config.adxPeriod} (threshold: ${this.config.adxThreshold})
    │ Risk/Reward:  1:${this.config.risk.riskRewardRatio}
    │ Max Daily:    ${this.config.risk.maxDailyTrades} trades
    │ Max Loss:     ${this.config.risk.maxDailyLoss}%
    └─────────────────────────────────────────┘`);
    }

    // Public getters
    getState(): BotState {
        return this.state;
    }

    getRiskStats(): string {
        return this.riskManager.getRiskStats(this.state);
    }
}
