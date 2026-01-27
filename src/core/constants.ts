// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & ENUMS
// Centralized constants to eliminate magic numbers and improve readability
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// POSITION STATES (State Machine)
// ─────────────────────────────────────────────────────────────────────────
export enum PositionState {
    IDLE = 'IDLE',                    // No position
    PENDING_ENTRY = 'PENDING_ENTRY',  // Order submitted, waiting fill
    OPEN = 'OPEN',                    // Position active
    PARTIAL_CLOSED = 'PARTIAL_CLOSED', // Some TP levels hit
    PENDING_EXIT = 'PENDING_EXIT',    // Exit order submitted
    CLOSED = 'CLOSED'                 // Position closed
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL TYPES
// ─────────────────────────────────────────────────────────────────────────
export enum SignalType {
    LONG = 'LONG',
    SHORT = 'SHORT',
    CLOSE = 'CLOSE',
    NONE = 'NONE'
}

// ─────────────────────────────────────────────────────────────────────────
// MARKET REGIME
// ─────────────────────────────────────────────────────────────────────────
export enum MarketRegime {
    TRENDING = 'TRENDING',
    RANGING = 'RANGING',
    VOLATILE = 'VOLATILE',
    QUIET = 'QUIET'
}

// ─────────────────────────────────────────────────────────────────────────
// TREND DIRECTION
// ─────────────────────────────────────────────────────────────────────────
export enum TrendDirection {
    BULLISH = 'BULLISH',
    BEARISH = 'BEARISH',
    NEUTRAL = 'NEUTRAL'
}

// ─────────────────────────────────────────────────────────────────────────
// EXIT REASONS
// ─────────────────────────────────────────────────────────────────────────
export enum ExitReason {
    STOP_LOSS = 'SL',
    TAKE_PROFIT = 'TP',
    SIGNAL = 'SIGNAL',
    PARTIAL_TP = 'PARTIAL_TP',
    TRAILING_STOP = 'TRAILING_STOP',
    MAX_HOLD_TIME = 'MAX_HOLD_TIME',
    MANUAL = 'MANUAL',
    LIQUIDATION = 'LIQUIDATION'
}

// ─────────────────────────────────────────────────────────────────────────
// RISK LEVELS
// ─────────────────────────────────────────────────────────────────────────
export enum RiskLevel {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

// ─────────────────────────────────────────────────────────────────────────
// TRADING SESSIONS
// ─────────────────────────────────────────────────────────────────────────
export enum TradingSession {
    ASIA = 'ASIA',
    LONDON = 'LONDON',
    NY = 'NY',
    OVERLAP = 'OVERLAP'
}

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT VALUES
// ─────────────────────────────────────────────────────────────────────────
export const DEFAULTS = {
    // Position sizing
    MAX_POSITION_SIZE_PERCENT: 20,
    RISK_PER_TRADE_PERCENT: 1,

    // Risk management
    MAX_DAILY_LOSS_PERCENT: 3,
    MAX_DAILY_TRADES: 3,
    COOLDOWN_MINUTES: 30,
    RISK_REWARD_RATIO: 1.5,
    STOP_LOSS_ATR_MULTIPLIER: 1.5,

    // Indicators
    SUPERTREND_PERIOD: 10,
    SUPERTREND_MULTIPLIER: 3,
    EMA_FAST_PERIOD: 50,
    EMA_SLOW_PERIOD: 200,
    ADX_PERIOD: 14,
    ADX_THRESHOLD: 20,
    ATR_PERIOD: 14,
    ATR_LOOKBACK: 100,

    // Volatility
    MIN_ATR_PERCENTILE: 20,
    MAX_ATR_PERCENTILE: 90,

    // Funding
    FUNDING_THRESHOLD: 0.0005,

    // Paper trading
    INITIAL_BALANCE: 10000,

    // Timeframes (in milliseconds)
    TIMEFRAME_MS: {
        '1m': 60_000,
        '5m': 300_000,
        '15m': 900_000,
        '30m': 1_800_000,
        '1h': 3_600_000,
        '4h': 14_400_000,
        '1d': 86_400_000
    } as const
} as const;

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION LIMITS
// ─────────────────────────────────────────────────────────────────────────
export const LIMITS = {
    // Balance
    MIN_PAPER_BALANCE: 100,
    MAX_PAPER_BALANCE: 10_000_000,

    // Leverage
    MIN_LEVERAGE: 1,
    MAX_LEVERAGE: 100,

    // Position size
    MIN_POSITION_SIZE_PERCENT: 1,
    MAX_POSITION_SIZE_PERCENT: 100,

    // Risk per trade
    MIN_RISK_PER_TRADE: 0.1,
    MAX_RISK_PER_TRADE: 10,

    // Daily loss
    MIN_DAILY_LOSS_PERCENT: 0.5,
    MAX_DAILY_LOSS_PERCENT: 20,

    // Risk/Reward
    MIN_RISK_REWARD: 0.5,
    MAX_RISK_REWARD: 10,

    // Indicator periods
    MIN_PERIOD: 1,
    MAX_PERIOD: 500,

    // ADX threshold
    MIN_ADX_THRESHOLD: 10,
    MAX_ADX_THRESHOLD: 50,

    // ATR percentile
    MIN_ATR_PERCENTILE: 0,
    MAX_ATR_PERCENTILE: 100,

    // Cooldown
    MIN_COOLDOWN_MINUTES: 0,
    MAX_COOLDOWN_MINUTES: 1440, // 24 hours

    // Max consecutive losses
    MIN_CONSECUTIVE_LOSSES: 1,
    MAX_CONSECUTIVE_LOSSES: 20
} as const;

// ─────────────────────────────────────────────────────────────────────────
// ERROR CODES
// ─────────────────────────────────────────────────────────────────────────
export enum ErrorCode {
    // Validation errors
    INVALID_CONFIG = 'INVALID_CONFIG',
    INVALID_PARAMETER = 'INVALID_PARAMETER',
    OUT_OF_RANGE = 'OUT_OF_RANGE',

    // Trading errors
    INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
    POSITION_ALREADY_OPEN = 'POSITION_ALREADY_OPEN',
    NO_POSITION_TO_CLOSE = 'NO_POSITION_TO_CLOSE',
    DAILY_LIMIT_REACHED = 'DAILY_LIMIT_REACHED',
    COOLDOWN_ACTIVE = 'COOLDOWN_ACTIVE',

    // Exchange errors
    CONNECTION_FAILED = 'CONNECTION_FAILED',
    ORDER_FAILED = 'ORDER_FAILED',
    RATE_LIMITED = 'RATE_LIMITED',

    // System errors
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    TIMEOUT = 'TIMEOUT'
}
