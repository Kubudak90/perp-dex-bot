// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION VALIDATION
// Validates and loads configuration from environment variables
// ═══════════════════════════════════════════════════════════════════════════

import { BotConfig } from '../types';
import { ValidationError, ConfigurationError } from './errors';

// ─────────────────────────────────────────────────────────────────────────
// ENVIRONMENT VARIABLE HELPERS
// ─────────────────────────────────────────────────────────────────────────
function getEnvString(key: string, defaultValue?: string): string {
    const value = process.env[key];
    if (!value) {
        if (defaultValue !== undefined) return defaultValue;
        throw new ConfigurationError(`Missing required environment variable: ${key}`);
    }
    return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
    const value = process.env[key];
    if (!value) {
        if (defaultValue !== undefined) return defaultValue;
        throw new ConfigurationError(`Missing required environment variable: ${key}`);
    }

    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
        throw new ValidationError(`Invalid number for ${key}: ${value}`, key);
    }
    return parsed;
}

function getEnvInt(key: string, defaultValue?: number): number {
    const value = process.env[key];
    if (!value) {
        if (defaultValue !== undefined) return defaultValue;
        throw new ConfigurationError(`Missing required environment variable: ${key}`);
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new ValidationError(`Invalid integer for ${key}: ${value}`, key);
    }
    return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION RULES
// ─────────────────────────────────────────────────────────────────────────
function validateConfig(config: BotConfig): void {
    const errors: string[] = [];

    // Symbol validation
    if (!config.symbol || config.symbol.length === 0) {
        errors.push('Symbol cannot be empty');
    }

    // Timeframe validation
    const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(config.timeframe)) {
        errors.push(`Invalid timeframe: ${config.timeframe}. Must be one of: ${validTimeframes.join(', ')}`);
    }

    // Leverage validation
    if (config.leverage < 1 || config.leverage > 20) {
        errors.push('Leverage must be between 1 and 20');
    }

    // Supertrend validation
    if (config.supertrendPeriod < 1 || config.supertrendPeriod > 100) {
        errors.push('Supertrend period must be between 1 and 100');
    }
    if (config.supertrendMultiplier < 0.5 || config.supertrendMultiplier > 10) {
        errors.push('Supertrend multiplier must be between 0.5 and 10');
    }

    // EMA validation
    if (config.emaFastPeriod < 1 || config.emaFastPeriod > 500) {
        errors.push('EMA fast period must be between 1 and 500');
    }
    if (config.emaSlowPeriod < 1 || config.emaSlowPeriod > 500) {
        errors.push('EMA slow period must be between 1 and 500');
    }
    if (config.emaFastPeriod >= config.emaSlowPeriod) {
        errors.push('EMA fast period must be less than slow period');
    }

    // ADX validation
    if (config.adxPeriod < 1 || config.adxPeriod > 100) {
        errors.push('ADX period must be between 1 and 100');
    }
    if (config.adxThreshold < 0 || config.adxThreshold > 100) {
        errors.push('ADX threshold must be between 0 and 100');
    }

    // Funding validation
    if (config.fundingThreshold < 0 || config.fundingThreshold > 0.01) {
        errors.push('Funding threshold must be between 0 and 0.01 (1%)');
    }

    // ATR validation
    if (config.atrPeriod < 1 || config.atrPeriod > 100) {
        errors.push('ATR period must be between 1 and 100');
    }
    if (config.atrLookback < 10 || config.atrLookback > 500) {
        errors.push('ATR lookback must be between 10 and 500');
    }
    if (config.minAtrPercentile < 0 || config.minAtrPercentile > 100) {
        errors.push('Min ATR percentile must be between 0 and 100');
    }
    if (config.maxAtrPercentile < 0 || config.maxAtrPercentile > 100) {
        errors.push('Max ATR percentile must be between 0 and 100');
    }
    if (config.minAtrPercentile >= config.maxAtrPercentile) {
        errors.push('Min ATR percentile must be less than max percentile');
    }

    // Risk validation
    if (config.risk.maxPositionSize < 1 || config.risk.maxPositionSize > 100) {
        errors.push('Max position size must be between 1 and 100 (%)');
    }
    if (config.risk.maxDailyLoss < 0.1 || config.risk.maxDailyLoss > 50) {
        errors.push('Max daily loss must be between 0.1 and 50 (%)');
    }
    if (config.risk.maxDailyTrades < 1 || config.risk.maxDailyTrades > 100) {
        errors.push('Max daily trades must be between 1 and 100');
    }
    if (config.risk.riskRewardRatio < 0.5 || config.risk.riskRewardRatio > 10) {
        errors.push('Risk/reward ratio must be between 0.5 and 10');
    }
    if (config.risk.stopLossAtrMultiplier < 0.1 || config.risk.stopLossAtrMultiplier > 10) {
        errors.push('Stop loss ATR multiplier must be between 0.1 and 10');
    }
    if (config.risk.cooldownMinutes < 0 || config.risk.cooldownMinutes > 1440) {
        errors.push('Cooldown must be between 0 and 1440 minutes (24h)');
    }

    if (errors.length > 0) {
        throw new ValidationError(
            `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────
// LOAD CONFIGURATION FROM ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────
export function loadConfigFromEnv(defaults?: Partial<BotConfig>): BotConfig {
    const config: BotConfig = {
        // Trading pair
        symbol: getEnvString('SYMBOL', defaults?.symbol || 'BTC'),
        timeframe: getEnvString('TIMEFRAME', defaults?.timeframe || '15m'),
        leverage: getEnvInt('LEVERAGE', defaults?.leverage || 3),

        // Supertrend
        supertrendPeriod: getEnvInt('SUPERTREND_PERIOD', defaults?.supertrendPeriod || 10),
        supertrendMultiplier: getEnvNumber('SUPERTREND_MULTIPLIER', defaults?.supertrendMultiplier || 3),

        // EMA
        emaFastPeriod: getEnvInt('EMA_FAST_PERIOD', defaults?.emaFastPeriod || 50),
        emaSlowPeriod: getEnvInt('EMA_SLOW_PERIOD', defaults?.emaSlowPeriod || 200),

        // ADX
        adxPeriod: getEnvInt('ADX_PERIOD', defaults?.adxPeriod || 14),
        adxThreshold: getEnvNumber('ADX_THRESHOLD', defaults?.adxThreshold || 20),

        // Funding
        fundingThreshold: getEnvNumber('FUNDING_THRESHOLD', defaults?.fundingThreshold || 0.0005),
        useFundingFilter: getEnvBoolean('USE_FUNDING_FILTER', defaults?.useFundingFilter ?? true),

        // Volatility regime
        atrPeriod: getEnvInt('ATR_PERIOD', defaults?.atrPeriod || 14),
        atrLookback: getEnvInt('ATR_LOOKBACK', defaults?.atrLookback || 100),
        minAtrPercentile: getEnvNumber('MIN_ATR_PERCENTILE', defaults?.minAtrPercentile || 20),
        maxAtrPercentile: getEnvNumber('MAX_ATR_PERCENTILE', defaults?.maxAtrPercentile || 90),

        // Risk management
        risk: {
            maxPositionSize: getEnvNumber('MAX_POSITION_SIZE', defaults?.risk?.maxPositionSize || 20),
            maxDailyLoss: getEnvNumber('MAX_DAILY_LOSS', defaults?.risk?.maxDailyLoss || 3),
            maxDailyTrades: getEnvInt('MAX_DAILY_TRADES', defaults?.risk?.maxDailyTrades || 3),
            riskRewardRatio: getEnvNumber('RISK_REWARD_RATIO', defaults?.risk?.riskRewardRatio || 1.5),
            stopLossAtrMultiplier: getEnvNumber('STOP_LOSS_ATR_MULTIPLIER', defaults?.risk?.stopLossAtrMultiplier || 1.5),
            cooldownMinutes: getEnvInt('COOLDOWN_MINUTES', defaults?.risk?.cooldownMinutes || 30),
            // Phase 2 Advanced Risk (optional)
            useTrailingStop: getEnvBoolean('USE_TRAILING_STOP', defaults?.risk?.useTrailingStop ?? false),
            trailingStopDistance: getEnvNumber('TRAILING_STOP_DISTANCE', defaults?.risk?.trailingStopDistance),
            maxConsecutiveLosses: getEnvInt('MAX_CONSECUTIVE_LOSSES', defaults?.risk?.maxConsecutiveLosses),
            maxPortfolioHeat: getEnvNumber('MAX_PORTFOLIO_HEAT', defaults?.risk?.maxPortfolioHeat),
            maxHoldTimeHours: getEnvNumber('MAX_HOLD_TIME_HOURS', defaults?.risk?.maxHoldTimeHours)
        },

        // Phase 6A: Multi-Timeframe Confirmation
        useMultiTimeframe: getEnvBoolean('USE_MULTI_TIMEFRAME', defaults?.useMultiTimeframe ?? false),
        mtfRequire1hTrend: getEnvBoolean('MTF_REQUIRE_1H_TREND', defaults?.mtfRequire1hTrend ?? false),
        mtfRequire4hTrend: getEnvBoolean('MTF_REQUIRE_4H_TREND', defaults?.mtfRequire4hTrend ?? false),

        // Phase 6A: Volume Filters
        useVolumeFilter: getEnvBoolean('USE_VOLUME_FILTER', defaults?.useVolumeFilter ?? false),
        volumeMinRatio: getEnvNumber('VOLUME_MIN_RATIO', defaults?.volumeMinRatio),
        volumeRejectSurge: getEnvBoolean('VOLUME_REJECT_SURGE', defaults?.volumeRejectSurge ?? true),

        // Phase 6A: Trading Hours
        useTradingHours: getEnvBoolean('USE_TRADING_HOURS', defaults?.useTradingHours ?? false),
        allowedSessions: process.env.ALLOWED_SESSIONS
            ? process.env.ALLOWED_SESSIONS.split(',').map(s => s.trim() as 'NY' | 'LONDON' | 'ASIA')
            : defaults?.allowedSessions,
        avoidWeekends: getEnvBoolean('AVOID_WEEKENDS', defaults?.avoidWeekends ?? true),

        // Phase 6B: Partial Profit Taking
        usePartialTp: getEnvBoolean('USE_PARTIAL_TP', defaults?.usePartialTp ?? false),
        partialTpLevels: {
            level1: {
                rrRatio: getEnvNumber('PARTIAL_TP_LEVEL1_RR', defaults?.partialTpLevels?.level1?.rrRatio ?? 1.0),
                closePercent: getEnvNumber('PARTIAL_TP_LEVEL1_PERCENT', defaults?.partialTpLevels?.level1?.closePercent ?? 50)
            },
            level2: {
                rrRatio: getEnvNumber('PARTIAL_TP_LEVEL2_RR', defaults?.partialTpLevels?.level2?.rrRatio ?? 1.5),
                closePercent: getEnvNumber('PARTIAL_TP_LEVEL2_PERCENT', defaults?.partialTpLevels?.level2?.closePercent ?? 30)
            },
            level3: {
                rrRatio: getEnvNumber('PARTIAL_TP_LEVEL3_RR', defaults?.partialTpLevels?.level3?.rrRatio ?? 2.0),
                closePercent: getEnvNumber('PARTIAL_TP_LEVEL3_PERCENT', defaults?.partialTpLevels?.level3?.closePercent ?? 20)
            }
        },

        // Phase 6B: Dynamic Stop Loss
        useDynamicSl: getEnvBoolean('USE_DYNAMIC_SL', defaults?.useDynamicSl ?? false),
        slMultiplierLow: getEnvNumber('SL_MULTIPLIER_LOW', defaults?.slMultiplierLow ?? 1.0),
        slMultiplierHigh: getEnvNumber('SL_MULTIPLIER_HIGH', defaults?.slMultiplierHigh ?? 2.0),

        // Phase 6B: Market Regime
        useMarketRegime: getEnvBoolean('USE_MARKET_REGIME', defaults?.useMarketRegime ?? false),
        skipRangingMarkets: getEnvBoolean('SKIP_RANGING_MARKETS', defaults?.skipRangingMarkets ?? true),
        reduceInVolatile: getEnvBoolean('REDUCE_IN_VOLATILE', defaults?.reduceInVolatile ?? true),
        volatileReduction: getEnvNumber('VOLATILE_REDUCTION', defaults?.volatileReduction ?? 0.5)
    };

    // Validate configuration
    validateConfig(config);

    return config;
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATE MODE AND CREDENTIALS
// ─────────────────────────────────────────────────────────────────────────
export function validateMode(): { mode: 'paper' | 'live'; config: any } {
    const mode = process.env.MODE || 'paper';

    if (mode !== 'paper' && mode !== 'live') {
        throw new ValidationError(`Invalid MODE: ${mode}. Must be 'paper' or 'live'`, 'MODE');
    }

    if (mode === 'live') {
        const privateKey = process.env.PRIVATE_KEY;
        const walletAddress = process.env.WALLET_ADDRESS;

        if (!privateKey || !walletAddress) {
            throw new ConfigurationError(
                'PRIVATE_KEY and WALLET_ADDRESS are required for live mode'
            );
        }

        if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
            throw new ValidationError(
                'WALLET_ADDRESS must be a valid Ethereum address (0x...)',
                'WALLET_ADDRESS'
            );
        }

        return {
            mode: 'live',
            config: {
                privateKey,
                walletAddress,
                testnet: getEnvBoolean('TESTNET', false)
            }
        };
    }

    // Paper mode
    const paperBalance = getEnvNumber('PAPER_BALANCE', 10000);

    if (paperBalance < 100 || paperBalance > 10000000) {
        throw new ValidationError(
            'PAPER_BALANCE must be between 100 and 10,000,000',
            'PAPER_BALANCE'
        );
    }

    return {
        mode: 'paper',
        config: { initialBalance: paperBalance }
    };
}

// ─────────────────────────────────────────────────────────────────────────
// PRINT CONFIGURATION SUMMARY
// ─────────────────────────────────────────────────────────────────────────
export function printConfigSummary(config: BotConfig): void {
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│                   CONFIGURATION SUMMARY                      │
├─────────────────────────────────────────────────────────────┤
│ Trading Pair:    ${config.symbol.padEnd(40)} │
│ Timeframe:       ${config.timeframe.padEnd(40)} │
│ Leverage:        ${String(config.leverage).padEnd(40)}x│
├─────────────────────────────────────────────────────────────┤
│ Supertrend:      Period ${config.supertrendPeriod}, Multiplier ${config.supertrendMultiplier}${' '.repeat(16)}│
│ EMA:             ${config.emaFastPeriod}/${config.emaSlowPeriod}${' '.repeat(37)}│
│ ADX:             Period ${config.adxPeriod}, Threshold ${config.adxThreshold}${' '.repeat(19)}│
├─────────────────────────────────────────────────────────────┤
│ Risk/Reward:     1:${config.risk.riskRewardRatio}${' '.repeat(37)}│
│ Max Position:    ${config.risk.maxPositionSize}%${' '.repeat(37)}│
│ Max Daily Loss:  ${config.risk.maxDailyLoss}%${' '.repeat(37)}│
│ Max Daily Trades: ${config.risk.maxDailyTrades}${' '.repeat(38)}│
└─────────────────────────────────────────────────────────────┘
    `);
}
