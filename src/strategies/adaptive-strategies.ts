// ═══════════════════════════════════════════════════════════════════════════
// ADAPTIVE STRATEGIES
// Different strategies optimized for different market conditions
// ═══════════════════════════════════════════════════════════════════════════

import {
    Signal,
    Indicators,
    Position,
    BotConfig,
    StrategyType,
    StrategySelection,
    MarketRegime
} from '../types';

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY SELECTOR
// Automatically selects the best strategy based on market conditions
// ─────────────────────────────────────────────────────────────────────────
export class StrategySelector {
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    /**
     * Select the optimal strategy based on current market conditions
     */
    selectStrategy(indicators: Indicators): StrategySelection {
        const regime = indicators.marketRegime?.regime || 'TRENDING';
        const adx = indicators.adx;
        const atrPercentile = indicators.atrPercentile;
        const volumeRatio = indicators.volume?.ratio || 1;

        // Default selection
        let selection: StrategySelection = {
            strategy: 'SUPERTREND',
            reason: 'Default trend-following strategy',
            confidence: 0.5,
            suggestedLeverage: this.config.leverage,
            suggestedSizeMultiplier: 1.0
        };

        // TRENDING MARKET: Strong trends (ADX > 25)
        if (regime === 'TRENDING' && adx > 25) {
            // If breakout conditions exist (high volume, strong momentum)
            if (volumeRatio > 1.5 && atrPercentile > 50) {
                selection = {
                    strategy: 'BREAKOUT',
                    reason: `Strong trend + high volume (${volumeRatio.toFixed(1)}x) = Breakout`,
                    confidence: Math.min(0.9, adx / 40),
                    suggestedLeverage: this.config.leverage,
                    suggestedSizeMultiplier: 1.2 // Larger size in strong trends
                };
            } else {
                selection = {
                    strategy: 'SUPERTREND',
                    reason: `ADX ${adx.toFixed(1)} indicates trending market`,
                    confidence: Math.min(0.85, adx / 35),
                    suggestedLeverage: this.config.leverage,
                    suggestedSizeMultiplier: 1.0
                };
            }
        }

        // RANGING MARKET: Low ADX, price bouncing
        if (regime === 'RANGING' && adx < 20) {
            selection = {
                strategy: 'MEAN_REVERSION',
                reason: `ADX ${adx.toFixed(1)} < 20 indicates ranging market`,
                confidence: Math.min(0.75, (25 - adx) / 20),
                suggestedLeverage: Math.max(1, this.config.leverage - 1), // Lower leverage in ranges
                suggestedSizeMultiplier: 0.7 // Smaller size, more frequent trades
            };
        }

        // VOLATILE MARKET: High ATR, rapid moves
        if (regime === 'VOLATILE' && atrPercentile > 70) {
            selection = {
                strategy: 'MOMENTUM',
                reason: `High volatility (${atrPercentile.toFixed(0)}th percentile) = Momentum plays`,
                confidence: Math.min(0.7, atrPercentile / 100),
                suggestedLeverage: Math.max(1, this.config.leverage - 2), // Much lower leverage
                suggestedSizeMultiplier: 0.5 // Half size in volatile markets
            };
        }

        // QUIET MARKET: Very low volatility
        if (regime === 'QUIET' && atrPercentile < 20) {
            selection = {
                strategy: 'SCALP',
                reason: `Low volatility (${atrPercentile.toFixed(0)}th percentile) = Scalping`,
                confidence: 0.5, // Lower confidence in quiet markets
                suggestedLeverage: this.config.leverage, // Normal leverage, tight stops
                suggestedSizeMultiplier: 0.6 // Smaller size
            };
        }

        return selection;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// BREAKOUT STRATEGY
// For trending markets with high volume
// ─────────────────────────────────────────────────────────────────────────
export class BreakoutStrategy {
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    /**
     * Generate signal based on breakout conditions
     * - Price breaks above/below recent highs/lows
     * - Volume confirms the breakout
     * - ADX shows strengthening trend
     */
    generateSignal(
        indicators: Indicators,
        currentPosition: Position | null,
        currentPrice: number,
        recentHighs: number[], // Array of recent swing highs
        recentLows: number[]  // Array of recent swing lows
    ): Signal {
        // Exit logic for existing position
        if (currentPosition) {
            return this.checkExitConditions(indicators, currentPosition, currentPrice);
        }

        // Entry filters
        if (!this.passesEntryFilters(indicators)) {
            return 'NONE';
        }

        // Get recent price levels (last 20 candles for swing points)
        const recentHigh = recentHighs.length > 0 ? Math.max(...recentHighs) : currentPrice * 1.02;
        const recentLow = recentLows.length > 0 ? Math.min(...recentLows) : currentPrice * 0.98;

        // Volume confirmation
        const volumeConfirmed = indicators.volume
            ? indicators.volume.isSurge || indicators.volume.ratio > 1.3
            : true;

        // LONG: Price breaks above recent high with volume
        if (
            currentPrice > recentHigh &&
            indicators.supertrend.trend === 'LONG' &&
            indicators.ema50 > indicators.ema200 &&
            volumeConfirmed
        ) {
            return 'LONG';
        }

        // SHORT: Price breaks below recent low with volume
        if (
            currentPrice < recentLow &&
            indicators.supertrend.trend === 'SHORT' &&
            indicators.ema50 < indicators.ema200 &&
            volumeConfirmed
        ) {
            return 'SHORT';
        }

        return 'NONE';
    }

    private passesEntryFilters(indicators: Indicators): boolean {
        // Need strong trend for breakout
        if (indicators.adx < 20) return false;

        // Avoid extreme volatility
        if (indicators.atrPercentile > 90) return false;

        // Avoid abnormal volume spikes
        if (indicators.volume?.isAbnormal) return false;

        return true;
    }

    private checkExitConditions(
        indicators: Indicators,
        position: Position,
        currentPrice: number
    ): Signal {
        // Trend reversal - Supertrend flip
        if (position.side === 'LONG' && indicators.supertrend.trend === 'SHORT') {
            return 'CLOSE';
        }
        if (position.side === 'SHORT' && indicators.supertrend.trend === 'LONG') {
            return 'CLOSE';
        }

        // Trend weakening - ADX falling below threshold
        if (indicators.adx < 18) {
            return 'CLOSE';
        }

        return 'NONE';
    }

    /**
     * Calculate wider SL/TP for breakout trades
     */
    calculateSLTP(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        atr: number
    ): { stopLoss: number; takeProfit: number } {
        // Wider stops for breakout trades (2x ATR)
        const slMultiplier = 2.0;
        const rrRatio = 2.0; // Higher R:R for breakouts

        const slDistance = atr * slMultiplier;
        const tpDistance = slDistance * rrRatio;

        if (side === 'LONG') {
            return {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };
        } else {
            return {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// MEAN REVERSION STRATEGY
// For ranging markets
// ─────────────────────────────────────────────────────────────────────────
export class MeanReversionStrategy {
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    /**
     * Generate signal based on mean reversion conditions
     * - Price deviates from moving average
     * - RSI/Stochastic at extremes
     * - Low ADX (no trend)
     */
    generateSignal(
        indicators: Indicators,
        currentPosition: Position | null,
        currentPrice: number
    ): Signal {
        // Exit logic for existing position
        if (currentPosition) {
            return this.checkExitConditions(indicators, currentPosition, currentPrice);
        }

        // Entry filters - only trade in ranging markets
        if (!this.passesEntryFilters(indicators)) {
            return 'NONE';
        }

        // Calculate deviation from EMA
        const ema50 = indicators.ema50;
        const deviationPercent = ((currentPrice - ema50) / ema50) * 100;

        // Define reversion bands (dynamic based on ATR)
        const atrPercent = (indicators.atr / currentPrice) * 100;
        const lowerBand = -atrPercent * 1.5; // ~1.5 ATR below EMA
        const upperBand = atrPercent * 1.5;  // ~1.5 ATR above EMA

        // LONG: Price significantly below mean (oversold)
        if (
            deviationPercent < lowerBand &&
            currentPrice < indicators.supertrend.lowerBand &&
            indicators.supertrend.trend === 'SHORT' // Counter-trend entry
        ) {
            return 'LONG';
        }

        // SHORT: Price significantly above mean (overbought)
        if (
            deviationPercent > upperBand &&
            currentPrice > indicators.supertrend.upperBand &&
            indicators.supertrend.trend === 'LONG' // Counter-trend entry
        ) {
            return 'SHORT';
        }

        return 'NONE';
    }

    private passesEntryFilters(indicators: Indicators): boolean {
        // Require low ADX (ranging market)
        if (indicators.adx > 25) return false;

        // Avoid very quiet markets
        if (indicators.atrPercentile < 15) return false;

        // Avoid high volatility
        if (indicators.atrPercentile > 75) return false;

        return true;
    }

    private checkExitConditions(
        indicators: Indicators,
        position: Position,
        currentPrice: number
    ): Signal {
        const ema50 = indicators.ema50;
        const deviationPercent = ((currentPrice - ema50) / ema50) * 100;

        // Exit when price returns to mean (EMA50)
        if (position.side === 'LONG' && deviationPercent >= 0) {
            return 'CLOSE';
        }
        if (position.side === 'SHORT' && deviationPercent <= 0) {
            return 'CLOSE';
        }

        // Exit if market becomes trending
        if (indicators.adx > 30) {
            return 'CLOSE';
        }

        return 'NONE';
    }

    /**
     * Calculate tighter SL/TP for mean reversion trades
     */
    calculateSLTP(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        atr: number
    ): { stopLoss: number; takeProfit: number } {
        // Tighter stops for mean reversion (1x ATR)
        const slMultiplier = 1.0;
        const rrRatio = 1.0; // 1:1 R:R, rely on high win rate

        const slDistance = atr * slMultiplier;
        const tpDistance = slDistance * rrRatio;

        if (side === 'LONG') {
            return {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };
        } else {
            return {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// MOMENTUM STRATEGY
// For volatile markets
// ─────────────────────────────────────────────────────────────────────────
export class MomentumStrategy {
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    /**
     * Generate signal based on momentum conditions
     * - Strong price movement in one direction
     * - High volume confirming the move
     * - Quick entry and exit
     */
    generateSignal(
        indicators: Indicators,
        currentPosition: Position | null,
        currentPrice: number,
        previousCandles: { open: number; close: number; high: number; low: number }[]
    ): Signal {
        // Exit logic for existing position (quicker exits in volatile markets)
        if (currentPosition) {
            return this.checkExitConditions(indicators, currentPosition, currentPrice, previousCandles);
        }

        // Entry filters
        if (!this.passesEntryFilters(indicators)) {
            return 'NONE';
        }

        // Calculate recent momentum (last 3 candles)
        if (previousCandles.length < 3) return 'NONE';

        const momentum = this.calculateMomentum(previousCandles);
        const volumeConfirmed = indicators.volume?.ratio
            ? indicators.volume.ratio > 1.5
            : true;

        // LONG: Strong bullish momentum
        if (
            momentum > 0.5 && // Strong upward momentum
            indicators.supertrend.trend === 'LONG' &&
            currentPrice > indicators.ema50 &&
            volumeConfirmed
        ) {
            return 'LONG';
        }

        // SHORT: Strong bearish momentum
        if (
            momentum < -0.5 && // Strong downward momentum
            indicators.supertrend.trend === 'SHORT' &&
            currentPrice < indicators.ema50 &&
            volumeConfirmed
        ) {
            return 'SHORT';
        }

        return 'NONE';
    }

    private calculateMomentum(candles: { open: number; close: number }[]): number {
        // Calculate normalized momentum (-1 to +1)
        const recentCandles = candles.slice(-3);
        let bullishCount = 0;
        let totalMove = 0;

        for (const candle of recentCandles) {
            const move = (candle.close - candle.open) / candle.open;
            totalMove += move;
            if (candle.close > candle.open) bullishCount++;
        }

        // Combine direction consistency and magnitude
        const directionScore = (bullishCount / 3) * 2 - 1; // -1 to +1
        const magnitudeScore = Math.max(-1, Math.min(1, totalMove * 50)); // Normalize magnitude

        return (directionScore + magnitudeScore) / 2;
    }

    private passesEntryFilters(indicators: Indicators): boolean {
        // Need some trend strength
        if (indicators.adx < 15) return false;

        // Require elevated volatility
        if (indicators.atrPercentile < 40) return false;

        // Avoid extreme volatility spikes
        if (indicators.atrPercentile > 95) return false;

        return true;
    }

    private checkExitConditions(
        indicators: Indicators,
        position: Position,
        currentPrice: number,
        previousCandles: { open: number; close: number }[]
    ): Signal {
        // Quick exit on momentum reversal
        const momentum = this.calculateMomentum(previousCandles);

        if (position.side === 'LONG' && momentum < -0.3) {
            return 'CLOSE';
        }
        if (position.side === 'SHORT' && momentum > 0.3) {
            return 'CLOSE';
        }

        // Exit on Supertrend flip
        if (position.side === 'LONG' && indicators.supertrend.trend === 'SHORT') {
            return 'CLOSE';
        }
        if (position.side === 'SHORT' && indicators.supertrend.trend === 'LONG') {
            return 'CLOSE';
        }

        return 'NONE';
    }

    /**
     * Calculate SL/TP for momentum trades (wider SL, quick TP)
     */
    calculateSLTP(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        atr: number
    ): { stopLoss: number; takeProfit: number } {
        // Wider stops to handle volatility
        const slMultiplier = 2.5;
        const rrRatio = 1.0; // 1:1 R:R, quick profits

        const slDistance = atr * slMultiplier;
        const tpDistance = slDistance * rrRatio;

        if (side === 'LONG') {
            return {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };
        } else {
            return {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// SCALP STRATEGY
// For quiet markets with small moves
// ─────────────────────────────────────────────────────────────────────────
export class ScalpStrategy {
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    /**
     * Generate signal based on scalping conditions
     * - Small price oscillations around mean
     * - Tight stops, small targets
     * - High frequency, low risk per trade
     */
    generateSignal(
        indicators: Indicators,
        currentPosition: Position | null,
        currentPrice: number
    ): Signal {
        // Exit logic
        if (currentPosition) {
            return this.checkExitConditions(indicators, currentPosition, currentPrice);
        }

        // Entry filters - only trade in quiet markets
        if (!this.passesEntryFilters(indicators)) {
            return 'NONE';
        }

        // Use Supertrend bands for scalp entries
        const { upperBand, lowerBand } = indicators.supertrend;
        const bandWidth = (upperBand - lowerBand) / currentPrice;

        // Only scalp in narrow ranges
        if (bandWidth > 0.02) return 'NONE'; // >2% band width = skip

        // LONG: Price near lower band
        if (
            currentPrice < lowerBand * 1.005 && // Within 0.5% of lower band
            indicators.ema50 < indicators.ema200 * 1.01 // EMAs close together
        ) {
            return 'LONG';
        }

        // SHORT: Price near upper band
        if (
            currentPrice > upperBand * 0.995 && // Within 0.5% of upper band
            indicators.ema50 > indicators.ema200 * 0.99 // EMAs close together
        ) {
            return 'SHORT';
        }

        return 'NONE';
    }

    private passesEntryFilters(indicators: Indicators): boolean {
        // Require low ADX (no trend)
        if (indicators.adx > 20) return false;

        // Require low volatility
        if (indicators.atrPercentile > 30) return false;

        // Skip if volume too low (no liquidity)
        if (indicators.volume && indicators.volume.ratio < 0.5) return false;

        return true;
    }

    private checkExitConditions(
        indicators: Indicators,
        position: Position,
        currentPrice: number
    ): Signal {
        // Quick exit - return to mid-range
        const midPrice = (indicators.supertrend.upperBand + indicators.supertrend.lowerBand) / 2;

        if (position.side === 'LONG' && currentPrice >= midPrice) {
            return 'CLOSE';
        }
        if (position.side === 'SHORT' && currentPrice <= midPrice) {
            return 'CLOSE';
        }

        // Exit if volatility increases
        if (indicators.atrPercentile > 40) {
            return 'CLOSE';
        }

        return 'NONE';
    }

    /**
     * Calculate tight SL/TP for scalp trades
     */
    calculateSLTP(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        atr: number
    ): { stopLoss: number; takeProfit: number } {
        // Very tight stops for scalping
        const slMultiplier = 0.75;
        const rrRatio = 0.75; // Smaller R:R but high win rate

        const slDistance = atr * slMultiplier;
        const tpDistance = slDistance * rrRatio;

        if (side === 'LONG') {
            return {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };
        } else {
            return {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY FACTORY
// Creates the appropriate strategy based on selection
// ─────────────────────────────────────────────────────────────────────────
export class StrategyFactory {
    static create(strategyType: StrategyType, config: BotConfig): any {
        switch (strategyType) {
            case 'BREAKOUT':
                return new BreakoutStrategy(config);
            case 'MEAN_REVERSION':
                return new MeanReversionStrategy(config);
            case 'MOMENTUM':
                return new MomentumStrategy(config);
            case 'SCALP':
                return new ScalpStrategy(config);
            case 'SUPERTREND':
            default:
                return null; // Use default TradingStrategy
        }
    }
}
