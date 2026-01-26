// ═══════════════════════════════════════════════════════════════════════════
// RISK MANAGEMENT
// Position sizing, daily limits, cooldown, drawdown control
// ═══════════════════════════════════════════════════════════════════════════

import { RiskConfig, BotState, Position, TradeResult } from '../types';
import { Logger } from '../utils/logger';

export class RiskManager {
    private config: RiskConfig;
    private logger: Logger;

    constructor(config: RiskConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK IF NEW TRADE IS ALLOWED
    // ─────────────────────────────────────────────────────────────────────────
    canOpenPosition(state: BotState): { allowed: boolean; reason: string } {

        // Already has position
        if (state.position !== null) {
            return { allowed: false, reason: 'Position already open' };
        }

        // Daily loss limit hit
        const dailyLossPercent = (state.dailyPnl / state.equity) * 100;
        if (dailyLossPercent <= -this.config.maxDailyLoss) {
            return {
                allowed: false,
                reason: `Daily loss limit hit: ${dailyLossPercent.toFixed(2)}% (max: -${this.config.maxDailyLoss}%)`
            };
        }

        // Daily trade limit hit
        if (state.dailyTrades >= this.config.maxDailyTrades) {
            return {
                allowed: false,
                reason: `Daily trade limit hit: ${state.dailyTrades}/${this.config.maxDailyTrades}`
            };
        }

        // Cooldown after loss
        if (state.lastLossTime > 0) {
            const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
            const timeSinceLoss = Date.now() - state.lastLossTime;

            if (timeSinceLoss < cooldownMs) {
                const remainingMin = Math.ceil((cooldownMs - timeSinceLoss) / 60000);
                return {
                    allowed: false,
                    reason: `Cooldown active: ${remainingMin} minutes remaining`
                };
            }
        }

        return { allowed: true, reason: 'Trade allowed' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE POSITION SIZE
    // Based on equity and risk per trade
    // ─────────────────────────────────────────────────────────────────────────
    calculatePositionSize(
        equity: number,
        entryPrice: number,
        stopLossPrice: number,
        leverage: number
    ): number {
        // Risk-based position sizing
        // Position size = (Equity * Risk%) / (Entry - SL distance)

        const maxPositionValue = equity * (this.config.maxPositionSize / 100) * leverage;
        const stopDistance = Math.abs(entryPrice - stopLossPrice);

        // Risk % per trade from config (default 1%)
        const riskPercent = this.config.riskPerTrade ?? 1;
        const riskAmount = equity * (riskPercent / 100);
        const riskBasedSize = (riskAmount / stopDistance) * entryPrice;

        // Take the smaller of max position and risk-based size
        const positionValue = Math.min(maxPositionValue, riskBasedSize);
        const positionSize = positionValue / entryPrice;

        this.logger.info(`Position sizing: Equity=${equity}, MaxPos=${maxPositionValue.toFixed(2)}, RiskBased=${riskBasedSize.toFixed(2)}, Final=${positionValue.toFixed(2)}`);

        return positionSize;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK STOP LOSS / TAKE PROFIT
    // ─────────────────────────────────────────────────────────────────────────
    checkSLTP(
        position: Position,
        currentPrice: number
    ): { hit: boolean; type: 'SL' | 'TP' | null } {

        if (position.side === 'LONG') {
            if (currentPrice <= position.stopLoss) {
                return { hit: true, type: 'SL' };
            }
            if (currentPrice >= position.takeProfit) {
                return { hit: true, type: 'TP' };
            }
        } else {
            if (currentPrice >= position.stopLoss) {
                return { hit: true, type: 'SL' };
            }
            if (currentPrice <= position.takeProfit) {
                return { hit: true, type: 'TP' };
            }
        }

        return { hit: false, type: null };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE PNL
    // ─────────────────────────────────────────────────────────────────────────
    calculatePnl(
        position: Position,
        exitPrice: number,
        leverage: number
    ): { pnl: number; pnlPercent: number } {
        let pnlPercent: number;

        if (position.side === 'LONG') {
            pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100 * leverage;
        } else {
            pnlPercent = ((position.entryPrice - exitPrice) / position.entryPrice) * 100 * leverage;
        }

        const pnl = position.size * position.entryPrice * (pnlPercent / 100);

        return { pnl, pnlPercent };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE STATE AFTER TRADE
    // ─────────────────────────────────────────────────────────────────────────
    updateStateAfterTrade(
        state: BotState,
        result: TradeResult
    ): BotState {
        const newState = { ...state };

        newState.dailyPnl += result.pnl;
        newState.dailyTrades += 1;
        newState.equity += result.pnl;
        newState.trades.push(result);
        newState.position = null;
        newState.lastTradeTime = Date.now();

        if (result.pnl < 0) {
            newState.lastLossTime = Date.now();
        }

        // Log trade result
        const emoji = result.pnl >= 0 ? '✅' : '❌';
        this.logger.info(`${emoji} Trade closed: ${result.side} | PnL: ${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(2)}%) | Reason: ${result.exitReason}`);

        return newState;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESET DAILY STATS (call at 00:00 UTC)
    // ─────────────────────────────────────────────────────────────────────────
    resetDailyStats(state: BotState): BotState {
        this.logger.info('📊 Daily stats reset');
        return {
            ...state,
            dailyPnl: 0,
            dailyTrades: 0,
            lastLossTime: 0
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE TRAILING STOP
    // ─────────────────────────────────────────────────────────────────────────
    updateTrailingStop(
        position: Position,
        currentPrice: number,
        peakPrice: number
    ): { newStopLoss: number; newPeakPrice: number } {
        if (!this.config.useTrailingStop || !this.config.trailingStopDistance) {
            return { newStopLoss: position.stopLoss, newPeakPrice: peakPrice };
        }

        let newPeakPrice = peakPrice;
        let newStopLoss = position.stopLoss;

        if (position.side === 'LONG') {
            // Update peak if price is higher
            if (currentPrice > newPeakPrice) {
                newPeakPrice = currentPrice;

                // Calculate new stop loss
                const trailingStopPrice =
                    newPeakPrice * (1 - this.config.trailingStopDistance / 100);

                // Only move stop loss up, never down
                if (trailingStopPrice > position.stopLoss) {
                    newStopLoss = trailingStopPrice;
                    this.logger.info(
                        `Trailing stop updated: ${position.stopLoss.toFixed(2)} → ${newStopLoss.toFixed(2)}`
                    );
                }
            }
        } else {
            // SHORT position
            if (currentPrice < newPeakPrice || newPeakPrice === 0) {
                newPeakPrice = currentPrice;

                const trailingStopPrice =
                    newPeakPrice * (1 + this.config.trailingStopDistance / 100);

                // Only move stop loss down, never up
                if (trailingStopPrice < position.stopLoss || position.stopLoss === 0) {
                    newStopLoss = trailingStopPrice;
                    this.logger.info(
                        `Trailing stop updated: ${position.stopLoss.toFixed(2)} → ${newStopLoss.toFixed(2)}`
                    );
                }
            }
        }

        return { newStopLoss, newPeakPrice };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK CONSECUTIVE LOSSES
    // ─────────────────────────────────────────────────────────────────────────
    checkConsecutiveLosses(state: BotState): { shouldPause: boolean; consecutiveLosses: number } {
        const maxConsecutive = this.config.maxConsecutiveLosses || 999;
        const consecutiveLosses = state.consecutiveLosses || 0;

        if (consecutiveLosses >= maxConsecutive) {
            this.logger.warn(
                `Consecutive loss limit hit: ${consecutiveLosses}/${maxConsecutive}. Pausing trading.`
            );
            return { shouldPause: true, consecutiveLosses };
        }

        return { shouldPause: false, consecutiveLosses };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK MAX HOLD TIME
    // ─────────────────────────────────────────────────────────────────────────
    shouldForceClose(position: Position): boolean {
        const maxHoldHours = this.config.maxHoldTimeHours;
        if (!maxHoldHours) return false;

        const holdTimeMs = Date.now() - position.entryTime;
        const holdTimeHours = holdTimeMs / (1000 * 60 * 60);

        if (holdTimeHours >= maxHoldHours) {
            this.logger.warn(
                `Max hold time exceeded: ${holdTimeHours.toFixed(1)}h >= ${maxHoldHours}h. Forcing close.`
            );
            return true;
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE PORTFOLIO HEAT
    // ─────────────────────────────────────────────────────────────────────────
    calculatePortfolioHeat(position: Position, equity: number): number {
        const positionValue = position.size * position.entryPrice;
        const riskAmount = Math.abs(position.entryPrice - position.stopLoss) * position.size;
        const heatPercent = (riskAmount / equity) * 100;

        return heatPercent;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE STATE AFTER TRADE (Enhanced)
    // ─────────────────────────────────────────────────────────────────────────
    updateStateAfterTradeEnhanced(state: BotState, result: TradeResult): BotState {
        const newState = { ...state };

        newState.dailyPnl += result.pnl;
        newState.dailyTrades += 1;
        newState.equity += result.pnl;
        newState.trades.push(result);
        newState.position = null;
        newState.lastTradeTime = Date.now();
        newState.peakPrice = undefined;
        newState.portfolioHeat = 0;

        // Track consecutive losses
        if (result.pnl < 0) {
            newState.lastLossTime = Date.now();
            newState.consecutiveLosses = (newState.consecutiveLosses || 0) + 1;
        } else {
            newState.consecutiveLosses = 0; // Reset on win
        }

        // Log trade result
        const emoji = result.pnl >= 0 ? '✅' : '❌';
        this.logger.info(
            `${emoji} Trade closed: ${result.side} | PnL: ${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(2)}%) | ` +
                `Reason: ${result.exitReason} | Consecutive Losses: ${newState.consecutiveLosses}`
        );

        return newState;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET RISK STATS
    // ─────────────────────────────────────────────────────────────────────────
    getRiskStats(state: BotState): string {
        const dailyLossPercent = (state.dailyPnl / state.equity) * 100;
        const totalTrades = state.trades.length;
        const winningTrades = state.trades.filter(t => t.pnl > 0).length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const consecutiveLosses = state.consecutiveLosses || 0;

        return `
    ┌─────────────────────────────────────────┐
    │ RISK STATS                              │
    ├─────────────────────────────────────────┤
    │ Equity:        $${state.equity.toFixed(2)}
    │ Daily PnL:     $${state.dailyPnl.toFixed(2)} (${dailyLossPercent.toFixed(2)}%)
    │ Daily Trades:  ${state.dailyTrades}/${this.config.maxDailyTrades}
    │ Total Trades:  ${totalTrades}
    │ Win Rate:      ${winRate.toFixed(1)}%
    │ Consecutive L: ${consecutiveLosses}
    │ Position:      ${state.position ? state.position.side : 'NONE'}
    │ Portfolio Heat: ${(state.portfolioHeat || 0).toFixed(2)}%
    └─────────────────────────────────────────┘`;
    }
}
