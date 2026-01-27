// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION LAYER
// Centralized validation with Result pattern for better error handling
// ═══════════════════════════════════════════════════════════════════════════

import { LIMITS, ErrorCode } from './constants';
import { BotConfig, RiskConfig, Candle } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// RESULT TYPE (Either Pattern)
// Use this instead of throwing exceptions for recoverable errors
// ─────────────────────────────────────────────────────────────────────────
export type Result<T, E = ValidationError> =
    | { success: true; value: T }
    | { success: false; error: E };

export function ok<T>(value: T): Result<T, never> {
    return { success: true, value };
}

export function err<E>(error: E): Result<never, E> {
    return { success: false, error };
}

// Helper to unwrap Result or throw
export function unwrap<T>(result: Result<T>): T {
    if (result.success) {
        return result.value;
    }
    throw result.error;
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION ERROR
// ─────────────────────────────────────────────────────────────────────────
export class ValidationError extends Error {
    constructor(
        public readonly code: ErrorCode,
        public readonly field: string,
        public readonly message: string,
        public readonly value?: unknown
    ) {
        super(`${code}: ${message} (field: ${field})`);
        this.name = 'ValidationError';
    }
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATORS
// ─────────────────────────────────────────────────────────────────────────
export class Validators {
    /**
     * Validate a number is within range
     */
    static numberInRange(
        value: number,
        min: number,
        max: number,
        fieldName: string
    ): Result<number> {
        if (typeof value !== 'number' || isNaN(value)) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                fieldName,
                `Expected a number, got ${typeof value}`,
                value
            ));
        }

        if (value < min || value > max) {
            return err(new ValidationError(
                ErrorCode.OUT_OF_RANGE,
                fieldName,
                `Value must be between ${min} and ${max}, got ${value}`,
                value
            ));
        }

        return ok(value);
    }

    /**
     * Validate a positive number
     */
    static positiveNumber(value: number, fieldName: string): Result<number> {
        if (typeof value !== 'number' || isNaN(value)) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                fieldName,
                `Expected a number, got ${typeof value}`,
                value
            ));
        }

        if (value <= 0) {
            return err(new ValidationError(
                ErrorCode.OUT_OF_RANGE,
                fieldName,
                `Value must be positive, got ${value}`,
                value
            ));
        }

        return ok(value);
    }

    /**
     * Validate string is not empty
     */
    static nonEmptyString(value: string, fieldName: string): Result<string> {
        if (typeof value !== 'string') {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                fieldName,
                `Expected a string, got ${typeof value}`,
                value
            ));
        }

        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                fieldName,
                'String cannot be empty',
                value
            ));
        }

        return ok(trimmed);
    }

    /**
     * Validate value is one of allowed values
     */
    static oneOf<T>(value: T, allowed: readonly T[], fieldName: string): Result<T> {
        if (!allowed.includes(value)) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                fieldName,
                `Value must be one of: ${allowed.join(', ')}`,
                value
            ));
        }

        return ok(value);
    }

    /**
     * Validate candle data
     */
    static candle(candle: Candle, index: number): Result<Candle> {
        const errors: string[] = [];

        if (typeof candle.timestamp !== 'number' || candle.timestamp <= 0) {
            errors.push('invalid timestamp');
        }
        if (typeof candle.open !== 'number' || candle.open <= 0) {
            errors.push('invalid open price');
        }
        if (typeof candle.high !== 'number' || candle.high <= 0) {
            errors.push('invalid high price');
        }
        if (typeof candle.low !== 'number' || candle.low <= 0) {
            errors.push('invalid low price');
        }
        if (typeof candle.close !== 'number' || candle.close <= 0) {
            errors.push('invalid close price');
        }
        if (typeof candle.volume !== 'number' || candle.volume < 0) {
            errors.push('invalid volume');
        }

        // OHLC relationship validation
        if (candle.high < candle.low) {
            errors.push('high < low');
        }
        if (candle.high < candle.open || candle.high < candle.close) {
            errors.push('high is not the highest');
        }
        if (candle.low > candle.open || candle.low > candle.close) {
            errors.push('low is not the lowest');
        }

        if (errors.length > 0) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                `candles[${index}]`,
                `Invalid candle data: ${errors.join(', ')}`,
                candle
            ));
        }

        return ok(candle);
    }

    /**
     * Validate array of candles
     */
    static candles(candles: Candle[], minLength: number = 1): Result<Candle[]> {
        if (!Array.isArray(candles)) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                'candles',
                'Expected an array of candles',
                candles
            ));
        }

        if (candles.length < minLength) {
            return err(new ValidationError(
                ErrorCode.INVALID_PARAMETER,
                'candles',
                `Expected at least ${minLength} candles, got ${candles.length}`,
                candles.length
            ));
        }

        // Validate each candle
        for (let i = 0; i < candles.length; i++) {
            const result = this.candle(candles[i], i);
            if (!result.success) {
                return result;
            }
        }

        // Check chronological order
        for (let i = 1; i < candles.length; i++) {
            if (candles[i].timestamp <= candles[i - 1].timestamp) {
                return err(new ValidationError(
                    ErrorCode.INVALID_PARAMETER,
                    `candles[${i}]`,
                    'Candles must be in chronological order',
                    { current: candles[i].timestamp, previous: candles[i - 1].timestamp }
                ));
            }
        }

        return ok(candles);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG VALIDATORS
