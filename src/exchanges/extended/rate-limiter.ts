// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER
// Prevent exceeding Extended's 1000 req/minute limit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rate Limiter
 * Ensures we don't exceed 1000 requests per minute
 */
export class RateLimiter {
    private requests: number[] = [];
    private limit: number;
    private window: number;

    constructor(limit: number = 1000, windowMs: number = 60000) {
        this.limit = limit; // 1000 requests
        this.window = windowMs; // 60 seconds
    }

    /**
     * Wait if rate limit would be exceeded
     */
    async throttle(): Promise<void> {
        const now = Date.now();

        // Remove requests outside the window
        this.requests = this.requests.filter((t) => now - t < this.window);

        // If at limit, wait until oldest request expires
        if (this.requests.length >= this.limit) {
            const waitTime = this.window - (now - this.requests[0]);
            console.warn(`⚠️  Rate limit reached, waiting ${waitTime}ms...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime + 100));

            // Clean up again after wait
            const newNow = Date.now();
            this.requests = this.requests.filter((t) => newNow - t < this.window);
        }

        // Record this request
        this.requests.push(Date.now());
    }

    /**
     * Get current request count in window
     */
    getCount(): number {
        const now = Date.now();
        this.requests = this.requests.filter((t) => now - t < this.window);
        return this.requests.length;
    }

    /**
     * Get remaining requests in window
     */
    getRemaining(): number {
        return this.limit - this.getCount();
    }

    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.requests = [];
    }
}
