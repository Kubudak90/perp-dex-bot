// ═══════════════════════════════════════════════════════════════════════════
// RETRY UTILITY
// Exponential backoff retry logic for network requests
// ═══════════════════════════════════════════════════════════════════════════

import { Logger } from './logger';

export interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    exponentialBase: number;
    shouldRetry?: (error: Error) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 4,
    baseDelayMs: 2000,
    maxDelayMs: 16000,
    exponentialBase: 2,
    shouldRetry: (error: Error) => {
        // Retry on network errors, rate limits, timeouts
        const retryableErrors = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'ECONNRESET',
            'EPIPE',
            'rate limit',
            '429',
            '502',
            '503',
            '504'
        ];

        const errorStr = error.message.toLowerCase();
        return retryableErrors.some(err => errorStr.includes(err.toLowerCase()));
    }
};

// ─────────────────────────────────────────────────────────────────────────
// RETRY WITH EXPONENTIAL BACKOFF
// ─────────────────────────────────────────────────────────────────────────
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    logger?: Logger,
    operationName: string = 'operation'
): Promise<T> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: Error;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            // Check if we should retry
            if (attempt === opts.maxRetries || !opts.shouldRetry!(lastError)) {
                throw lastError;
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(
                opts.baseDelayMs * Math.pow(opts.exponentialBase, attempt),
                opts.maxDelayMs
            );

            if (logger) {
                logger.warn(
                    `${operationName} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}): ${lastError.message}. ` +
                    `Retrying in ${delay}ms...`
                );
            }

            await sleep(delay);
        }
    }

    throw lastError!;
}

// ─────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER
// Prevents cascading failures by stopping requests after threshold
// ─────────────────────────────────────────────────────────────────────────
export class CircuitBreaker {
    private failureCount: number = 0;
    private lastFailureTime: number = 0;
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private logger: Logger;

    constructor(
        private failureThreshold: number = 5,
        private resetTimeoutMs: number = 60000,
        loggerContext: string = 'CircuitBreaker'
    ) {
        this.logger = new Logger(loggerContext);
    }

    async execute<T>(fn: () => Promise<T>, operationName: string = 'operation'): Promise<T> {
        // Check if circuit is open
        if (this.state === 'OPEN') {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;

            if (timeSinceLastFailure < this.resetTimeoutMs) {
                throw new Error(`Circuit breaker OPEN for ${operationName}. Retry after ${Math.ceil((this.resetTimeoutMs - timeSinceLastFailure) / 1000)}s`);
            } else {
                this.logger.info(`Circuit breaker entering HALF_OPEN state for ${operationName}`);
                this.state = 'HALF_OPEN';
            }
        }

        try {
            const result = await fn();

            // Success - reset circuit
            if (this.state === 'HALF_OPEN') {
                this.logger.success(`Circuit breaker CLOSED for ${operationName}`);
            }
            this.failureCount = 0;
            this.state = 'CLOSED';

            return result;
        } catch (error) {
            this.failureCount++;
            this.lastFailureTime = Date.now();

            if (this.failureCount >= this.failureThreshold) {
                this.state = 'OPEN';
                this.logger.error(`Circuit breaker OPEN for ${operationName} after ${this.failureCount} failures`);
            }

            throw error;
        }
    }

    getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
        return this.state;
    }

    reset(): void {
        this.failureCount = 0;
        this.state = 'CLOSED';
        this.logger.info('Circuit breaker manually reset');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// Token bucket algorithm for rate limiting
// ─────────────────────────────────────────────────────────────────────────
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private logger: Logger;

    constructor(
        private maxTokens: number,
        private refillRate: number, // tokens per second
        loggerContext: string = 'RateLimiter'
    ) {
        this.tokens = maxTokens;
        this.lastRefill = Date.now();
        this.logger = new Logger(loggerContext);
    }

    async acquire(cost: number = 1): Promise<void> {
        while (true) {
            this.refillTokens();

            if (this.tokens >= cost) {
                this.tokens -= cost;
                return;
            }

            // Calculate wait time
            const tokensNeeded = cost - this.tokens;
            const waitMs = (tokensNeeded / this.refillRate) * 1000;

            this.logger.debug(`Rate limit: waiting ${waitMs.toFixed(0)}ms for ${cost} tokens`);
            await sleep(Math.min(waitMs, 1000)); // Max wait 1s per iteration
        }
    }

    private refillTokens(): void {
        const now = Date.now();
        const timePassed = (now - this.lastRefill) / 1000; // seconds
        const tokensToAdd = timePassed * this.refillRate;

        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }

    getAvailableTokens(): number {
        this.refillTokens();
        return this.tokens;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// TIMEOUT WRAPPER
// Wraps promise with timeout
// ─────────────────────────────────────────────────────────────────────────
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string = 'Operation timed out'
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]);
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
