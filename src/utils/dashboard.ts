// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL DASHBOARD
// Real-time terminal-based trading dashboard
// ═══════════════════════════════════════════════════════════════════════════

import { BotState, BotConfig, Indicators, TradeResult } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// ANSI COLOR CODES
// ─────────────────────────────────────────────────────────────────────────
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',

    // Background
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
};

// ─────────────────────────────────────────────────────────────────────────
// DASHBOARD CLASS
// ─────────────────────────────────────────────────────────────────────────
export class Dashboard {
    private config: BotConfig;
    private updateInterval: NodeJS.Timeout | null = null;
    private lastIndicators: Indicators | null = null;
    private lastPrice: number = 0;
    private startTime: number = Date.now();

    constructor(config: BotConfig) {
        this.config = config;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE DATA
    // ─────────────────────────────────────────────────────────────────────────
    updateIndicators(indicators: Indicators, price: number): void {
        this.lastIndicators = indicators;
        this.lastPrice = price;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER DASHBOARD
    // ─────────────────────────────────────────────────────────────────────────
    render(state: BotState): void {
        // Clear screen and move cursor to top
        process.stdout.write('\x1b[2J\x1b[H');

        const lines: string[] = [];

        // Header
        lines.push(this.renderHeader());
        lines.push('');

        // Main sections in a grid
        lines.push(this.renderAccountSection(state));
        lines.push('');
        lines.push(this.renderPositionSection(state));
        lines.push('');
        lines.push(this.renderIndicatorsSection());
        lines.push('');
        lines.push(this.renderDailyStatsSection(state));
        lines.push('');
        lines.push(this.renderRecentTradesSection(state.trades));
        lines.push('');
        lines.push(this.renderFooter());

        console.log(lines.join('\n'));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HEADER
    // ─────────────────────────────────────────────────────────────────────────
    private renderHeader(): string {
        const uptime = this.formatDuration(Date.now() - this.startTime);
        const time = new Date().toLocaleTimeString();

        return `
${COLORS.cyan}╔════════════════════════════════════════════════════════════════════════════════╗
║${COLORS.bright}${COLORS.white}  ██████╗ ███████╗██████╗ ██████╗     ██████╗  ██████╗ ████████╗              ${COLORS.cyan}║
║${COLORS.bright}${COLORS.white}  ██╔══██╗██╔════╝██╔══██╗██╔══██╗    ██╔══██╗██╔═══██╗╚══██╔══╝              ${COLORS.cyan}║
║${COLORS.bright}${COLORS.white}  ██████╔╝█████╗  ██████╔╝██████╔╝    ██████╔╝██║   ██║   ██║                 ${COLORS.cyan}║
║${COLORS.bright}${COLORS.white}  ██╔═══╝ ██╔══╝  ██╔══██╗██╔═══╝     ██╔══██╗██║   ██║   ██║                 ${COLORS.cyan}║
║${COLORS.bright}${COLORS.white}  ██║     ███████╗██║  ██║██║         ██████╔╝╚██████╔╝   ██║                 ${COLORS.cyan}║
║${COLORS.bright}${COLORS.white}  ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝         ╚═════╝  ╚═════╝    ╚═╝                 ${COLORS.cyan}║
╠════════════════════════════════════════════════════════════════════════════════╣
║${COLORS.reset}  ${COLORS.yellow}${this.config.symbol}${COLORS.reset} | ${COLORS.cyan}${this.config.timeframe}${COLORS.reset} | ${COLORS.magenta}${this.config.leverage}x${COLORS.reset}        ${COLORS.dim}Uptime: ${uptime}  |  ${time}${COLORS.reset}          ${COLORS.cyan}║
╚════════════════════════════════════════════════════════════════════════════════╝${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCOUNT SECTION
    // ─────────────────────────────────────────────────────────────────────────
    private renderAccountSection(state: BotState): string {
        const pnlColor = state.dailyPnl >= 0 ? COLORS.green : COLORS.red;
        const pnlSign = state.dailyPnl >= 0 ? '+' : '';
        const pnlPercent = state.equity > 0 ? (state.dailyPnl / state.equity) * 100 : 0;

        return `${COLORS.cyan}┌─ ACCOUNT ──────────────────────────────────────────────────────────────────────┐${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Equity:${COLORS.reset}      $${state.equity.toFixed(2).padStart(12)}     ${COLORS.bright}Daily P&L:${COLORS.reset}  ${pnlColor}${pnlSign}$${state.dailyPnl.toFixed(2).padStart(10)} (${pnlSign}${pnlPercent.toFixed(2)}%)${COLORS.reset}   ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Price:${COLORS.reset}       $${this.lastPrice.toFixed(2).padStart(12)}     ${COLORS.bright}Daily Trades:${COLORS.reset}  ${state.dailyTrades.toString().padStart(5)} / ${this.config.risk.maxDailyTrades}            ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSITION SECTION
    // ─────────────────────────────────────────────────────────────────────────
    private renderPositionSection(state: BotState): string {
        if (!state.position) {
            return `${COLORS.cyan}┌─ POSITION ─────────────────────────────────────────────────────────────────────┐${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.dim}No active position${COLORS.reset}                                                             ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
        }

        const pos = state.position;
        const sideColor = pos.side === 'LONG' ? COLORS.green : COLORS.red;
        const sideEmoji = pos.side === 'LONG' ? '🟢' : '🔴';
        const pnlColor = pos.unrealizedPnl >= 0 ? COLORS.green : COLORS.red;
        const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
        const pnlPercent = pos.entryPrice > 0 ? ((this.lastPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'LONG' ? 1 : -1) : 0;
        const duration = this.formatDuration(Date.now() - pos.entryTime);

        // Calculate distance to SL/TP
        const slDistance = pos.side === 'LONG'
            ? ((pos.stopLoss - this.lastPrice) / this.lastPrice) * 100
            : ((this.lastPrice - pos.stopLoss) / this.lastPrice) * 100;
        const tpDistance = pos.side === 'LONG'
            ? ((pos.takeProfit - this.lastPrice) / this.lastPrice) * 100
            : ((this.lastPrice - pos.takeProfit) / this.lastPrice) * 100;

        return `${COLORS.cyan}┌─ POSITION ─────────────────────────────────────────────────────────────────────┐${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${sideEmoji} ${sideColor}${COLORS.bright}${pos.side.padEnd(5)}${COLORS.reset}  Entry: $${pos.entryPrice.toFixed(2).padStart(10)}   Size: ${pos.size.toFixed(6).padStart(12)}              ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}P&L:${COLORS.reset}    ${pnlColor}${pnlSign}$${pos.unrealizedPnl.toFixed(2).padStart(10)} (${pnlSign}${pnlPercent.toFixed(2)}%)${COLORS.reset}   Duration: ${duration.padStart(12)}         ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.red}SL:${COLORS.reset}     $${pos.stopLoss.toFixed(2).padStart(10)} (${slDistance.toFixed(2)}%)     ${COLORS.green}TP:${COLORS.reset} $${pos.takeProfit.toFixed(2).padStart(10)} (${tpDistance.toFixed(2)}%)      ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INDICATORS SECTION
    // ─────────────────────────────────────────────────────────────────────────
    private renderIndicatorsSection(): string {
        if (!this.lastIndicators) {
            return `${COLORS.cyan}┌─ INDICATORS ───────────────────────────────────────────────────────────────────┐${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.dim}Waiting for data...${COLORS.reset}                                                          ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
        }

        const ind = this.lastIndicators;
        const trendColor = ind.supertrend.trend === 'LONG' ? COLORS.green : COLORS.red;
        const trendEmoji = ind.supertrend.trend === 'LONG' ? '▲' : '▼';
        const emaColor = ind.ema50 > ind.ema200 ? COLORS.green : COLORS.red;
        const adxColor = ind.adx >= this.config.adxThreshold ? COLORS.green : COLORS.yellow;
        const volColor = ind.atrPercentile >= this.config.minAtrPercentile && ind.atrPercentile <= this.config.maxAtrPercentile
            ? COLORS.green : COLORS.yellow;

        // Funding color
        const fundingColor = Math.abs(ind.fundingRate) >= this.config.fundingThreshold ? COLORS.red : COLORS.green;

        // Market regime if available
        const regimeStr = ind.marketRegime
            ? `${ind.marketRegime.regime.padEnd(10)} (${(ind.marketRegime.confidence * 100).toFixed(0)}%)`
            : 'N/A';

        return `${COLORS.cyan}┌─ INDICATORS ───────────────────────────────────────────────────────────────────┐${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Supertrend:${COLORS.reset} ${trendColor}${trendEmoji} ${ind.supertrend.trend.padEnd(5)}${COLORS.reset} @ $${ind.supertrend.value.toFixed(2).padStart(10)}   ${COLORS.bright}ADX:${COLORS.reset} ${adxColor}${ind.adx.toFixed(1).padStart(6)}${COLORS.reset}             ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}EMA 50/200:${COLORS.reset} ${emaColor}$${ind.ema50.toFixed(2)} / $${ind.ema200.toFixed(2)}${COLORS.reset}            ${COLORS.bright}ATR:${COLORS.reset} ${ind.atr.toFixed(2).padStart(8)}           ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Volatility:${COLORS.reset} ${volColor}${ind.atrPercentile.toFixed(1)}th percentile${COLORS.reset}          ${COLORS.bright}Funding:${COLORS.reset} ${fundingColor}${(ind.fundingRate * 100).toFixed(4)}%${COLORS.reset}         ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Regime:${COLORS.reset}     ${regimeStr}                                               ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DAILY STATS SECTION
    // ─────────────────────────────────────────────────────────────────────────
    private renderDailyStatsSection(state: BotState): string {
        const todayTrades = state.trades.slice(-20);
        const winningTrades = todayTrades.filter(t => t.pnl > 0);
        const losingTrades = todayTrades.filter(t => t.pnl <= 0);

        const winRate = todayTrades.length > 0 ? (winningTrades.length / todayTrades.length) * 100 : 0;
        const avgWin = winningTrades.length > 0
            ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
            : 0;
        const avgLoss = losingTrades.length > 0
            ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
            : 0;

        const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
        const pfStr = profitFactor === Infinity ? '∞' : profitFactor.toFixed(2);

        const winRateColor = winRate >= 50 ? COLORS.green : COLORS.red;

        // Progress bar for daily loss limit
        const lossPercent = Math.abs(state.dailyPnl < 0 ? (state.dailyPnl / state.equity) * 100 : 0);
        const lossProgress = Math.min(lossPercent / this.config.risk.maxDailyLoss, 1);
        const progressBar = this.renderProgressBar(lossProgress, 20, COLORS.red);

        return `${COLORS.cyan}┌─ DAILY STATS ──────────────────────────────────────────────────────────────────┐${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Win Rate:${COLORS.reset}    ${winRateColor}${winRate.toFixed(1)}%${COLORS.reset}  (${winningTrades.length}W / ${losingTrades.length}L)       ${COLORS.bright}Profit Factor:${COLORS.reset} ${pfStr.padStart(6)}          ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Avg Win:${COLORS.reset}     ${COLORS.green}+$${avgWin.toFixed(2).padStart(8)}${COLORS.reset}              ${COLORS.bright}Avg Loss:${COLORS.reset}      ${COLORS.red}-$${avgLoss.toFixed(2).padStart(8)}${COLORS.reset}    ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}│${COLORS.reset}  ${COLORS.bright}Loss Limit:${COLORS.reset}  ${progressBar} ${lossPercent.toFixed(1)}% / ${this.config.risk.maxDailyLoss}%                      ${COLORS.cyan}│${COLORS.reset}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECENT TRADES SECTION
    // ─────────────────────────────────────────────────────────────────────────
    private renderRecentTradesSection(trades: TradeResult[]): string {
        const recentTrades = trades.slice(-5).reverse();

        let tradesLines = '';
        if (recentTrades.length === 0) {
            tradesLines = `${COLORS.cyan}│${COLORS.reset}  ${COLORS.dim}No trades yet${COLORS.reset}                                                                 ${COLORS.cyan}│${COLORS.reset}`;
        } else {
            tradesLines = recentTrades.map(trade => {
                const emoji = trade.pnl >= 0 ? '✅' : '❌';
                const pnlColor = trade.pnl >= 0 ? COLORS.green : COLORS.red;
                const pnlSign = trade.pnl >= 0 ? '+' : '';
                const duration = this.formatDuration(trade.duration);

                return `${COLORS.cyan}│${COLORS.reset}  ${emoji} ${trade.side.padEnd(5)} $${trade.entryPrice.toFixed(2)} → $${trade.exitPrice.toFixed(2)}  ${pnlColor}${pnlSign}$${trade.pnl.toFixed(2).padStart(8)}${COLORS.reset}  ${trade.exitReason.padEnd(8)} ${duration.padStart(8)} ${COLORS.cyan}│${COLORS.reset}`;
            }).join('\n');
        }

        return `${COLORS.cyan}┌─ RECENT TRADES ────────────────────────────────────────────────────────────────┐${COLORS.reset}
${tradesLines}
${COLORS.cyan}└────────────────────────────────────────────────────────────────────────────────┘${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FOOTER
    // ─────────────────────────────────────────────────────────────────────────
    private renderFooter(): string {
        return `${COLORS.dim}  Press Ctrl+C to stop  |  Refreshing every tick  |  Supertrend + EMA + ADX Strategy${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    private renderProgressBar(progress: number, width: number, color: string): string {
        const filled = Math.round(progress * width);
        const empty = width - filled;
        return `${color}[${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(empty)}${color}]${COLORS.reset}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATIC: QUICK RENDER (for one-time display)
    // ─────────────────────────────────────────────────────────────────────────
    static renderQuickStats(state: BotState, config: BotConfig): string {
        const dashboard = new Dashboard(config);
        dashboard.lastPrice = state.position?.entryPrice || 0;

        const lines: string[] = [];

        lines.push(`\n${COLORS.cyan}═══════════════════════════════════════════════════════════════${COLORS.reset}`);
        lines.push(`${COLORS.bright}  TRADING BOT STATS${COLORS.reset}`);
        lines.push(`${COLORS.cyan}═══════════════════════════════════════════════════════════════${COLORS.reset}`);
        lines.push(`  Equity:       $${state.equity.toFixed(2)}`);
        lines.push(`  Daily P&L:    ${state.dailyPnl >= 0 ? COLORS.green : COLORS.red}${state.dailyPnl >= 0 ? '+' : ''}$${state.dailyPnl.toFixed(2)}${COLORS.reset}`);
        lines.push(`  Daily Trades: ${state.dailyTrades} / ${config.risk.maxDailyTrades}`);
        lines.push(`  Total Trades: ${state.trades.length}`);

        if (state.position) {
            lines.push(`  Position:     ${state.position.side} @ $${state.position.entryPrice.toFixed(2)}`);
            lines.push(`  Unrealized:   ${state.position.unrealizedPnl >= 0 ? COLORS.green : COLORS.red}${state.position.unrealizedPnl >= 0 ? '+' : ''}$${state.position.unrealizedPnl.toFixed(2)}${COLORS.reset}`);
        } else {
            lines.push(`  Position:     ${COLORS.dim}None${COLORS.reset}`);
        }

        lines.push(`${COLORS.cyan}═══════════════════════════════════════════════════════════════${COLORS.reset}\n`);

        return lines.join('\n');
    }
}
