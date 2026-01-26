// ═══════════════════════════════════════════════════════════════════════════
// WEB DASHBOARD WITH FULL BOT CONTROL
// Exchange selection, credentials input, real-time monitoring
// ═══════════════════════════════════════════════════════════════════════════

import http from 'http';
import { BotState, TradeResult, ExchangeType, ExchangeConfig } from '../types';
import { Logger } from '../utils/logger';

export interface DashboardConfig {
    port: number;
    enabled: boolean;
    password?: string;
}

export interface RuntimeCredentials {
    exchange: ExchangeType;
    testnet: boolean;
    // Common
    privateKey?: string;
    walletAddress?: string;
    // Exchange specific
    apiKey?: string;
    apiSecret?: string;
    subAccountId?: string;
    // Trading config
    symbol: string;
    timeframe: string;
    leverage: number;
    paperBalance: number;
    mode: 'paper' | 'live';
}

export class Dashboard {
    private server: http.Server | null = null;
    private config: DashboardConfig;
    private logger: Logger;
    private getState: () => BotState;
    private getConfig: () => any;
    private onStartBot: (credentials: RuntimeCredentials) => Promise<void>;
    private onStopBot: () => Promise<void>;
    private isRunning: () => boolean;
    private priceHistory: { time: number; price: number }[] = [];
    private currentCredentials: RuntimeCredentials | null = null;

    constructor(
        config: DashboardConfig,
        callbacks: {
            getState: () => BotState;
            getConfig: () => any;
            onStartBot: (credentials: RuntimeCredentials) => Promise<void>;
            onStopBot: () => Promise<void>;
            isRunning: () => boolean;
        }
    ) {
        this.config = config;
        this.logger = new Logger('Dashboard');
        this.getState = callbacks.getState;
        this.getConfig = callbacks.getConfig;
        this.onStartBot = callbacks.onStartBot;
        this.onStopBot = callbacks.onStopBot;
        this.isRunning = callbacks.isRunning;
    }

    updatePrice(price: number): void {
        this.priceHistory.push({ time: Date.now(), price });
        if (this.priceHistory.length > 500) {
            this.priceHistory = this.priceHistory.slice(-500);
        }
    }

    start(): void {
        if (!this.config.enabled) return;

        this.server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            const url = req.url || '/';

            try {
                if (url === '/api/status') {
                    this.handleApiStatus(res);
                } else if (url === '/api/trades') {
                    this.handleApiTrades(res);
                } else if (url === '/api/prices') {
                    this.handleApiPrices(res);
                } else if (url === '/api/start' && req.method === 'POST') {
                    await this.handleBotStart(req, res);
                } else if (url === '/api/stop' && req.method === 'POST') {
                    await this.handleBotStop(res);
                } else if (url === '/api/exchanges') {
                    this.handleExchangesList(res);
                } else if (url === '/health') {
                    res.writeHead(200);
                    res.end('OK');
                } else {
                    this.handleDashboard(res);
                }
            } catch (error) {
                this.logger.error('Dashboard error', error as Error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        });

        this.server.listen(this.config.port, '0.0.0.0', () => {
            this.logger.info(`Dashboard running at http://0.0.0.0:${this.config.port}`);
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.logger.info('Dashboard stopped');
        }
    }

    private handleExchangesList(res: http.ServerResponse): void {
        const exchanges = [
            {
                id: 'NADO',
                name: 'Nado',
                description: 'Kraken-backed CLOB DEX on Ink L2',
                maxLeverage: 20,
                chains: ['Ink L2'],
                requiresApiKey: false,
                requiresPrivateKey: true,
                docsUrl: 'https://docs.nado.xyz'
            },
            {
                id: 'GRVT',
                name: 'GRVT',
                description: 'Hybrid DEX on zkSync with CLOB',
                maxLeverage: 50,
                chains: ['zkSync'],
                requiresApiKey: true,
                requiresPrivateKey: false,
                docsUrl: 'https://api-docs.grvt.io'
            },
            {
                id: 'PACIFICA',
                name: 'Pacifica',
                description: 'High-performance Solana perp DEX',
                maxLeverage: 50,
                chains: ['Solana'],
                requiresApiKey: true,
                requiresPrivateKey: false,
                docsUrl: 'https://docs.pacifica.fi'
            },
            {
                id: 'STANDX',
                name: 'StandX',
                description: 'Solana/BNB DEX with DUSD yield',
                maxLeverage: 20,
                chains: ['Solana', 'BNB'],
                requiresApiKey: false,
                requiresPrivateKey: true,
                docsUrl: 'https://standx.io'
            }
        ];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(exchanges));
    }

    private async handleBotStart(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            if (this.isRunning()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Bot is already running' }));
                return;
            }

            // Parse request body
            const body = await this.parseBody(req);
            const credentials = body as RuntimeCredentials;

            // Validate required fields
            if (!credentials.exchange) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Exchange is required' }));
                return;
            }

