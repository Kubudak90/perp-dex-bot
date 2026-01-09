// ═══════════════════════════════════════════════════════════════════════════
// RETRY UTILITY TESTS
// Unit tests for retry logic, circuit breaker, and rate limiter
// ═══════════════════════════════════════════════════════════════════════════

import { retryWithBackoff, CircuitBreaker, RateLimiter, withTimeout } from '../src/utils/retry';

describe('retryWithBackoff', () => {
    it('should succeed on first try', async () => {
        const mockFn = jest.fn().mockResolvedValue('success');

        const result = await retryWithBackoff(mockFn, { maxRetries: 3 });

        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
        const mockFn = jest.fn()
            .mockRejectedValueOnce(new Error('ETIMEDOUT'))
            .mockRejectedValueOnce(new Error('ETIMEDOUT'))
            .mockResolvedValue('success');

        const result = await retryWithBackoff(mockFn, { maxRetries: 3, baseDelayMs: 10 });

        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
        const mockFn = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

        await expect(
            retryWithBackoff(mockFn, { maxRetries: 2, baseDelayMs: 10 })
        ).rejects.toThrow('ETIMEDOUT');

        expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
        const mockFn = jest.fn().mockRejectedValue(new Error('Invalid input'));

        await expect(
            retryWithBackoff(mockFn, {
                maxRetries: 3,
                baseDelayMs: 10,
                shouldRetry: () => false
            })
        ).rejects.toThrow('Invalid input');

        expect(mockFn).toHaveBeenCalledTimes(1);
    });
});

describe('CircuitBreaker', () => {
    it('should allow requests when circuit is closed', async () => {
        const breaker = new CircuitBreaker(3, 1000);
        const mockFn = jest.fn().mockResolvedValue('success');

        const result = await breaker.execute(mockFn);

        expect(result).toBe('success');
        expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open circuit after threshold failures', async () => {
        const breaker = new CircuitBreaker(3, 1000);
        const mockFn = jest.fn().mockRejectedValue(new Error('failure'));

        // Trigger failures
        for (let i = 0; i < 3; i++) {
            await expect(breaker.execute(mockFn)).rejects.toThrow('failure');
        }

        expect(breaker.getState()).toBe('OPEN');

        // Next request should be rejected immediately
        await expect(breaker.execute(mockFn)).rejects.toThrow('Circuit breaker OPEN');
    });

    it('should transition to half-open after timeout', async () => {
        const breaker = new CircuitBreaker(2, 100); // 100ms timeout
        const mockFn = jest.fn().mockRejectedValue(new Error('failure'));

        // Open the circuit
        await expect(breaker.execute(mockFn)).rejects.toThrow();
        await expect(breaker.execute(mockFn)).rejects.toThrow();
        expect(breaker.getState()).toBe('OPEN');

        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 150));

        // Circuit should allow one test request
        mockFn.mockResolvedValueOnce('success');
        const result = await breaker.execute(mockFn);

        expect(result).toBe('success');
        expect(breaker.getState()).toBe('CLOSED');
    });

    it('should reset manually', async () => {
        const breaker = new CircuitBreaker(2, 1000);
        const mockFn = jest.fn().mockRejectedValue(new Error('failure'));

        // Open the circuit
        await expect(breaker.execute(mockFn)).rejects.toThrow();
        await expect(breaker.execute(mockFn)).rejects.toThrow();
        expect(breaker.getState()).toBe('OPEN');

        // Manual reset
        breaker.reset();
        expect(breaker.getState()).toBe('CLOSED');

        // Should work now
        mockFn.mockResolvedValueOnce('success');
        const result = await breaker.execute(mockFn);
        expect(result).toBe('success');
    });
});

describe('RateLimiter', () => {
    it('should allow requests under the limit', async () => {
        const limiter = new RateLimiter(10, 10); // 10 tokens, 10 per second

        const start = Date.now();
        await limiter.acquire(5);
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(100); // Should be immediate
        expect(limiter.getAvailableTokens()).toBeCloseTo(5, 0);
    });

    it('should throttle requests over the limit', async () => {
        const limiter = new RateLimiter(5, 10); // 5 tokens, refill at 10/s

        const start = Date.now();
        await limiter.acquire(5); // Use all tokens
        await limiter.acquire(5); // Should wait for refill
        const duration = Date.now() - start;

        expect(duration).toBeGreaterThanOrEqual(400); // Should wait ~500ms
    });

    it('should refill tokens over time', async () => {
        const limiter = new RateLimiter(10, 10);

        await limiter.acquire(10); // Use all tokens
        expect(limiter.getAvailableTokens()).toBeCloseTo(0, 0);

        // Wait for 500ms, should refill ~5 tokens
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(4);
    });
});

describe('withTimeout', () => {
    it('should resolve if promise completes in time', async () => {
        const promise = new Promise(resolve => setTimeout(() => resolve('success'), 10));

        const result = await withTimeout(promise, 100);

        expect(result).toBe('success');
    });

    it('should reject if promise times out', async () => {
        const promise = new Promise(resolve => setTimeout(() => resolve('too slow'), 200));

        await expect(
            withTimeout(promise, 50, 'Timeout!')
        ).rejects.toThrow('Timeout!');
    });

    it('should reject with default message', async () => {
        const promise = new Promise(resolve => setTimeout(() => resolve('too slow'), 200));

        await expect(
            withTimeout(promise, 50)
        ).rejects.toThrow('Operation timed out');
    });
});
