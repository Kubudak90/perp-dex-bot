// ═══════════════════════════════════════════════════════════════════════════
// PERP DEX BOT - MAIN ENGINE
// Coordinates strategy, risk, and exchange
// ═══════════════════════════════════════════════════════════════════════════

import { BotConfig, BotState, Signal, TradeResult, ExternalData } from './types';
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

    // Daily reset tracking
    private lastResetDay: number = -1;

    // Partial TP tracking
    private partialTpLevels?: { level1: number; level2: number; level3: number };

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

        // Initialize daily reset tracking
        this.lastResetDay = new Date().getUTCDate();

        this.logger.info('Bot initialized successfully');
        this.logConfig();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN LOOP
    // ─────────────────────────────────────────────────────────────────────────
    async start(): Promise<void> {
        this.isRunning = true;
        this.logger.info('Bot started');

        while (this.isRunning) {
            try {
                // Check for daily reset
                this.checkDailyReset();

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
        this.logger.info('Bot stopped');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK DAILY RESET
    // ─────────────────────────────────────────────────────────────────────────
    private checkDailyReset(): void {
        const currentDay = new Date().getUTCDate();

        if (currentDay !== this.lastResetDay) {
            this.logger.info('New day detected - resetting daily stats');
            this.state = this.riskManager.resetDailyStats(this.state);
            this.lastResetDay = currentDay;

            // Send daily summary notification
            if (this.notificationService && this.state.trades.length > 0) {
                this.notificationService.notifyDailySummary(this.state)
                    .catch((err: Error) => this.logger.error('Failed to send daily summary', err));
            }
        }
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
                    this.logger.info(`Trailing SL updated: ${newStopLoss.toFixed(2)}`);
                }
            }

            // Phase 2: Check if position should be force-closed (max hold time)
            if (this.riskManager.shouldForceClose(this.state.position)) {
                this.logger.warn('Max hold time reached - Force closing position');
                await this.executeClose(currentPrice, 'SIGNAL');
                return;
            }

            // Phase 6B: Check Partial Take Profit levels
            if (this.config.usePartialTp && this.partialTpLevels) {
                const partialCheck = this.strategy.checkPartialTP(
                    this.state.position,
                    currentPrice,
                    this.partialTpLevels
                );

                if (partialCheck?.hit) {
                    await this.executePartialClose(currentPrice, partialCheck.level);
                }
            }

            // Check SL/TP
            const sltpCheck = this.riskManager.checkSLTP(this.state.position, currentPrice);
            if (sltpCheck.hit) {
                await this.executeClose(currentPrice, sltpCheck.type!);
                return;
            }
        }

        // 4. Generate signal (with optional external data)
        const externalData: ExternalData | undefined = undefined;
        const signal = this.strategy.generateSignal(indicators, this.state.position, currentPrice, externalData);

        // 5. Execute signal
        await this.executeSignal(signal, currentPrice, indicators.atr, indicators.atrPercentile);

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
        atrPercentile?: number
    ): Promise<void> {
        if (signal === 'NONE') return;

        if (signal === 'CLOSE' && this.state.position) {
            await this.executeClose(currentPrice, 'SIGNAL');
            return;
        }

        if (signal === 'LONG' || signal === 'SHORT') {
            // Check risk limits
            const riskCheck = this.riskManager.canOpenPosition(this.state);
            if (!riskCheck.allowed) {
                this.logger.warn(`Trade blocked: ${riskCheck.reason}`);
                return;
            }

            await this.executeOpen(signal, currentPrice, atr, atrPercentile);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OPEN POSITION
    // ─────────────────────────────────────────────────────────────────────────
    private async executeOpen(
        side: 'LONG' | 'SHORT',
        currentPrice: number,
        atr: number,
        atrPercentile?: number
    ): Promise<void> {
        // Calculate SL/TP (with dynamic SL if enabled)
        const sltpResult = this.strategy.calculateSLTP(side, currentPrice, atr, atrPercentile);
        const { stopLoss, takeProfit } = sltpResult;

        // Store partial TP levels if enabled
        if (this.config.usePartialTp && sltpResult.partialTpLevels) {
            this.partialTpLevels = sltpResult.partialTpLevels;
        }

        // Calculate position size
        let positionSize = this.riskManager.calculatePositionSize(
            this.state.equity,
            currentPrice,
            stopLoss,
            this.config.leverage
        );

        // Apply market regime multiplier if enabled
        if (this.config.useMarketRegime) {
            const candles = await this.exchange.getCandles(this.config.symbol, this.config.timeframe, 250);
            const fundingRate = await this.exchange.getFundingRate(this.config.symbol);
            const indicators = IndicatorCalculator.getIndicators(candles, this.config, fundingRate);
            const multiplier = this.strategy.calculatePositionSizeMultiplier(indicators.marketRegime);
            positionSize *= multiplier;

            if (multiplier < 1) {
                this.logger.info(`Position size reduced by ${((1 - multiplier) * 100).toFixed(0)}% due to market regime`);
            }
        }

        // Execute order
        const result = await this.exchange.openPosition(
            this.config.symbol,
            side,
            positionSize,
            this.config.leverage
        );

        // Update state
        this.state.position = {
            side,
            entryPrice: result.avgPrice,
            size: positionSize,
            stopLoss,
            takeProfit,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            initialSize: positionSize,
            remainingSize: positionSize,
            partialTpLevels: []
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

        this.logger.trade(side, result.avgPrice, `SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)}`);

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
    // PARTIAL CLOSE (Phase 6B)
    // ─────────────────────────────────────────────────────────────────────────
    private async executePartialClose(currentPrice: number, level: number): Promise<void> {
        if (!this.state.position || !this.config.partialTpLevels) return;

        // Get close percentage for this level
        const levelConfig = level === 1
            ? this.config.partialTpLevels.level1
            : level === 2
                ? this.config.partialTpLevels.level2
                : this.config.partialTpLevels.level3;

        if (!levelConfig) return;

        const closePercent = levelConfig.closePercent / 100;
        const closeSize = this.state.position.size * closePercent;

        this.logger.info(`Partial TP Level ${level} hit - Closing ${(closePercent * 100).toFixed(0)}% of position`);

        // Calculate PnL for partial close
        const { pnl, pnlPercent } = this.riskManager.calculatePnl(
            { ...this.state.position, size: closeSize },
            currentPrice,
            this.config.leverage
        );

        // Update state
        this.state.dailyPnl += pnl;
        this.state.equity += pnl;
        this.state.position.size -= closeSize;
        this.state.position.remainingSize = this.state.position.size;
        this.state.position.partialTpLevels = [
            ...(this.state.position.partialTpLevels || []),
            level
        ];

        this.logger.info(`Partial close: +$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | Remaining: ${this.state.position.size.toFixed(6)}`);

        // Move stop loss to breakeven after first partial TP
        if (level === 1 && this.state.position.size > 0) {
            const breakeven = this.state.position.entryPrice;
            this.state.position.stopLoss = breakeven;
            await this.exchange.setStopLoss(this.config.symbol, breakeven);
            this.logger.info(`SL moved to breakeven: ${breakeven.toFixed(2)}`);
        }

        // Send notification
        if (this.notificationService) {
            await this.notificationService.notifyRiskAlert(
                `Partial TP Level ${level}: +$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
                'info'
            ).catch(err => this.logger.error('Failed to send partial TP notification', err as Error));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLOSE POSITION
    // ─────────────────────────────────────────────────────────────────────────
    private async executeClose(
        _currentPrice: number,
        reason: 'SL' | 'TP' | 'SIGNAL'
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
                        `Consecutive losses: ${this.state.consecutiveLosses}. Bot may pause trading.`,
                        'error'
                    ).catch(err => this.logger.error('Failed to send risk alert', err as Error));
                }
            }
        } else {
            // Standard state update
            this.state = this.riskManager.updateStateAfterTrade(this.state, tradeResult);
        }

        // Reset peak price and partial TP tracking after closing position
        this.state.peakPrice = undefined;
        this.state.portfolioHeat = 0;
        this.partialTpLevels = undefined;
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
    │ Risk/Trade:   ${this.config.risk.riskPerTrade ?? 1}%
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