// ─────────────────────────────────────────────────────────────────────────
export class ConfigValidator {
    /**
     * Validate risk configuration
     */
    static validateRiskConfig(config: RiskConfig): Result<RiskConfig> {
        // Max position size
        const positionSizeResult = Validators.numberInRange(
            config.maxPositionSize,
            LIMITS.MIN_POSITION_SIZE_PERCENT,
            LIMITS.MAX_POSITION_SIZE_PERCENT,
            'risk.maxPositionSize'
        );
        if (!positionSizeResult.success) return positionSizeResult as Result<RiskConfig>;

        // Max daily loss
        const dailyLossResult = Validators.numberInRange(
            config.maxDailyLoss,
            LIMITS.MIN_DAILY_LOSS_PERCENT,
            LIMITS.MAX_DAILY_LOSS_PERCENT,
            'risk.maxDailyLoss'
        );
        if (!dailyLossResult.success) return dailyLossResult as Result<RiskConfig>;

        // Risk reward ratio
        const rrResult = Validators.numberInRange(
            config.riskRewardRatio,
            LIMITS.MIN_RISK_REWARD,
            LIMITS.MAX_RISK_REWARD,
            'risk.riskRewardRatio'
        );
        if (!rrResult.success) return rrResult as Result<RiskConfig>;

        // Risk per trade (if specified)
        if (config.riskPerTrade !== undefined) {
            const rptResult = Validators.numberInRange(
                config.riskPerTrade,
                LIMITS.MIN_RISK_PER_TRADE,
                LIMITS.MAX_RISK_PER_TRADE,
                'risk.riskPerTrade'
            );
            if (!rptResult.success) return rptResult as Result<RiskConfig>;
        }

        // Cooldown minutes
        const cooldownResult = Validators.numberInRange(
            config.cooldownMinutes,
            LIMITS.MIN_COOLDOWN_MINUTES,
            LIMITS.MAX_COOLDOWN_MINUTES,
            'risk.cooldownMinutes'
        );
        if (!cooldownResult.success) return cooldownResult as Result<RiskConfig>;

        return ok(config);
    }

