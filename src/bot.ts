// ═══════════════════════════════════════════════════════════════════════════
// PERP DEX BOT - MAIN ENGINE
// Coordinates strategy, risk, and exchange
// ═══════════════════════════════════════════════════════════════════════════

import { BotConfig, BotState, Signal, Position, TradeResult, Candle } from './types';
import { IndicatorCalculator } from './indicators';
import { TradingStrategy } from './strategies';
import { RiskManager } from './risk';
import { Logger } from './utils/logger';
import { IExchange } from './utils/exchange';

export class PerpBot {
    private config: BotConfig;
    private state: BotState;
    private strategy: TradingStrategy;
    private riskManager: RiskManager;
    private exchange: IExchange;
    private logger: Logger;
    private isRunning: boolean = false;

    constructor(config: BotConfig, exchange: IExchange) {
        this.config = config;
        this.exchange = exchange;
        this.logger = new Logger('PerpBot');
        this.strategy = new TradingStrategy(config);
        this.riskManager = new RiskManager(config.risk, this.logger);

        this.state = {
            position: null,
            dailyPnl: 0,
            dailyTrades: 0,
            lastTradeTime: 0,
            lastLossTime: 0,
            isActive: true,
            equity: 0,
            trades: []
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

            // Check SL/TP
            const sltpCheck = this.riskManager.checkSLTP(this.state.position, currentPrice);
            if (sltpCheck.hit) {
                await this.executeClose(currentPrice, sltpCheck.type!);
                return;
            }
        }

        // 4. Generate signal
        const signal = this.strategy.generateSignal(indicators, this.state.position, currentPrice);

        // 5. Execute signal
        await this.executeSignal(signal, currentPrice, indicators.atr);

        // Debug output (every tick)
        this.logger.debug(this.strategy.getStateDebug(indicators));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTE SIGNAL
    // ─────────────────────────────────────────────────────────────────────────
    private async executeSignal(
        signal: Signal,
        currentPrice: number,
        atr: number
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

            await this.executeOpen(signal, currentPrice, atr);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OPEN POSITION
    // ─────────────────────────────────────────────────────────────────────────
    private async executeOpen(
        side: 'LONG' | 'SHORT',
        currentPrice: number,
        atr: number
    ): Promise<void> {
        // Calculate SL/TP
        const { stopLoss, takeProfit } = this.strategy.calculateSLTP(side, currentPrice, atr);

        // Calculate position size
        const positionSize = this.riskManager.calculatePositionSize(
            this.state.equity,
            currentPrice,
            stopLoss,
            this.config.leverage
        );

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
            unrealizedPnl: 0
        };

        // Set SL/TP orders
        await this.exchange.setStopLoss(this.config.symbol, stopLoss);
        await this.exchange.setTakeProfit(this.config.symbol, takeProfit);

        this.logger.trade(side, result.avgPrice, `SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLOSE POSITION
    // ─────────────────────────────────────────────────────────────────────────
    private async executeClose(
        currentPrice: number,
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

        // Update state
        this.state = this.riskManager.updateStateAfterTrade(this.state, tradeResult);
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
