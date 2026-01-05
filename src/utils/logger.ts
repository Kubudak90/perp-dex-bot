// ═══════════════════════════════════════════════════════════════════════════
// LOGGER UTILITY
// Colored console logging with timestamps
// ═══════════════════════════════════════════════════════════════════════════

export class Logger {
    private context: string;
    private debugMode: boolean;

    constructor(context: string, debugMode: boolean = false) {
        this.context = context;
        this.debugMode = debugMode || process.env.DEBUG === 'true';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FORMATTING HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private getTimestamp(): string {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    private formatMessage(level: string, message: string): string {
        return `[${this.getTimestamp()}] [${level}] [${this.context}] ${message}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LOG LEVELS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Info level - general information
     */
    info(message: string): void {
        console.log(`\x1b[36m${this.formatMessage('INFO', message)}\x1b[0m`);
    }

    /**
     * Warning level - potential issues
     */
    warn(message: string): void {
        console.log(`\x1b[33m${this.formatMessage('WARN', message)}\x1b[0m`);
    }

    /**
     * Error level - errors and exceptions
     */
    error(message: string, error?: Error): void {
        console.log(`\x1b[31m${this.formatMessage('ERROR', message)}\x1b[0m`);
        if (error) {
            console.log(`\x1b[31m  └─ ${error.message}\x1b[0m`);
            if (error.stack && this.debugMode) {
                console.log(`\x1b[31m  └─ Stack: ${error.stack}\x1b[0m`);
            }
        }
    }

    /**
     * Debug level - detailed debug info (only when DEBUG=true)
     */
    debug(message: string): void {
        if (this.debugMode) {
            console.log(`\x1b[90m${this.formatMessage('DEBUG', message)}\x1b[0m`);
        }
    }

    /**
     * Trade level - trade execution logs
     */
    trade(side: 'LONG' | 'SHORT' | 'CLOSE', price: number, details: string): void {
        const emoji = side === 'LONG' ? '🟢' : side === 'SHORT' ? '🔴' : '⚪';
        const color = side === 'LONG' ? '\x1b[32m' : side === 'SHORT' ? '\x1b[31m' : '\x1b[37m';

        console.log(`${color}${this.formatMessage('TRADE', `${emoji} ${side} @ $${price.toFixed(2)} | ${details}`)}\x1b[0m`);
    }

    /**
     * Success level - successful operations
     */
    success(message: string): void {
        console.log(`\x1b[32m${this.formatMessage('SUCCESS', `✅ ${message}`)}\x1b[0m`);
    }

    /**
     * Signal level - trading signal logs
     */
    signal(signal: string, reason: string): void {
        const emoji = signal === 'LONG' ? '📈' : signal === 'SHORT' ? '📉' : signal === 'CLOSE' ? '🔔' : '⏸️';
        console.log(`\x1b[35m${this.formatMessage('SIGNAL', `${emoji} ${signal} - ${reason}`)}\x1b[0m`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPECIAL FORMATTERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Log a separator line
     */
    separator(): void {
        console.log('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m');
    }

    /**
     * Log a box with title
     */
    box(title: string, content: string): void {
        console.log(`\x1b[36m┌─ ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}┐\x1b[0m`);
        content.split('\n').forEach(line => {
            console.log(`\x1b[36m│\x1b[0m ${line}`);
        });
        console.log(`\x1b[36m└${'─'.repeat(54)}┘\x1b[0m`);
    }

    /**
     * Log position info
     */
    position(position: { side: string; entryPrice: number; unrealizedPnl: number; size: number }): void {
        const pnlColor = position.unrealizedPnl >= 0 ? '\x1b[32m' : '\x1b[31m';
        const pnlSign = position.unrealizedPnl >= 0 ? '+' : '';

        console.log(
            `\x1b[35m${this.formatMessage('POSITION',
                `${position.side} | Entry: $${position.entryPrice.toFixed(2)} | ` +
                `Size: ${position.size.toFixed(4)} | ` +
                `PnL: ${pnlColor}${pnlSign}$${position.unrealizedPnl.toFixed(2)}\x1b[35m`
            )}\x1b[0m`
        );
    }
}