            if (!credentials.symbol || !credentials.timeframe) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Symbol and timeframe are required' }));
                return;
            }

            // Store credentials
            this.currentCredentials = credentials;

            // Start bot with credentials
            await this.onStartBot(credentials);

            this.logger.info(`Bot started on ${credentials.exchange} (${credentials.mode} mode)`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: `Bot started on ${credentials.exchange}`,
                exchange: credentials.exchange,
                mode: credentials.mode
            }));
        } catch (error) {
            this.logger.error('Failed to start bot', error as Error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private async handleBotStop(res: http.ServerResponse): Promise<void> {
        try {
            if (!this.isRunning()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Bot is not running' }));
                return;
            }
            await this.onStopBot();
            this.currentCredentials = null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Bot stopped' }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private parseBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body || '{}'));
                } catch {
                    resolve({});
                }
            });
            req.on('error', reject);
        });
    }

    private handleApiStatus(res: http.ServerResponse): void {
        const state = this.getState();
        const config = this.getConfig();
        const currentPrice = this.priceHistory.length > 0
            ? this.priceHistory[this.priceHistory.length - 1].price
            : 0;

        const status = {
            timestamp: Date.now(),
            botRunning: this.isRunning(),
            configured: this.currentCredentials !== null,
            exchange: this.currentCredentials?.exchange || null,
            symbol: this.currentCredentials?.symbol || config.symbol,
            timeframe: this.currentCredentials?.timeframe || config.timeframe,
            leverage: this.currentCredentials?.leverage || config.leverage,
            mode: this.currentCredentials?.mode || 'paper',
            testnet: this.currentCredentials?.testnet ?? true,
            currentPrice,
            equity: state.equity,
            initialEquity: this.currentCredentials?.paperBalance || config.paperBalance || 10000,
            dailyPnl: state.dailyPnl,
            dailyPnlPercent: state.equity > 0 ? (state.dailyPnl / state.equity) * 100 : 0,
            totalPnl: state.equity - (this.currentCredentials?.paperBalance || config.paperBalance || 10000),
            totalPnlPercent: ((state.equity - (this.currentCredentials?.paperBalance || 10000)) / (this.currentCredentials?.paperBalance || 10000)) * 100,
            dailyTrades: state.dailyTrades,
            maxDailyTrades: config.risk?.maxDailyTrades || 3,
            totalTrades: state.trades.length,
            position: state.position ? {
                side: state.position.side,
                entryPrice: state.position.entryPrice,
                size: state.position.size,
                stopLoss: state.position.stopLoss,
                takeProfit: state.position.takeProfit,
                unrealizedPnl: state.position.unrealizedPnl,
                unrealizedPnlPercent: state.position.entryPrice > 0
                    ? ((currentPrice - state.position.entryPrice) / state.position.entryPrice) * 100 * (state.position.side === 'LONG' ? 1 : -1) * (this.currentCredentials?.leverage || config.leverage)
                    : 0,
                holdTime: Date.now() - state.position.entryTime,
                strategy: state.position.strategy
            } : null,
            stats: this.calculateStats(state.trades),
            consecutiveLosses: state.consecutiveLosses || 0,
            lastUpdate: new Date().toISOString()
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
    }

    private handleApiTrades(res: http.ServerResponse): void {
        const state = this.getState();
        const recentTrades = state.trades.slice(-100).reverse();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(recentTrades, null, 2));
    }

    private handleApiPrices(res: http.ServerResponse): void {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.priceHistory.slice(-100)));
    }

    private calculateStats(trades: TradeResult[]): any {
        if (trades.length === 0) {
            return {
                winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0,
                totalPnl: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
                bestTrade: 0, worstTrade: 0, avgTrade: 0, expectancy: 0
            };
        }

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
        const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

        const winRate = wins.length / trades.length;
        const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
        const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

        return {
            winRate: winRate * 100,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
            avgWin,
            avgLoss,
            totalPnl,
            totalTrades: trades.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            bestTrade: Math.max(...trades.map(t => t.pnl)),
            worstTrade: Math.min(...trades.map(t => t.pnl)),
            avgTrade: totalPnl / trades.length,
            expectancy: (winRate * avgWin) - ((1 - winRate) * avgLoss)
        };
    }

    private handleDashboard(res: http.ServerResponse): void {
        const html = this.getHtmlTemplate();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    private getHtmlTemplate(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Perp DEX Bot - Multi-Exchange Trading</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            background: #0a0a0f;
            color: #e4e4e7;
            min-height: 100vh;
        }

        /* Setup Screen */
        .setup-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #0a0a0f;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.3s, visibility 0.3s;
        }
        .setup-overlay.hidden { opacity: 0; visibility: hidden; pointer-events: none; }

        .setup-container {
            width: 100%;
            max-width: 600px;
            padding: 20px;
        }
        .setup-header {
            text-align: center;
            margin-bottom: 32px;
        }
        .setup-logo {
            font-size: 2rem;
            font-weight: 800;
            background: linear-gradient(135deg, #00d4ff, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }
        .setup-subtitle { color: #71717a; font-size: 0.95rem; }

        .setup-card {
            background: #18181b;
            border-radius: 16px;
            padding: 32px;
            border: 1px solid rgba(255,255,255,0.1);
        }

        .step-indicator {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 32px;
        }
        .step-dot {
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #3f3f46;
            transition: all 0.3s;
        }
        .step-dot.active { background: #a855f7; transform: scale(1.2); }
        .step-dot.completed { background: #22c55e; }

        .step-content { display: none; }
        .step-content.active { display: block; }

        .step-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .step-desc { color: #71717a; font-size: 0.9rem; margin-bottom: 24px; }

        /* Exchange Cards */
        .exchange-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }
        .exchange-card {
            background: #27272a;
            border: 2px solid transparent;
            border-radius: 12px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .exchange-card:hover { border-color: #52525b; }
        .exchange-card.selected { border-color: #a855f7; background: rgba(168,85,247,0.1); }
        .exchange-name { font-weight: 600; margin-bottom: 4px; }
        .exchange-desc { font-size: 0.75rem; color: #71717a; }
        .exchange-badge {
            display: inline-block;
            font-size: 0.65rem;
            padding: 2px 8px;
            border-radius: 10px;
            background: rgba(34,197,94,0.2);
            color: #22c55e;
            margin-top: 8px;
        }

        /* Form Elements */
        .form-group { margin-bottom: 20px; }
        .form-label {
            display: block;
            font-size: 0.85rem;
            font-weight: 500;
            margin-bottom: 8px;
            color: #a1a1aa;
        }
        .form-input {
            width: 100%;
            padding: 12px 16px;
            background: #27272a;
            border: 1px solid #3f3f46;
            border-radius: 8px;
            color: #e4e4e7;
            font-size: 0.95rem;
            transition: border-color 0.2s;
        }
        .form-input:focus { outline: none; border-color: #a855f7; }
        .form-input::placeholder { color: #52525b; }
        .form-select {
            width: 100%;
            padding: 12px 16px;
            background: #27272a;
            border: 1px solid #3f3f46;
            border-radius: 8px;
            color: #e4e4e7;
            font-size: 0.95rem;
        }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-hint { font-size: 0.75rem; color: #71717a; margin-top: 6px; }

        /* Mode Toggle */
        .mode-toggle {
            display: flex;
            background: #27272a;
            border-radius: 8px;
            padding: 4px;
        }
        .mode-btn {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: #71717a;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .mode-btn.active { background: #a855f7; color: white; }
        .mode-btn:hover:not(.active) { color: #e4e4e7; }

        /* Buttons */
        .btn-row { display: flex; gap: 12px; margin-top: 24px; }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.95rem;
        }
        .btn-primary { background: #a855f7; color: white; flex: 1; }
        .btn-primary:hover { background: #9333ea; }
        .btn-secondary { background: #27272a; color: #e4e4e7; }
        .btn-secondary:hover { background: #3f3f46; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Warning Box */
        .warning-box {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
            font-size: 0.85rem;
            color: #fca5a5;
        }
        .warning-box strong { color: #ef4444; }

        /* Main Dashboard */
        .header {
            background: linear-gradient(135deg, #18181b 0%, #1e1b2e 100%);
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .logo {
            font-size: 1.25rem;
            font-weight: 700;
            background: linear-gradient(90deg, #00d4ff, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .exchange-tag {
            padding: 4px 12px;
            background: rgba(168,85,247,0.2);
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
            color: #a855f7;
        }
        .header-right { display: flex; gap: 12px; align-items: center; }

        .status-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        .status-running { background: rgba(34,197,94,0.2); color: #22c55e; }
        .status-stopped { background: rgba(239,68,68,0.2); color: #ef4444; }
        .status-dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        .status-running .status-dot { background: #22c55e; }
        .status-stopped .status-dot { background: #ef4444; animation: none; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        .btn-sm {
            padding: 8px 16px;
            font-size: 0.85rem;
            border-radius: 6px;
        }
        .btn-danger { background: #ef4444; color: white; }
        .btn-danger:hover { background: #dc2626; }
        .btn-success { background: #22c55e; color: white; }
        .btn-success:hover { background: #16a34a; }
        .btn-outline {
            background: transparent;
            border: 1px solid #3f3f46;
            color: #a1a1aa;
        }
        .btn-outline:hover { background: #27272a; color: #e4e4e7; }

        .container { padding: 24px; max-width: 1600px; margin: 0 auto; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        @media (max-width: 1200px) { .grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } .exchange-grid { grid-template-columns: 1fr; } }

        .card {
            background: #18181b;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .card-title { font-size: 0.75rem; text-transform: uppercase; color: #71717a; letter-spacing: 0.5px; margin-bottom: 8px; }
        .card-value { font-size: 1.75rem; font-weight: 700; }
        .card-sub { font-size: 0.8rem; color: #71717a; margin-top: 4px; }
        .positive { color: #22c55e; }
        .negative { color: #ef4444; }

        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        @media (max-width: 900px) { .row { grid-template-columns: 1fr; } }

        .position-card { background: linear-gradient(135deg, #1e293b 0%, #1e1b4b 100%); }
        .position-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
        .side-badge {
            padding: 6px 16px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 0.9rem;
        }
        .side-long { background: rgba(34,197,94,0.2); color: #22c55e; }
        .side-short { background: rgba(239,68,68,0.2); color: #ef4444; }
        .position-pnl { font-size: 1.75rem; font-weight: 700; }
        .position-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .position-label { font-size: 0.7rem; color: #71717a; text-transform: uppercase; margin-bottom: 4px; }
        .position-value { font-size: 1rem; font-weight: 600; }

        .chart-container { height: 220px; position: relative; }

        .trades-table { width: 100%; border-collapse: collapse; }
        .trades-table th, .trades-table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.85rem;
        }
        .trades-table th { color: #71717a; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
        .trades-table tr:hover { background: rgba(255,255,255,0.02); }

        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
        }
        .badge-long { background: rgba(34,197,94,0.2); color: #22c55e; }
        .badge-short { background: rgba(239,68,68,0.2); color: #ef4444; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .stat-item {
            background: rgba(255,255,255,0.03);
            padding: 12px;
            border-radius: 8px;
            text-align: center;
        }
        .stat-label { font-size: 0.65rem; color: #71717a; text-transform: uppercase; }
        .stat-value { font-size: 1.1rem; font-weight: 600; margin-top: 4px; }

        .no-data { text-align: center; padding: 40px; color: #52525b; }
        .footer { text-align: center; padding: 16px; color: #52525b; font-size: 0.8rem; }

        /* Testnet indicator */
        .testnet-badge {
            background: rgba(234,179,8,0.2);
            color: #eab308;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.7rem;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <!-- Setup Overlay -->
    <div id="setupOverlay" class="setup-overlay">
        <div class="setup-container">
            <div class="setup-header">
                <div class="setup-logo">Perp DEX Bot</div>
                <div class="setup-subtitle">Multi-Exchange Perpetual Trading</div>
            </div>

            <div class="setup-card">
                <div class="step-indicator">
                    <div class="step-dot active" data-step="1"></div>
                    <div class="step-dot" data-step="2"></div>
                    <div class="step-dot" data-step="3"></div>
                </div>

                <!-- Step 1: Exchange Selection -->
                <div class="step-content active" data-step="1">
                    <div class="step-title">Select Exchange</div>
                    <div class="step-desc">Choose which perpetual DEX you want to trade on</div>

                    <div class="exchange-grid" id="exchangeGrid">
                        <div class="exchange-card" data-exchange="NADO">
                            <div class="exchange-name">Nado</div>
                            <div class="exchange-desc">Kraken-backed CLOB on Ink L2</div>
                            <div class="exchange-badge">Up to 20x</div>
                        </div>
                        <div class="exchange-card" data-exchange="GRVT">
                            <div class="exchange-name">GRVT</div>
                            <div class="exchange-desc">Hybrid DEX on zkSync</div>
                            <div class="exchange-badge">Up to 50x</div>
                        </div>
                        <div class="exchange-card" data-exchange="PACIFICA">
                            <div class="exchange-name">Pacifica</div>
                            <div class="exchange-desc">High-performance Solana DEX</div>
                            <div class="exchange-badge">Up to 50x</div>
                        </div>
                        <div class="exchange-card" data-exchange="STANDX">
                            <div class="exchange-name">StandX</div>
                            <div class="exchange-desc">Solana/BNB with DUSD yield</div>
                            <div class="exchange-badge">Up to 20x</div>
                        </div>
                    </div>

                    <div class="btn-row">
                        <button class="btn btn-primary" id="step1Next" disabled>Continue</button>
                    </div>
                </div>

                <!-- Step 2: Mode & Credentials -->
                <div class="step-content" data-step="2">
                    <div class="step-title">Trading Mode & Credentials</div>
                    <div class="step-desc">Configure your trading mode and API credentials</div>

                    <div class="form-group">
                        <label class="form-label">Trading Mode</label>
                        <div class="mode-toggle">
                            <button class="mode-btn active" data-mode="paper">Paper Trading</button>
                            <button class="mode-btn" data-mode="live">Live Trading</button>
                        </div>
                    </div>

                    <div id="paperConfig">
                        <div class="form-group">
                            <label class="form-label">Starting Balance (USD)</label>
                            <input type="number" class="form-input" id="paperBalance" value="10000" min="100">
                        </div>
                    </div>

                    <div id="liveConfig" style="display:none;">
                        <div class="warning-box">
                            <strong>Warning:</strong> Live trading uses real funds. Only trade with money you can afford to lose. Start with small amounts.
                        </div>

                        <div class="form-group">
                            <label class="form-label">Network</label>
                            <div class="mode-toggle">
                                <button class="mode-btn active" data-testnet="true">Testnet</button>
                                <button class="mode-btn" data-testnet="false">Mainnet</button>
                            </div>
                        </div>

                        <div id="credentialsForm">
                            <!-- Dynamic based on exchange -->
                        </div>
                    </div>

                    <div class="btn-row">
                        <button class="btn btn-secondary" id="step2Back">Back</button>
                        <button class="btn btn-primary" id="step2Next">Continue</button>
                    </div>
                </div>

                <!-- Step 3: Trading Config -->
                <div class="step-content" data-step="3">
                    <div class="step-title">Trading Configuration</div>
                    <div class="step-desc">Set your trading parameters</div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Trading Pair</label>
                            <select class="form-select" id="symbol">
                                <option value="BTC">BTC-PERP</option>
                                <option value="ETH">ETH-PERP</option>
                                <option value="SOL">SOL-PERP</option>
                                <option value="ARB">ARB-PERP</option>
                                <option value="DOGE">DOGE-PERP</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Timeframe</label>
                            <select class="form-select" id="timeframe">
                                <option value="1m">1 minute</option>
                                <option value="5m">5 minutes</option>
                                <option value="15m" selected>15 minutes</option>
                                <option value="30m">30 minutes</option>
                                <option value="1h">1 hour</option>
                                <option value="4h">4 hours</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Leverage</label>
                            <input type="number" class="form-input" id="leverage" value="3" min="1" max="50">
                            <div class="form-hint">Max leverage depends on exchange</div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Max Position Size (%)</label>
                            <input type="number" class="form-input" id="positionSize" value="20" min="1" max="100">
                            <div class="form-hint">% of equity per trade</div>
                        </div>
                    </div>

                    <div class="btn-row">
                        <button class="btn btn-secondary" id="step3Back">Back</button>
                        <button class="btn btn-primary" id="startBotBtn">Start Bot</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Main Dashboard -->
    <div id="mainDashboard" style="display:none;">
        <div class="header">
            <div class="header-left">
                <div class="logo">Perp DEX Bot</div>
                <div class="exchange-tag" id="exchangeTag">-</div>
                <div class="testnet-badge" id="testnetBadge" style="display:none;">TESTNET</div>
            </div>
            <div class="header-right">
                <div id="statusBadge" class="status-badge status-stopped">
                    <span class="status-dot"></span>
                    <span id="statusText">Stopped</span>
                </div>
                <button class="btn btn-sm btn-danger" id="stopBotBtn" onclick="stopBot()">Stop Bot</button>
                <button class="btn btn-sm btn-outline" onclick="showSetup()">Settings</button>
            </div>
        </div>

        <div class="container">
            <div class="grid">
                <div class="card">
                    <div class="card-title">Current Price</div>
                    <div class="card-value" id="currentPrice">$0.00</div>
                    <div class="card-sub" id="priceInfo">BTC | 15m</div>
                </div>
                <div class="card">
                    <div class="card-title">Equity</div>
                    <div class="card-value" id="equity">$0.00</div>
                    <div class="card-sub" id="totalPnl">Total PnL: $0.00</div>
                </div>
                <div class="card">
                    <div class="card-title">Today's PnL</div>
                    <div class="card-value" id="dailyPnl">$0.00</div>
                    <div class="card-sub" id="dailyTrades">Trades: 0/3</div>
                </div>
                <div class="card">
                    <div class="card-title">Win Rate</div>
                    <div class="card-value" id="winRate">0%</div>
                    <div class="card-sub" id="profitFactor">PF: 0.00</div>
                </div>
            </div>

            <div class="row">
                <div class="card position-card">
                    <div class="card-title">Current Position</div>
                    <div id="positionContent">
                        <div class="no-data">No open position</div>
                    </div>
                </div>
                <div class="card">
                    <div class="card-title">Price Chart</div>
                    <div class="chart-container">
                        <canvas id="priceChart"></canvas>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-bottom:24px;">
                <div class="card-title">Performance Statistics</div>
                <div class="stats-grid">
                    <div class="stat-item"><div class="stat-label">Total Trades</div><div class="stat-value" id="statTotalTrades">0</div></div>
                    <div class="stat-item"><div class="stat-label">Winning</div><div class="stat-value positive" id="statWinning">0</div></div>
                    <div class="stat-item"><div class="stat-label">Losing</div><div class="stat-value negative" id="statLosing">0</div></div>
                    <div class="stat-item"><div class="stat-label">Profit Factor</div><div class="stat-value" id="statPF">0.00</div></div>
                    <div class="stat-item"><div class="stat-label">Avg Win</div><div class="stat-value positive" id="statAvgWin">$0</div></div>
                    <div class="stat-item"><div class="stat-label">Avg Loss</div><div class="stat-value negative" id="statAvgLoss">$0</div></div>
                    <div class="stat-item"><div class="stat-label">Best Trade</div><div class="stat-value positive" id="statBest">$0</div></div>
                    <div class="stat-item"><div class="stat-label">Worst Trade</div><div class="stat-value negative" id="statWorst">$0</div></div>
                </div>
            </div>

            <div class="row">
                <div class="card">
                    <div class="card-title">Equity Curve</div>
                    <div class="chart-container">
                        <canvas id="equityChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <div class="card-title">Recent Trades</div>
                    <div style="max-height:220px;overflow-y:auto;">
                        <table class="trades-table">
                            <thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Reason</th></tr></thead>
                            <tbody id="tradesBody"><tr><td colspan="5" class="no-data">No trades</td></tr></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div class="footer">Auto-refresh every 3 seconds | <span id="lastUpdate">-</span></div>
    </div>

    <script>
        // State
        let currentStep = 1;
        let selectedExchange = null;
        let tradingMode = 'paper';
        let isTestnet = true;
        let priceChart, equityChart;
        let equityHistory = [];

        // Exchange credentials config
        const exchangeCredentials = {
            NADO: [
                { id: 'privateKey', label: 'Private Key', type: 'password', hint: 'Your wallet private key' },
                { id: 'walletAddress', label: 'Wallet Address', type: 'text', hint: '0x...' }
            ],
            GRVT: [
                { id: 'apiKey', label: 'API Key', type: 'password', hint: 'From GRVT dashboard' },
                { id: 'subAccountId', label: 'Sub Account ID', type: 'text', hint: 'Your sub account ID' }
            ],
            PACIFICA: [
                { id: 'apiKey', label: 'API Key', type: 'password', hint: 'From Pacifica dashboard' },
                { id: 'walletAddress', label: 'Solana Wallet', type: 'text', hint: 'Your Solana wallet address' }
            ],
            STANDX: [
                { id: 'privateKey', label: 'Private Key', type: 'password', hint: 'Your wallet private key' },
                { id: 'walletAddress', label: 'Wallet Address', type: 'text', hint: 'Solana or BNB address' }
            ]
        };

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initExchangeSelection();
            initModeToggle();
            initStepNavigation();
            initCharts();
            checkBotStatus();
        });

        function initExchangeSelection() {
            document.querySelectorAll('.exchange-card').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.exchange-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    selectedExchange = card.dataset.exchange;
                    document.getElementById('step1Next').disabled = false;
                });
            });
        }

        function initModeToggle() {
            // Paper/Live toggle
            document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    tradingMode = btn.dataset.mode;
                    document.getElementById('paperConfig').style.display = tradingMode === 'paper' ? 'block' : 'none';
                    document.getElementById('liveConfig').style.display = tradingMode === 'live' ? 'block' : 'none';
                    if (tradingMode === 'live') {
                        renderCredentialsForm();
                    }
                });
            });

            // Testnet toggle
            document.querySelectorAll('.mode-btn[data-testnet]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.mode-btn[data-testnet]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    isTestnet = btn.dataset.testnet === 'true';
                });
            });
        }

        function renderCredentialsForm() {
            const fields = exchangeCredentials[selectedExchange] || [];
            const html = fields.map(f => \`
                <div class="form-group">
                    <label class="form-label">\${f.label}</label>
                    <input type="\${f.type}" class="form-input" id="cred_\${f.id}" placeholder="\${f.hint}">
                    <div class="form-hint">\${f.hint}</div>
                </div>
            \`).join('');
            document.getElementById('credentialsForm').innerHTML = html;
        }

        function initStepNavigation() {
            document.getElementById('step1Next').addEventListener('click', () => goToStep(2));
            document.getElementById('step2Back').addEventListener('click', () => goToStep(1));
            document.getElementById('step2Next').addEventListener('click', () => goToStep(3));
            document.getElementById('step3Back').addEventListener('click', () => goToStep(2));
            document.getElementById('startBotBtn').addEventListener('click', startBot);
        }

        function goToStep(step) {
            currentStep = step;
            document.querySelectorAll('.step-content').forEach(c => c.classList.remove('active'));
            document.querySelector(\`.step-content[data-step="\${step}"]\`).classList.add('active');

            document.querySelectorAll('.step-dot').forEach(d => {
                const dotStep = parseInt(d.dataset.step);
                d.classList.remove('active', 'completed');
                if (dotStep === step) d.classList.add('active');
                else if (dotStep < step) d.classList.add('completed');
            });

            if (step === 2 && tradingMode === 'live') {
                renderCredentialsForm();
            }
        }

        async function startBot() {
            const credentials = {
                exchange: selectedExchange,
                mode: tradingMode,
                testnet: isTestnet,
                symbol: document.getElementById('symbol').value,
                timeframe: document.getElementById('timeframe').value,
                leverage: parseInt(document.getElementById('leverage').value),
                paperBalance: parseInt(document.getElementById('paperBalance').value) || 10000
            };

            if (tradingMode === 'live') {
                const fields = exchangeCredentials[selectedExchange] || [];
                fields.forEach(f => {
                    const el = document.getElementById('cred_' + f.id);
                    if (el) credentials[f.id] = el.value;
                });
            }

            try {
                document.getElementById('startBotBtn').disabled = true;
                document.getElementById('startBotBtn').textContent = 'Starting...';

                const res = await fetch('/api/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(credentials)
                });
                const data = await res.json();

                if (data.success) {
                    document.getElementById('setupOverlay').classList.add('hidden');
                    document.getElementById('mainDashboard').style.display = 'block';
                    startDataFetching();
                } else {
                    alert('Failed to start bot: ' + data.message);
                }
            } catch (e) {
                alert('Error starting bot: ' + e.message);
            } finally {
                document.getElementById('startBotBtn').disabled = false;
                document.getElementById('startBotBtn').textContent = 'Start Bot';
            }
        }

        async function stopBot() {
            if (!confirm('Are you sure you want to stop the bot?')) return;

            try {
                const res = await fetch('/api/stop', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showSetup();
                } else {
                    alert('Failed to stop bot: ' + data.message);
                }
            } catch (e) {
                alert('Error stopping bot: ' + e.message);
            }
        }

        function showSetup() {
            document.getElementById('setupOverlay').classList.remove('hidden');
            document.getElementById('mainDashboard').style.display = 'none';
            goToStep(1);
        }

        async function checkBotStatus() {
            try {
                const res = await fetch('/api/status');
                const status = await res.json();

                if (status.botRunning) {
                    document.getElementById('setupOverlay').classList.add('hidden');
                    document.getElementById('mainDashboard').style.display = 'block';
                    startDataFetching();
                }
            } catch (e) {
                console.error('Status check failed:', e);
            }
        }

        function initCharts() {
            const priceCtx = document.getElementById('priceChart')?.getContext('2d');
            if (priceCtx) {
                priceChart = new Chart(priceCtx, {
                    type: 'line',
                    data: { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', fill: true, tension: 0.4, pointRadius: 0 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a' } } } }
                });
            }

            const equityCtx = document.getElementById('equityChart')?.getContext('2d');
            if (equityCtx) {
                equityChart = new Chart(equityCtx, {
                    type: 'line',
                    data: { labels: [], datasets: [{ label: 'Equity', data: [], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.4, pointRadius: 0 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a', callback: v => '$' + v } } } }
                });
            }
        }

        let fetchInterval;
        function startDataFetching() {
            fetchData();
            if (fetchInterval) clearInterval(fetchInterval);
            fetchInterval = setInterval(fetchData, 3000);
        }

        async function fetchData() {
            try {
                const [statusRes, tradesRes, pricesRes] = await Promise.all([
                    fetch('/api/status'),
                    fetch('/api/trades'),
                    fetch('/api/prices')
                ]);
                const status = await statusRes.json();
                const trades = await tradesRes.json();
                const prices = await pricesRes.json();
                updateUI(status, trades, prices);
            } catch (e) {
                console.error('Fetch error:', e);
            }
        }

        function updateUI(status, trades, prices) {
            // Header info
            document.getElementById('exchangeTag').textContent = status.exchange || 'PAPER';
            document.getElementById('testnetBadge').style.display = status.testnet ? 'inline-block' : 'none';

            // Bot status
            const badge = document.getElementById('statusBadge');
            const statusText = document.getElementById('statusText');
            if (status.botRunning) {
                badge.className = 'status-badge status-running';
                statusText.textContent = 'Running';
            } else {
                badge.className = 'status-badge status-stopped';
                statusText.textContent = 'Stopped';
            }

            // Metrics
            document.getElementById('currentPrice').textContent = '$' + (status.currentPrice || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('priceInfo').textContent = (status.symbol || 'BTC') + ' | ' + (status.timeframe || '15m') + ' | ' + (status.mode || 'paper').toUpperCase();
            document.getElementById('equity').textContent = '$' + (status.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});

            const totalPnlEl = document.getElementById('totalPnl');
            totalPnlEl.innerHTML = 'Total: <span class="' + (status.totalPnl >= 0 ? 'positive' : 'negative') + '">' + (status.totalPnl >= 0 ? '+' : '') + '$' + (status.totalPnl || 0).toFixed(2) + '</span>';

            const dailyPnlEl = document.getElementById('dailyPnl');
            dailyPnlEl.className = 'card-value ' + ((status.dailyPnl || 0) >= 0 ? 'positive' : 'negative');
            dailyPnlEl.textContent = ((status.dailyPnl || 0) >= 0 ? '+' : '') + '$' + (status.dailyPnl || 0).toFixed(2);
            document.getElementById('dailyTrades').textContent = 'Trades: ' + (status.dailyTrades || 0) + '/' + (status.maxDailyTrades || 3);

            document.getElementById('winRate').textContent = (status.stats?.winRate || 0).toFixed(1) + '%';
            document.getElementById('profitFactor').textContent = 'PF: ' + (status.stats?.profitFactor === Infinity ? '∞' : (status.stats?.profitFactor || 0).toFixed(2));

            // Position
            const posContent = document.getElementById('positionContent');
            if (status.position) {
                const p = status.position;
                const pnlClass = p.unrealizedPnl >= 0 ? 'positive' : 'negative';
                const mins = Math.floor((p.holdTime || 0) / 60000);
                posContent.innerHTML = \`
                    <div class="position-header">
                        <span class="side-badge side-\${p.side.toLowerCase()}">\${p.side}</span>
                        <span class="position-pnl \${pnlClass}">\${p.unrealizedPnl >= 0 ? '+' : ''}\$\${p.unrealizedPnl.toFixed(2)} (\${(p.unrealizedPnlPercent || 0).toFixed(2)}%)</span>
                    </div>
                    <div class="position-grid">
                        <div><div class="position-label">Entry</div><div class="position-value">\$\${p.entryPrice.toLocaleString()}</div></div>
                        <div><div class="position-label">Size</div><div class="position-value">\${p.size.toFixed(4)}</div></div>
                        <div><div class="position-label">Stop Loss</div><div class="position-value negative">\$\${p.stopLoss.toLocaleString()}</div></div>
                        <div><div class="position-label">Take Profit</div><div class="position-value positive">\$\${p.takeProfit.toLocaleString()}</div></div>
                        <div><div class="position-label">Hold Time</div><div class="position-value">\${mins}m</div></div>
                        <div><div class="position-label">Strategy</div><div class="position-value">\${p.strategy || 'SUPERTREND'}</div></div>
                    </div>
                \`;
            } else {
                posContent.innerHTML = '<div class="no-data">No open position</div>';
            }

            // Stats
            const s = status.stats || {};
            document.getElementById('statTotalTrades').textContent = s.totalTrades || 0;
            document.getElementById('statWinning').textContent = s.winningTrades || 0;
            document.getElementById('statLosing').textContent = s.losingTrades || 0;
            document.getElementById('statPF').textContent = s.profitFactor === Infinity ? '∞' : (s.profitFactor || 0).toFixed(2);
            document.getElementById('statAvgWin').textContent = '$' + (s.avgWin || 0).toFixed(2);
            document.getElementById('statAvgLoss').textContent = '$' + (s.avgLoss || 0).toFixed(2);
            document.getElementById('statBest').textContent = '$' + (s.bestTrade || 0).toFixed(2);
            document.getElementById('statWorst').textContent = '$' + (s.worstTrade || 0).toFixed(2);

            // Charts
            if (prices.length > 0 && priceChart) {
                priceChart.data.labels = prices.map(p => new Date(p.time).toLocaleTimeString());
                priceChart.data.datasets[0].data = prices.map(p => p.price);
                priceChart.update('none');
            }

            equityHistory.push({ time: Date.now(), equity: status.equity || 10000 });
            if (equityHistory.length > 100) equityHistory = equityHistory.slice(-100);
            if (equityChart) {
                equityChart.data.labels = equityHistory.map(e => new Date(e.time).toLocaleTimeString());
                equityChart.data.datasets[0].data = equityHistory.map(e => e.equity);
                equityChart.update('none');
            }

            // Trades table
            const tbody = document.getElementById('tradesBody');
            if (!trades || trades.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="no-data">No trades yet</td></tr>';
            } else {
                tbody.innerHTML = trades.slice(0, 15).map(t => \`
                    <tr>
                        <td><span class="badge badge-\${t.side.toLowerCase()}">\${t.side}</span></td>
                        <td>\$\${t.entryPrice.toFixed(2)}</td>
                        <td>\$\${t.exitPrice.toFixed(2)}</td>
                        <td class="\${t.pnl >= 0 ? 'positive' : 'negative'}">\${t.pnl >= 0 ? '+' : ''}\$\${t.pnl.toFixed(2)}</td>
                        <td>\${t.exitReason}</td>
                    </tr>
                \`).join('');
            }

            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
        }
    </script>
</body>
</html>`;
    }
}
