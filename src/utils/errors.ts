// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM ERROR TYPES
// Structured error handling for different failure scenarios
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// BASE ERROR
// ─────────────────────────────────────────────────────────────────────────
export class BotError extends Error {
    public readonly timestamp: number;
    public readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.timestamp = Date.now();
        Error.captureStackTrace(this, this.constructor);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// NETWORK ERRORS
// ─────────────────────────────────────────────────────────────────────────
export class NetworkError extends BotError {
    constructor(message: string, public readonly statusCode?: number) {
        super(message, 'NETWORK_ERROR');
    }
}

export class TimeoutError extends BotError {
    constructor(message: string = 'Request timed out') {
        super(message, 'TIMEOUT_ERROR');
    }
}

export class RateLimitError extends BotError {
    constructor(message: string = 'Rate limit exceeded', public readonly retryAfter?: number) {
        super(message, 'RATE_LIMIT_ERROR');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// EXCHANGE ERRORS
// ─────────────────────────────────────────────────────────────────────────
export class ExchangeError extends BotError {
    constructor(message: string, public readonly exchangeCode?: string) {
        super(message, 'EXCHANGE_ERROR');
    }
}

export class InsufficientBalanceError extends ExchangeError {
    constructor(message: string = 'Insufficient balance') {
        super(message, 'INSUFFICIENT_BALANCE');
    }
}

export class OrderRejectedError extends ExchangeError {
    constructor(message: string, exchangeCode?: string) {
        super(message, exchangeCode || 'ORDER_REJECTED');
    }
}

export class PositionNotFoundError extends ExchangeError {
    constructor(message: string = 'Position not found') {
        super(message, 'POSITION_NOT_FOUND');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// TRADING ERRORS
// ─────────────────────────────────────────────────────────────────────────
export class TradingError extends BotError {
    constructor(message: string, code: string = 'TRADING_ERROR') {
        super(message, code);
    }
}

export class RiskLimitError extends TradingError {
    constructor(message: string) {
        super(message, 'RISK_LIMIT_ERROR');
    }
}

export class InvalidSignalError extends TradingError {
    constructor(message: string) {
        super(message, 'INVALID_SIGNAL_ERROR');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIGURATION ERRORS
// ─────────────────────────────────────────────────────────────────────────
export class ConfigurationError extends BotError {
    constructor(message: string) {
        super(message, 'CONFIGURATION_ERROR');
    }
}

export class ValidationError extends BotError {
    constructor(message: string, public readonly field?: string) {
        super(message, 'VALIDATION_ERROR');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// DATA ERRORS
// ─────────────────────────────────────────────────────────────────────────
export class DataError extends BotError {
    constructor(message: string, code: string = 'DATA_ERROR') {
        super(message, code);
    }
}

export class InsufficientDataError extends DataError {
    constructor(message: string = 'Insufficient data for calculation') {
        super(message, 'INSUFFICIENT_DATA');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// ERROR HANDLER UTILITY
// ─────────────────────────────────────────────────────────────────────────
export function isRetryableError(error: Error): boolean {
    return (
        error instanceof NetworkError ||
        error instanceof TimeoutError ||
        error instanceof RateLimitError ||
        (error instanceof ExchangeError && error.exchangeCode === '503')
    );
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export function logError(error: unknown): void {
    if (error instanceof BotError) {
        console.error(`[${error.code}] ${error.message}`, {
            timestamp: error.timestamp,
            stack: error.stack
        });
    } else if (error instanceof Error) {
        console.error(error.message, { stack: error.stack });
    } else {
        console.error('Unknown error:', error);
    }
}
