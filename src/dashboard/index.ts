// ═══════════════════════════════════════════════════════════════════════════
// WEB DASHBOARD WITH BOT CONTROL
// Real-time monitoring, bot control, price tracking, performance charts
// ═══════════════════════════════════════════════════════════════════════════

import http from 'http';
import { BotState, TradeResult } from '../types';
import { Logger } from '../utils/logger';

export interface DashboardConfig {
    port: number;
    enabled: boolean;
    password?: string; // Optional password protection
}

export class Dashboard {
    private server: http.Server | null = null;
    private config: DashboardConfig;
    private logger: Logger;
    private getState: () => BotState;
    private getConfig: () => any;
    private onStartBot: () => Promise<void>;
    private onStopBot: () => Promise<void>;
    private isRunning: () => boolean;
    private priceHistory: { time: number; price: number }[] = [];

    constructor(
        config: DashboardConfig,
        callbacks: {
            getState: () => BotState;
            getConfig: () => any;
            onStartBot: () => Promise<void>;
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

    // Update price history (call from bot tick)
    updatePrice(price: number): void {
        this.priceHistory.push({ time: Date.now(), price });
        // Keep last 500 data points (~8 hours at 1min intervals)
        if (this.priceHistory.length > 500) {
            this.priceHistory = this.priceHistory.slice(-500);
        }
    }

    start(): void {
        if (!this.config.enabled) return;

        this.server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            // Handle preflight
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
                    await this.handleBotStart(res);
                } else if (url === '/api/stop' && req.method === 'POST') {
                    await this.handleBotStop(res);
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

    private async handleBotStart(res: http.ServerResponse): Promise<void> {
        try {
            if (this.isRunning()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Bot is already running' }));
                return;
            }
            await this.onStartBot();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Bot started' }));
        } catch (error) {
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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Bot stopped' }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
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
            symbol: config.symbol,
            timeframe: config.timeframe,
            leverage: config.leverage,
            mode: config.mode || 'paper',
            currentPrice,
            equity: state.equity,
            initialEquity: config.paperBalance || 10000,
            dailyPnl: state.dailyPnl,
            dailyPnlPercent: state.equity > 0 ? (state.dailyPnl / state.equity) * 100 : 0,
            totalPnl: state.equity - (config.paperBalance || 10000),
            totalPnlPercent: ((state.equity - (config.paperBalance || 10000)) / (config.paperBalance || 10000)) * 100,
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
                    ? ((currentPrice - state.position.entryPrice) / state.position.entryPrice) * 100 * (state.position.side === 'LONG' ? 1 : -1) * config.leverage
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
    <title>Perp DEX Bot Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            background: #0f0f1a;
            color: #e4e4e7;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #1e1e2e 0%, #2d1b4e 100%);
            padding: 20px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(90deg, #00d4ff, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .controls { display: flex; gap: 12px; align-items: center; }
        .btn {
            padding: 10px 24px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.9rem;
        }
        .btn-start { background: #22c55e; color: white; }
        .btn-start:hover { background: #16a34a; transform: translateY(-1px); }
        .btn-stop { background: #ef4444; color: white; }
        .btn-stop:hover { background: #dc2626; transform: translateY(-1px); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .status-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.85rem;
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

        .container { padding: 24px; max-width: 1600px; margin: 0 auto; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        @media (max-width: 1200px) { .grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }

        .card {
            background: #1a1a2e;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .card-title { font-size: 0.8rem; text-transform: uppercase; color: #71717a; letter-spacing: 0.5px; }
        .card-value { font-size: 1.8rem; font-weight: 700; }
        .card-sub { font-size: 0.85rem; color: #71717a; margin-top: 4px; }
        .positive { color: #22c55e; }
        .negative { color: #ef4444; }
        .neutral { color: #eab308; }

        .section { margin-bottom: 24px; }
        .section-title { font-size: 1rem; font-weight: 600; margin-bottom: 16px; color: #a1a1aa; }

        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
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
        .position-pnl { font-size: 2rem; font-weight: 700; }
        .position-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
        }
        .position-item { }
        .position-label { font-size: 0.75rem; color: #71717a; text-transform: uppercase; margin-bottom: 4px; }
        .position-value { font-size: 1.1rem; font-weight: 600; }

        .chart-container { height: 250px; position: relative; }
        .trades-table {
            width: 100%;
            border-collapse: collapse;
        }
        .trades-table th, .trades-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .trades-table th { color: #71717a; font-weight: 500; font-size: 0.8rem; text-transform: uppercase; }
        .trades-table tr:hover { background: rgba(255,255,255,0.02); }
        .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .badge-long { background: rgba(34,197,94,0.2); color: #22c55e; }
        .badge-short { background: rgba(239,68,68,0.2); color: #ef4444; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
        }
        .stat-item {
            background: rgba(255,255,255,0.03);
            padding: 12px;
            border-radius: 8px;
            text-align: center;
        }
        .stat-label { font-size: 0.7rem; color: #71717a; text-transform: uppercase; }
        .stat-value { font-size: 1.2rem; font-weight: 600; margin-top: 4px; }

        .no-data {
            text-align: center;
            padding: 40px;
            color: #52525b;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #52525b;
            font-size: 0.85rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">Perp DEX Bot</div>
        <div class="controls">
            <div id="statusBadge" class="status-badge status-stopped">
                <span class="status-dot"></span>
                <span id="statusText">Stopped</span>
            </div>
            <button id="startBtn" class="btn btn-start" onclick="startBot()">Start Bot</button>
            <button id="stopBtn" class="btn btn-stop" onclick="stopBot()" disabled>Stop Bot</button>
        </div>
    </div>

    <div class="container">
        <!-- Key Metrics -->
        <div class="grid">
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Current Price</span>
                </div>
                <div class="card-value" id="currentPrice">$0.00</div>
                <div class="card-sub" id="priceInfo">BTC | 15m</div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Equity</span>
                </div>
                <div class="card-value" id="equity">$0.00</div>
                <div class="card-sub" id="totalPnl">Total PnL: $0.00</div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Today's PnL</span>
                </div>
                <div class="card-value" id="dailyPnl">$0.00</div>
                <div class="card-sub" id="dailyTrades">Trades: 0/3</div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Win Rate</span>
                </div>
                <div class="card-value" id="winRate">0%</div>
                <div class="card-sub" id="profitFactor">PF: 0.00</div>
            </div>
        </div>

        <!-- Position & Chart Row -->
        <div class="row section">
            <div class="card position-card">
                <div class="card-title" style="margin-bottom:16px;">Current Position</div>
                <div id="positionContent">
                    <div class="no-data">No open position</div>
                </div>
            </div>
            <div class="card">
                <div class="card-title" style="margin-bottom:16px;">Price Chart</div>
                <div class="chart-container">
                    <canvas id="priceChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Performance Stats -->
        <div class="section">
            <div class="card">
                <div class="card-title" style="margin-bottom:16px;">Performance Statistics</div>
                <div class="stats-grid" id="statsGrid">
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
        </div>

        <!-- Equity Chart & Trades -->
        <div class="row section">
            <div class="card">
                <div class="card-title" style="margin-bottom:16px;">Equity Curve</div>
                <div class="chart-container">
                    <canvas id="equityChart"></canvas>
                </div>
            </div>
            <div class="card">
                <div class="card-title" style="margin-bottom:16px;">Recent Trades</div>
                <div style="max-height:250px;overflow-y:auto;">
                    <table class="trades-table">
                        <thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Reason</th></tr></thead>
                        <tbody id="tradesBody"><tr><td colspan="5" class="no-data">No trades</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <div class="footer">Auto-refresh every 3 seconds | <span id="lastUpdate">-</span></div>

    <script>
        let priceChart, equityChart;
        let equityHistory = [];

        // Initialize charts
        function initCharts() {
            const priceCtx = document.getElementById('priceChart').getContext('2d');
            priceChart = new Chart(priceCtx, {
                type: 'line',
                data: { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', fill: true, tension: 0.4, pointRadius: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a' } } } }
            });

            const equityCtx = document.getElementById('equityChart').getContext('2d');
            equityChart = new Chart(equityCtx, {
                type: 'line',
                data: { labels: [], datasets: [{ label: 'Equity', data: [], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.4, pointRadius: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a', callback: v => '$' + v } } } }
            });
        }

        async function startBot() {
            try {
                const res = await fetch('/api/start', { method: 'POST' });
                const data = await res.json();
                if (!data.success) alert(data.message);
            } catch (e) { alert('Failed to start bot'); }
        }

        async function stopBot() {
            try {
                const res = await fetch('/api/stop', { method: 'POST' });
                const data = await res.json();
                if (!data.success) alert(data.message);
            } catch (e) { alert('Failed to stop bot'); }
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
            } catch (e) { console.error('Fetch error:', e); }
        }

        function updateUI(status, trades, prices) {
            // Bot status
            const badge = document.getElementById('statusBadge');
            const statusText = document.getElementById('statusText');
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');

            if (status.botRunning) {
                badge.className = 'status-badge status-running';
                statusText.textContent = 'Running';
                startBtn.disabled = true;
                stopBtn.disabled = false;
            } else {
                badge.className = 'status-badge status-stopped';
                statusText.textContent = 'Stopped';
                startBtn.disabled = false;
                stopBtn.disabled = true;
            }

            // Key metrics
            document.getElementById('currentPrice').textContent = '$' + status.currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('priceInfo').textContent = status.symbol + ' | ' + status.timeframe + ' | ' + status.mode.toUpperCase();
            document.getElementById('equity').textContent = '$' + status.equity.toLocaleString(undefined, {minimumFractionDigits: 2});

            const totalPnlEl = document.getElementById('totalPnl');
            totalPnlEl.innerHTML = 'Total: <span class="' + (status.totalPnl >= 0 ? 'positive' : 'negative') + '">' + (status.totalPnl >= 0 ? '+' : '') + '$' + status.totalPnl.toFixed(2) + ' (' + status.totalPnlPercent.toFixed(2) + '%)</span>';

            const dailyPnlEl = document.getElementById('dailyPnl');
            dailyPnlEl.className = 'card-value ' + (status.dailyPnl >= 0 ? 'positive' : 'negative');
            dailyPnlEl.textContent = (status.dailyPnl >= 0 ? '+' : '') + '$' + status.dailyPnl.toFixed(2);
            document.getElementById('dailyTrades').textContent = 'Trades: ' + status.dailyTrades + '/' + status.maxDailyTrades;

            document.getElementById('winRate').textContent = status.stats.winRate.toFixed(1) + '%';
            document.getElementById('profitFactor').textContent = 'PF: ' + (status.stats.profitFactor === Infinity ? '∞' : status.stats.profitFactor.toFixed(2));

            // Position
            const posContent = document.getElementById('positionContent');
            if (status.position) {
                const p = status.position;
                const pnlClass = p.unrealizedPnl >= 0 ? 'positive' : 'negative';
                const mins = Math.floor(p.holdTime / 60000);
                posContent.innerHTML = \`
                    <div class="position-header">
                        <span class="side-badge side-\${p.side.toLowerCase()}">\${p.side}</span>
                        <span class="position-pnl \${pnlClass}">\${p.unrealizedPnl >= 0 ? '+' : ''}\$\${p.unrealizedPnl.toFixed(2)} (\${p.unrealizedPnlPercent.toFixed(2)}%)</span>
                    </div>
                    <div class="position-grid">
                        <div class="position-item"><div class="position-label">Entry</div><div class="position-value">\$\${p.entryPrice.toLocaleString()}</div></div>
                        <div class="position-item"><div class="position-label">Size</div><div class="position-value">\${p.size.toFixed(4)}</div></div>
                        <div class="position-item"><div class="position-label">Stop Loss</div><div class="position-value negative">\$\${p.stopLoss.toLocaleString()}</div></div>
                        <div class="position-item"><div class="position-label">Take Profit</div><div class="position-value positive">\$\${p.takeProfit.toLocaleString()}</div></div>
                        <div class="position-item"><div class="position-label">Hold Time</div><div class="position-value">\${mins}m</div></div>
                        <div class="position-item"><div class="position-label">Strategy</div><div class="position-value">\${p.strategy || 'SUPERTREND'}</div></div>
                    </div>
                \`;
            } else {
                posContent.innerHTML = '<div class="no-data">No open position</div>';
            }

            // Stats
            const s = status.stats;
            document.getElementById('statTotalTrades').textContent = s.totalTrades;
            document.getElementById('statWinning').textContent = s.winningTrades;
            document.getElementById('statLosing').textContent = s.losingTrades;
            document.getElementById('statPF').textContent = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
            document.getElementById('statAvgWin').textContent = '$' + s.avgWin.toFixed(2);
            document.getElementById('statAvgLoss').textContent = '$' + s.avgLoss.toFixed(2);
            document.getElementById('statBest').textContent = '$' + s.bestTrade.toFixed(2);
            document.getElementById('statWorst').textContent = '$' + s.worstTrade.toFixed(2);

            // Price chart
            if (prices.length > 0) {
                priceChart.data.labels = prices.map(p => new Date(p.time).toLocaleTimeString());
                priceChart.data.datasets[0].data = prices.map(p => p.price);
                priceChart.update('none');
            }

            // Equity chart
            equityHistory.push({ time: Date.now(), equity: status.equity });
            if (equityHistory.length > 100) equityHistory = equityHistory.slice(-100);
            equityChart.data.labels = equityHistory.map(e => new Date(e.time).toLocaleTimeString());
            equityChart.data.datasets[0].data = equityHistory.map(e => e.equity);
            equityChart.update('none');

            // Trades table
            const tbody = document.getElementById('tradesBody');
            if (trades.length === 0) {
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

        initCharts();
        fetchData();
        setInterval(fetchData, 3000);
    </script>
</body>
</html>`;
    }
}