    /**
     * Validate full bot configuration
     */
    static validateBotConfig(config: BotConfig): Result<BotConfig> {
        // Symbol
        const symbolResult = Validators.nonEmptyString(config.symbol, 'symbol');
        if (!symbolResult.success) return symbolResult as Result<BotConfig>;

        // Timeframe
        const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
        const tfResult = Validators.oneOf(config.timeframe, validTimeframes, 'timeframe');
        if (!tfResult.success) return tfResult as Result<BotConfig>;

        // Leverage
        const leverageResult = Validators.numberInRange(
            config.leverage,
            LIMITS.MIN_LEVERAGE,
            LIMITS.MAX_LEVERAGE,
            'leverage'
        );
        if (!leverageResult.success) return leverageResult as Result<BotConfig>;

        // Indicator periods
        const periodFields = [
            { value: config.supertrendPeriod, name: 'supertrendPeriod' },
            { value: config.emaFastPeriod, name: 'emaFastPeriod' },
            { value: config.emaSlowPeriod, name: 'emaSlowPeriod' },
            { value: config.adxPeriod, name: 'adxPeriod' },
            { value: config.atrPeriod, name: 'atrPeriod' }
        ];

        for (const field of periodFields) {
            const result = Validators.numberInRange(
                field.value,
                LIMITS.MIN_PERIOD,
                LIMITS.MAX_PERIOD,
                field.name
            );
            if (!result.success) return result as Result<BotConfig>;
        }

        // EMA fast should be less than slow
        if (config.emaFastPeriod >= config.emaSlowPeriod) {
            return err(new ValidationError(
                ErrorCode.INVALID_CONFIG,
                'emaFastPeriod',
                `EMA fast period (${config.emaFastPeriod}) must be less than slow period (${config.emaSlowPeriod})`,
                { fast: config.emaFastPeriod, slow: config.emaSlowPeriod }
            ));
        }

        // ADX threshold
        const adxResult = Validators.numberInRange(
            config.adxThreshold,
            LIMITS.MIN_ADX_THRESHOLD,
            LIMITS.MAX_ADX_THRESHOLD,
            'adxThreshold'
        );
        if (!adxResult.success) return adxResult as Result<BotConfig>;

        // ATR percentiles
        const minAtrResult = Validators.numberInRange(
            config.minAtrPercentile,
            LIMITS.MIN_ATR_PERCENTILE,
            LIMITS.MAX_ATR_PERCENTILE,
            'minAtrPercentile'
        );
        if (!minAtrResult.success) return minAtrResult as Result<BotConfig>;

        const maxAtrResult = Validators.numberInRange(
            config.maxAtrPercentile,
            LIMITS.MIN_ATR_PERCENTILE,
            LIMITS.MAX_ATR_PERCENTILE,
            'maxAtrPercentile'
        );
        if (!maxAtrResult.success) return maxAtrResult as Result<BotConfig>;

        if (config.minAtrPercentile >= config.maxAtrPercentile) {
            return err(new ValidationError(
                ErrorCode.INVALID_CONFIG,
                'minAtrPercentile',
                `Min ATR percentile (${config.minAtrPercentile}) must be less than max (${config.maxAtrPercentile})`,
                { min: config.minAtrPercentile, max: config.maxAtrPercentile }
            ));
        }

        // Validate risk config
        const riskResult = this.validateRiskConfig(config.risk);
        if (!riskResult.success) return riskResult as Result<BotConfig>;

        return ok(config);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// TRADING VALIDATORS
// ─────────────────────────────────────────────────────────────────────────
export class TradingValidator {
    /**
     * Validate trade entry conditions
     */
    static canEnterTrade(
        equity: number,
        dailyPnl: number,
        dailyTrades: number,
        maxDailyLoss: number,
        maxDailyTrades: number,
        lastLossTime: number,
        cooldownMinutes: number,
        hasOpenPosition: boolean
    ): Result<true> {
        // Already has position
        if (hasOpenPosition) {
            return err(new ValidationError(
                ErrorCode.POSITION_ALREADY_OPEN,
                'position',
                'Cannot open new position while one is already open'
            ));
        }

        // Daily loss limit
        const dailyLossPercent = Math.abs(dailyPnl / equity) * 100;
        if (dailyPnl < 0 && dailyLossPercent >= maxDailyLoss) {
            return err(new ValidationError(
                ErrorCode.DAILY_LIMIT_REACHED,
                'dailyPnl',
                `Daily loss limit reached: ${dailyLossPercent.toFixed(2)}% >= ${maxDailyLoss}%`,
                { current: dailyLossPercent, limit: maxDailyLoss }
            ));
        }

        // Daily trade limit
        if (dailyTrades >= maxDailyTrades) {
            return err(new ValidationError(
                ErrorCode.DAILY_LIMIT_REACHED,
                'dailyTrades',
                `Daily trade limit reached: ${dailyTrades} >= ${maxDailyTrades}`,
                { current: dailyTrades, limit: maxDailyTrades }
            ));
        }

        // Cooldown after loss
        if (lastLossTime > 0 && cooldownMinutes > 0) {
            const cooldownMs = cooldownMinutes * 60 * 1000;
            const timeSinceLoss = Date.now() - lastLossTime;

            if (timeSinceLoss < cooldownMs) {
                const remainingMinutes = Math.ceil((cooldownMs - timeSinceLoss) / 60000);
                return err(new ValidationError(
                    ErrorCode.COOLDOWN_ACTIVE,
                    'cooldown',
                    `Cooldown active: ${remainingMinutes} minutes remaining`,
                    { remaining: remainingMinutes }
                ));
            }
        }

        return ok(true);
    }

    /**
     * Validate position size
     */
    static validatePositionSize(
        size: number,
        equity: number,
        maxPositionSizePercent: number,
        leverage: number
    ): Result<number> {
        const sizeResult = Validators.positiveNumber(size, 'positionSize');
        if (!sizeResult.success) return sizeResult;

        const maxValue = equity * (maxPositionSizePercent / 100) * leverage;

        if (size > maxValue) {
            return err(new ValidationError(
                ErrorCode.OUT_OF_RANGE,
                'positionSize',
                `Position size ($${size.toFixed(2)}) exceeds maximum ($${maxValue.toFixed(2)})`,
                { requested: size, maximum: maxValue }
            ));
        }

        return ok(size);
    }
}
