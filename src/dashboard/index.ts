// ═══════════════════════════════════════════════════════════════════════════
// WEB DASHBOARD WITH WEB3 WALLET AUTHENTICATION
// Connect wallet -> Create profile -> Configure & Trade
// ═══════════════════════════════════════════════════════════════════════════

import http from 'http';
import { BotState, TradeResult, ExchangeType } from '../types';
import { Logger } from '../utils/logger';
import { authService, rateLimiters, extractToken, getClientIP } from '../utils/auth';
import { googleOAuth } from '../utils/auth/google';
import {
    tradesToCSV,
    tradesToJSON,
    generatePerformanceReport,
    filterTradesByDateRange,
    filterTradesBySide
} from '../utils/export';
import { Backtester, generateSampleData } from '../backtest';

export interface DashboardConfig {
    port: number;
    enabled: boolean;
}

export interface UserProfile {
    walletAddress: string;
    walletType: 'metamask' | 'phantom' | 'walletconnect';
    chain: 'evm' | 'solana';
    createdAt: number;
    lastLogin: number;
}

export interface RuntimeCredentials {
    exchange: ExchangeType;
    testnet: boolean;
    // Wallet (from connected wallet)
    walletAddress: string;
    walletType: 'metamask' | 'phantom' | 'walletconnect';
    // For signing transactions (will be done via wallet)
    signTransaction?: (tx: any) => Promise<string>;
    // Optional API keys for exchanges that require them
    apiKey?: string;           // GRVT, Pacifica
    apiSecret?: string;        // Some exchanges
    subAccountId?: string;     // GRVT
    privateKey?: string;       // Optional for server-side signing (not recommended)
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
    private connectedProfiles: Map<string, UserProfile> = new Map();

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
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Wallet-Address');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            const url = req.url || '/';
            const clientIP = getClientIP(req as any);

            try {
                // Rate limiting for API endpoints
                if (url.startsWith('/api/')) {
                    const isAuthEndpoint = url.startsWith('/api/auth/') || url === '/api/connect';
                    const isBotControl = url === '/api/start' || url === '/api/stop';

                    const limiter = isAuthEndpoint ? rateLimiters.auth :
                                    isBotControl ? rateLimiters.botControl :
                                    rateLimiters.api;

                    const rateCheck = limiter.check(clientIP);
                    if (!rateCheck.allowed) {
                        res.writeHead(429, {
                            'Content-Type': 'application/json',
                            'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000))
                        });
                        res.end(JSON.stringify({
                            success: false,
                            message: 'Too many requests',
                            retryAfter: Math.ceil(rateCheck.resetIn / 1000)
                        }));
                        return;
                    }
                }

                // Route handling
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
                } else if (url === '/api/connect' && req.method === 'POST') {
                    await this.handleWalletConnect(req, res);
                } else if (url === '/api/profile' && req.method === 'GET') {
                    this.handleGetProfile(req, res);
                // Auth endpoints
                } else if (url === '/api/auth/nonce' && req.method === 'POST') {
                    await this.handleGetNonce(req, res);
                } else if (url === '/api/auth/verify' && req.method === 'POST') {
                    await this.handleVerifySignature(req, res);
                } else if (url === '/api/auth/refresh' && req.method === 'POST') {
                    await this.handleRefreshToken(req, res);
                } else if (url === '/api/auth/logout' && req.method === 'POST') {
                    await this.handleLogout(req, res);
                } else if (url === '/api/auth/google/url' && req.method === 'GET') {
                    this.handleGoogleAuthUrl(req, res);
                } else if (url.startsWith('/auth/google/callback')) {
                    await this.handleGoogleCallback(req, res);
                } else if (url === '/api/auth/google/link' && req.method === 'POST') {
                    await this.handleGoogleLink(req, res);
                // Export & Analytics endpoints
                } else if (url === '/api/export/csv' && req.method === 'GET') {
                    this.handleExportCSV(req, res);
                } else if (url === '/api/export/json' && req.method === 'GET') {
                    this.handleExportJSON(req, res);
                } else if (url === '/api/analytics/report' && req.method === 'GET') {
                    this.handleAnalyticsReport(req, res);
                } else if (url === '/api/analytics/daily' && req.method === 'GET') {
                    this.handleDailyAnalytics(res);
                } else if (url === '/api/analytics/equity' && req.method === 'GET') {
                    this.handleEquityCurve(res);
                // Backtest endpoint
                } else if (url === '/api/backtest' && req.method === 'POST') {
                    await this.handleBacktest(req, res);
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

    private async handleWalletConnect(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.parseBody(req);
            const { walletAddress, walletType, chain, signature, message } = body;

            if (!walletAddress || !walletType) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Wallet address and type required' }));
                return;
            }

            // Create or update profile
            const profile: UserProfile = {
                walletAddress: walletAddress.toLowerCase(),
                walletType,
                chain: chain || 'evm',
                createdAt: this.connectedProfiles.get(walletAddress.toLowerCase())?.createdAt || Date.now(),
                lastLogin: Date.now()
            };

            this.connectedProfiles.set(walletAddress.toLowerCase(), profile);
            this.logger.info(`Wallet connected: ${walletAddress} (${walletType})`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                profile: {
                    address: profile.walletAddress,
                    shortAddress: `${profile.walletAddress.slice(0, 6)}...${profile.walletAddress.slice(-4)}`,
                    walletType: profile.walletType,
                    chain: profile.chain
                }
            }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private handleGetProfile(req: http.IncomingMessage, res: http.ServerResponse): void {
        const walletAddress = req.headers['x-wallet-address'] as string;

        if (!walletAddress) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'No wallet connected' }));
            return;
        }

        const profile = this.connectedProfiles.get(walletAddress.toLowerCase());

        if (!profile) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Profile not found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            profile: {
                address: profile.walletAddress,
                shortAddress: `${profile.walletAddress.slice(0, 6)}...${profile.walletAddress.slice(-4)}`,
                walletType: profile.walletType,
                chain: profile.chain,
                memberSince: new Date(profile.createdAt).toLocaleDateString()
            }
        }));
    }

    private async handleBotStart(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            if (this.isRunning()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Bot is already running' }));
                return;
            }

            const body = await this.parseBody(req);
            const credentials = body as RuntimeCredentials;

            if (!credentials.walletAddress) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Wallet not connected' }));
                return;
            }

            if (!credentials.exchange) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Exchange is required' }));
                return;
            }

            this.currentCredentials = credentials;
            await this.onStartBot(credentials);

            this.logger.info(`Bot started by ${credentials.walletAddress} on ${credentials.exchange}`);

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

    // ─────────────────────────────────────────────────────────────────────────
    // AUTH HANDLERS
    // ─────────────────────────────────────────────────────────────────────────
    private async handleGetNonce(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.parseBody(req);
            const { walletAddress } = body;

            if (!walletAddress) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Wallet address required' }));
                return;
            }

            const nonce = authService.generateNonce(walletAddress);
            const message = `Sign this message to authenticate with Perp DEX Bot.\n\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, nonce, message }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private async handleVerifySignature(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.parseBody(req);
            const { walletAddress, walletType, chain, signature, message } = body;

            if (!walletAddress || !signature || !message) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Missing required fields' }));
                return;
            }

            const session = await authService.authenticate(
                walletAddress,
                walletType || 'metamask',
                chain || 'evm',
                signature,
                message
            );

            if (!session) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Invalid signature' }));
                return;
            }

            // Also update connectedProfiles for backward compatibility
            this.connectedProfiles.set(walletAddress.toLowerCase(), {
                walletAddress: walletAddress.toLowerCase(),
                walletType: walletType || 'metamask',
                chain: chain || 'evm',
                createdAt: session.user.createdAt,
                lastLogin: session.user.lastLogin
            });

            this.logger.info(`User authenticated: ${walletAddress.slice(0, 10)}...`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                token: session.token,
                expiresAt: session.expiresAt,
                user: {
                    address: session.user.walletAddress,
                    shortAddress: `${session.user.walletAddress.slice(0, 6)}...${session.user.walletAddress.slice(-4)}`,
                    walletType: session.user.walletType,
                    chain: session.user.chain,
                    email: session.user.email,
                    googleLinked: !!session.user.googleId
                }
            }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private async handleRefreshToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const token = extractToken(req.headers.authorization as string);
            if (!token) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'No token provided' }));
                return;
            }

            const newToken = authService.refreshToken(token);
            if (!newToken) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Invalid or expired token' }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, token: newToken }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private async handleLogout(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const token = extractToken(req.headers.authorization as string);
            if (token) {
                authService.revokeToken(token);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Logged out' }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private handleGoogleAuthUrl(req: http.IncomingMessage, res: http.ServerResponse): void {
        const walletAddress = req.headers['x-wallet-address'] as string;

        if (!walletAddress) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Wallet address required' }));
            return;
        }

        if (!googleOAuth.isConfigured()) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
            }));
            return;
        }

        const url = googleOAuth.getAuthorizationUrl(walletAddress);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url }));
    }

    private async handleGoogleCallback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
            const code = urlObj.searchParams.get('code');
            const state = urlObj.searchParams.get('state');
            const error = urlObj.searchParams.get('error');

            if (error) {
                res.writeHead(302, { Location: '/?error=google_auth_failed' });
                res.end();
                return;
            }

            if (!code || !state) {
                res.writeHead(302, { Location: '/?error=invalid_callback' });
                res.end();
                return;
            }

            const result = await googleOAuth.exchangeCodeForTokens(code, state);
            if (!result) {
                res.writeHead(302, { Location: '/?error=token_exchange_failed' });
                res.end();
                return;
            }

            const userInfo = await googleOAuth.getUserInfo(result.tokens.access_token);
            if (!userInfo) {
                res.writeHead(302, { Location: '/?error=user_info_failed' });
                res.end();
                return;
            }

            // Link Google account to wallet
            authService.linkGoogleAccount(result.walletAddress, userInfo.id, userInfo.email);

            this.logger.success(`Google linked: ${userInfo.email} -> ${result.walletAddress.slice(0, 10)}...`);

            // Redirect back to dashboard with success
            res.writeHead(302, { Location: '/?google_linked=true' });
            res.end();
        } catch (error) {
            this.logger.error('Google callback error', error as Error);
            res.writeHead(302, { Location: '/?error=callback_error' });
            res.end();
        }
    }

    private async handleGoogleLink(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.parseBody(req);
            const { idToken, walletAddress } = body;

            if (!idToken || !walletAddress) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'ID token and wallet address required' }));
                return;
            }

            const userInfo = await googleOAuth.verifyIdToken(idToken);
            if (!userInfo) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Invalid Google ID token' }));
                return;
            }

            const linked = authService.linkGoogleAccount(walletAddress, userInfo.id, userInfo.email);
            if (!linked) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Failed to link account' }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                email: userInfo.email,
                message: 'Google account linked successfully'
            }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPORT & ANALYTICS HANDLERS
    // ─────────────────────────────────────────────────────────────────────────
    private handleExportCSV(req: http.IncomingMessage, res: http.ServerResponse): void {
        try {
            const state = this.getState();
            const urlObj = new URL(req.url || '', `http://${req.headers.host}`);

            // Parse query params for filtering
            let trades = state.trades;
            const startDate = urlObj.searchParams.get('startDate');
            const endDate = urlObj.searchParams.get('endDate');
            const side = urlObj.searchParams.get('side') as 'LONG' | 'SHORT' | null;

            if (startDate || endDate) {
                trades = filterTradesByDateRange(
                    trades,
                    startDate ? new Date(startDate) : undefined,
                    endDate ? new Date(endDate) : undefined
                );
            }

            if (side) {
                trades = filterTradesBySide(trades, side);
            }

            const csv = tradesToCSV(trades);
            const filename = `trades_${new Date().toISOString().split('T')[0]}.csv`;

            res.writeHead(200, {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="${filename}"`
            });
            res.end(csv);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private handleExportJSON(req: http.IncomingMessage, res: http.ServerResponse): void {
        try {
            const state = this.getState();
            const urlObj = new URL(req.url || '', `http://${req.headers.host}`);

            // Parse query params for filtering
            let trades = state.trades;
            const startDate = urlObj.searchParams.get('startDate');
            const endDate = urlObj.searchParams.get('endDate');
            const side = urlObj.searchParams.get('side') as 'LONG' | 'SHORT' | null;

            if (startDate || endDate) {
                trades = filterTradesByDateRange(
                    trades,
                    startDate ? new Date(startDate) : undefined,
                    endDate ? new Date(endDate) : undefined
                );
            }

            if (side) {
                trades = filterTradesBySide(trades, side);
            }

            const data = tradesToJSON(trades);
            const filename = `trades_${new Date().toISOString().split('T')[0]}.json`;

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="${filename}"`
            });
            res.end(JSON.stringify(data, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private handleAnalyticsReport(req: http.IncomingMessage, res: http.ServerResponse): void {
        try {
            const state = this.getState();
            const config = this.getConfig();
            const urlObj = new URL(req.url || '', `http://${req.headers.host}`);

            // Parse query params
            let trades = state.trades;
            const startDate = urlObj.searchParams.get('startDate');
            const endDate = urlObj.searchParams.get('endDate');
            const period = urlObj.searchParams.get('period') || 'All Time';

            if (startDate || endDate) {
                trades = filterTradesByDateRange(
                    trades,
                    startDate ? new Date(startDate) : undefined,
                    endDate ? new Date(endDate) : undefined
                );
            }

            const initialEquity = this.currentCredentials?.paperBalance || config.paperBalance || 10000;
            const report = generatePerformanceReport(trades, initialEquity, period);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(report, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private handleDailyAnalytics(res: http.ServerResponse): void {
        try {
            const state = this.getState();
            const trades = state.trades;

            // Group trades by day
            const dailyMap = new Map<string, {
                date: string;
                trades: number;
                wins: number;
                losses: number;
                pnl: number;
                volume: number;
            }>();

            for (const trade of trades) {
                const tradeTime = trade.exitTime || Date.now();
                const date = new Date(tradeTime).toISOString().split('T')[0];
                const existing = dailyMap.get(date) || {
                    date,
                    trades: 0,
                    wins: 0,
                    losses: 0,
                    pnl: 0,
                    volume: 0
                };

                existing.trades++;
                existing.pnl += trade.pnl;
                existing.volume += (trade.size || 0) * trade.entryPrice;
                if (trade.pnl > 0) existing.wins++;
                else existing.losses++;

                dailyMap.set(date, existing);
            }

            const dailyStats = Array.from(dailyMap.values())
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(day => ({
                    ...day,
                    winRate: day.trades > 0 ? (day.wins / day.trades) * 100 : 0
                }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(dailyStats, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    private handleEquityCurve(res: http.ServerResponse): void {
        try {
            const state = this.getState();
            const config = this.getConfig();
            const initialEquity = this.currentCredentials?.paperBalance || config.paperBalance || 10000;

            const sortedTrades = [...state.trades].sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));

            let equity = initialEquity;
            let peak = initialEquity;

            const curve = [{ time: Date.now() - 86400000, equity: initialEquity, drawdown: 0 }];

            for (const trade of sortedTrades) {
                equity += trade.pnl;
                if (equity > peak) peak = equity;
                const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

                curve.push({
                    time: trade.exitTime || Date.now(),
                    equity,
                    drawdown
                });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                initialEquity,
                currentEquity: equity,
                peakEquity: peak,
                maxDrawdown: Math.max(...curve.map(c => c.drawdown)),
                curve
            }, null, 2));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: (error as Error).message }));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BACKTEST HANDLER
    // ─────────────────────────────────────────────────────────────────────────
    private async handleBacktest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.parseBody(req);
            const {
                days = 30,
                initialEquity = 10000,
                leverage = 3,
                supertrendPeriod = 10,
                supertrendMultiplier = 3,
                emaFastPeriod = 50,
                emaSlowPeriod = 200,
                adxThreshold = 20,
                maxPositionSize = 20,
                maxDailyLoss = 3,
                maxDailyTrades = 3,
                riskRewardRatio = 1.5,
                stopLossAtrMultiplier = 1.5
            } = body;

            // Validate inputs
            if (days < 7 || days > 365) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Days must be between 7 and 365' }));
                return;
            }

            this.logger.info(`Starting backtest: ${days} days, $${initialEquity} initial equity`);

            // Create backtest config
            const backtestConfig = {
                symbol: 'BTC',
                timeframe: '15m',
                leverage,
                supertrendPeriod,
                supertrendMultiplier,
                emaFastPeriod,
                emaSlowPeriod,
                adxPeriod: 14,
                adxThreshold,
                fundingThreshold: 0.0005,
                useFundingFilter: true,
                atrPeriod: 14,
                atrLookback: 100,
                minAtrPercentile: 20,
                maxAtrPercentile: 90,
                risk: {
                    maxPositionSize,
                    maxDailyLoss,
                    maxDailyTrades,
                    riskRewardRatio,
                    stopLossAtrMultiplier,
                    cooldownMinutes: 30
                }
            };

            // Generate sample data and run backtest
            const candles = generateSampleData(days);
            const backtester = new Backtester(backtestConfig);
            const results = backtester.run(candles, initialEquity);

            this.logger.success(`Backtest completed: ${results.totalTrades} trades, ${results.winRate.toFixed(1)}% win rate`);

            // Return results
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                config: {
                    days,
                    initialEquity,
                    leverage,
                    supertrendPeriod,
                    supertrendMultiplier,
                    adxThreshold,
                    riskRewardRatio
                },
                results: {
                    totalTrades: results.totalTrades,
                    winningTrades: results.winningTrades,
                    losingTrades: results.losingTrades,
                    winRate: results.winRate,
                    totalPnl: results.totalPnl,
                    totalPnlPercent: results.totalPnlPercent,
                    maxDrawdown: results.maxDrawdown,
                    maxDrawdownPercent: results.maxDrawdownPercent,
                    sharpeRatio: results.sharpeRatio,
                    profitFactor: results.profitFactor,
                    averageWin: results.averageWin,
                    averageLoss: results.averageLoss,
                    largestWin: results.largestWin,
                    largestLoss: results.largestLoss,
                    averageTradeDuration: results.averageTradeDuration,
                    finalEquity: initialEquity + results.totalPnl
                },
                trades: results.trades.slice(-20) // Last 20 trades for display
            }, null, 2));
        } catch (error) {
            this.logger.error('Backtest error', error as Error);
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
            connectedWallet: this.currentCredentials?.walletAddress || null,
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
    <title>Perp DEX Bot - Web3 Trading</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            background: #0a0a0f;
            color: #e4e4e7;
            min-height: 100vh;
        }

        /* Connect Wallet Screen */
        .connect-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.3s, visibility 0.3s;
        }
        .connect-overlay.hidden { opacity: 0; visibility: hidden; pointer-events: none; }

        .connect-container {
            text-align: center;
            max-width: 480px;
            padding: 20px;
        }
        .connect-logo {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, #00d4ff, #a855f7, #ec4899);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 12px;
        }
        .connect-subtitle {
            color: #71717a;
            font-size: 1rem;
            margin-bottom: 48px;
        }

        .wallet-options {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-bottom: 32px;
        }
        .wallet-btn {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px 24px;
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 12px;
            color: #e4e4e7;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .wallet-btn:hover {
            border-color: #a855f7;
            background: rgba(168,85,247,0.1);
            transform: translateY(-2px);
        }
        .wallet-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .wallet-icon {
            width: 40px;
            height: 40px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
        }
        .wallet-icon.metamask { background: linear-gradient(135deg, #f6851b, #e4761b); }
        .wallet-icon.phantom { background: linear-gradient(135deg, #ab9ff2, #9945ff); }
        .wallet-icon.walletconnect { background: linear-gradient(135deg, #3b99fc, #2d7dd2); }
        .wallet-info { text-align: left; flex: 1; }
        .wallet-name { font-weight: 600; }
        .wallet-chains { font-size: 0.8rem; color: #71717a; }

        .connect-footer {
            color: #52525b;
            font-size: 0.85rem;
        }
        .connect-footer a { color: #a855f7; text-decoration: none; }

        /* Setup Screen (after wallet connect) */
        .setup-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #0a0a0f;
            z-index: 999;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.3s, visibility 0.3s;
        }
        .setup-overlay.hidden { opacity: 0; visibility: hidden; pointer-events: none; }

        .setup-container { width: 100%; max-width: 600px; padding: 20px; }

        .profile-header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 32px;
            padding: 16px;
            background: #18181b;
            border-radius: 12px;
        }
        .profile-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
        }
        .profile-info { flex: 1; }
        .profile-address { font-weight: 600; font-size: 1.1rem; }
        .profile-wallet { font-size: 0.8rem; color: #71717a; }
        .disconnect-btn {
            padding: 8px 16px;
            background: transparent;
            border: 1px solid #ef4444;
            border-radius: 8px;
            color: #ef4444;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .disconnect-btn:hover { background: rgba(239,68,68,0.1); }

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

        .step-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 8px; }
        .step-desc { color: #71717a; font-size: 0.9rem; margin-bottom: 24px; }

        /* Exchange Cards */
        .exchange-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .exchange-card {
            background: #27272a;
            border: 2px solid transparent;
            border-radius: 12px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }
        .exchange-card:hover { border-color: #52525b; }
        .exchange-card.selected { border-color: #a855f7; background: rgba(168,85,247,0.1); }
        .exchange-card.disabled { opacity: 0.5; cursor: not-allowed; }
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
        .exchange-chain {
            position: absolute;
            top: 8px;
            right: 8px;
            font-size: 0.6rem;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(0,212,255,0.2);
            color: #00d4ff;
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
        .form-input, .form-select {
            width: 100%;
            padding: 12px 16px;
            background: #27272a;
            border: 1px solid #3f3f46;
            border-radius: 8px;
            color: #e4e4e7;
            font-size: 0.95rem;
            transition: border-color 0.2s;
        }
        .form-input:focus, .form-select:focus { outline: none; border-color: #a855f7; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-hint { font-size: 0.75rem; color: #71717a; margin-top: 6px; }

        /* Mode Toggle */
        .mode-toggle { display: flex; background: #27272a; border-radius: 8px; padding: 4px; }
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

        /* Info Box */
        .info-box {
            background: rgba(0,212,255,0.1);
            border: 1px solid rgba(0,212,255,0.3);
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
            font-size: 0.85rem;
            color: #7dd3fc;
        }

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

        .wallet-display {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: #27272a;
            border-radius: 20px;
            font-size: 0.85rem;
        }
        .wallet-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #22c55e;
        }

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

        .btn-sm { padding: 8px 16px; font-size: 0.85rem; border-radius: 6px; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-danger:hover { background: #dc2626; }
        .btn-outline { background: transparent; border: 1px solid #3f3f46; color: #a1a1aa; }
        .btn-outline:hover { background: #27272a; color: #e4e4e7; }

        .container { padding: 24px; max-width: 1600px; margin: 0 auto; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        @media (max-width: 1200px) { .grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } .exchange-grid { grid-template-columns: 1fr; } .form-row { grid-template-columns: 1fr; } }

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
        .side-badge { padding: 6px 16px; border-radius: 6px; font-weight: 700; font-size: 0.9rem; }
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

        .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
        .badge-long { background: rgba(34,197,94,0.2); color: #22c55e; }
        .badge-short { background: rgba(239,68,68,0.2); color: #ef4444; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .stat-item { background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; text-align: center; }
        .stat-label { font-size: 0.65rem; color: #71717a; text-transform: uppercase; }
        .stat-value { font-size: 1.1rem; font-weight: 600; margin-top: 4px; }

        .no-data { text-align: center; padding: 40px; color: #52525b; }
        .footer { text-align: center; padding: 16px; color: #52525b; font-size: 0.8rem; }

        .testnet-badge { background: rgba(234,179,8,0.2); color: #eab308; padding: 4px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; }

        /* Connecting state */
        .connecting { animation: connecting 1.5s infinite; }
        @keyframes connecting { 0%,100%{opacity:1} 50%{opacity:0.5} }

        /* Analytics Panel */
        .analytics-panel .analytics-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .export-buttons { display: flex; gap: 8px; }
        .analytics-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        @media (max-width: 900px) { .analytics-grid { grid-template-columns: 1fr; } }
        .analytics-section {
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
            padding: 16px;
        }
        .section-title {
            font-size: 0.75rem;
            text-transform: uppercase;
            color: #a855f7;
            font-weight: 600;
            margin-bottom: 12px;
            letter-spacing: 0.5px;
        }
        .metric-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .metric-row:last-child { border-bottom: none; }
        .metric-label { color: #71717a; font-size: 0.85rem; }
        .metric-value { font-weight: 600; font-size: 0.9rem; }

        /* Modal */
        .modal {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.3s, visibility 0.3s;
        }
        .modal.hidden { opacity: 0; visibility: hidden; pointer-events: none; }
        .modal-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
        }
        .modal-content {
            position: relative;
            background: #18181b;
            border-radius: 16px;
            width: 90%;
            max-width: 800px;
            max-height: 85vh;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 24px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .modal-header h2 { font-size: 1.25rem; font-weight: 600; }
        .modal-close {
            background: transparent;
            border: none;
            color: #71717a;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 4px 8px;
            line-height: 1;
        }
        .modal-close:hover { color: #e4e4e7; }
        .modal-body {
            padding: 24px;
            overflow-y: auto;
            max-height: calc(85vh - 80px);
        }
        .report-section {
            margin-bottom: 24px;
        }
        .report-section-title {
            font-size: 0.9rem;
            font-weight: 600;
            color: #a855f7;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(168,85,247,0.3);
        }
        .report-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }
        @media (max-width: 600px) { .report-grid { grid-template-columns: 1fr; } }
        .report-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            background: rgba(255,255,255,0.03);
            border-radius: 6px;
        }
        .report-item-label { color: #a1a1aa; font-size: 0.85rem; }
        .report-item-value { font-weight: 600; }

        /* Backtest Panel */
        .backtest-panel .form-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 12px;
        }
        @media (max-width: 900px) { .backtest-panel .form-row { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .backtest-panel .form-row { grid-template-columns: 1fr; } }
        .backtest-panel .form-group { margin-bottom: 0; }
        .backtest-panel .form-input {
            padding: 8px 12px;
            font-size: 0.9rem;
        }
        .backtest-summary {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
        }
        @media (max-width: 900px) { .backtest-summary { grid-template-columns: repeat(2, 1fr); } }
        .bt-stat {
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
        }
        .bt-label {
            display: block;
            font-size: 0.7rem;
            color: #71717a;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .bt-value {
            font-size: 1.1rem;
            font-weight: 600;
        }
        .bt-loading {
            text-align: center;
            padding: 20px;
            color: #71717a;
        }
    </style>
</head>
<body>
    <!-- Connect Wallet Screen -->
    <div id="connectOverlay" class="connect-overlay">
        <div class="connect-container">
            <div class="connect-logo">Perp DEX Bot</div>
            <div class="connect-subtitle">Connect your wallet to start trading</div>

            <div class="wallet-options">
                <button class="wallet-btn" id="connectMetamask" onclick="connectWallet('metamask')">
                    <div class="wallet-icon metamask">🦊</div>
                    <div class="wallet-info">
                        <div class="wallet-name">MetaMask</div>
                        <div class="wallet-chains">Nado (Ink) • GRVT (zkSync)</div>
                    </div>
                </button>

                <button class="wallet-btn" id="connectPhantom" onclick="connectWallet('phantom')">
                    <div class="wallet-icon phantom">👻</div>
                    <div class="wallet-info">
                        <div class="wallet-name">Phantom</div>
                        <div class="wallet-chains">Pacifica • StandX (Solana)</div>
                    </div>
                </button>

                <button class="wallet-btn" id="connectWalletConnect" onclick="connectWallet('walletconnect')" disabled>
                    <div class="wallet-icon walletconnect">🔗</div>
                    <div class="wallet-info">
                        <div class="wallet-name">WalletConnect</div>
                        <div class="wallet-chains">Coming soon</div>
                    </div>
                </button>
            </div>

            <div class="connect-footer">
                By connecting, you agree to our <a href="#">Terms of Service</a>
            </div>
        </div>
    </div>

    <!-- Setup Screen -->
    <div id="setupOverlay" class="setup-overlay hidden">
        <div class="setup-container">
            <div class="profile-header">
                <div class="profile-avatar" id="profileAvatar">🦊</div>
                <div class="profile-info">
                    <div class="profile-address" id="profileAddress">0x0000...0000</div>
                    <div class="profile-wallet" id="profileWallet">MetaMask</div>
                </div>
                <button class="disconnect-btn" onclick="disconnectWallet()">Disconnect</button>
            </div>

            <div class="setup-card">
                <div class="step-indicator">
                    <div class="step-dot active" data-step="1"></div>
                    <div class="step-dot" data-step="2"></div>
                </div>

                <!-- Step 1: Exchange Selection -->
                <div class="step-content active" data-step="1">
                    <div class="step-title">Select Exchange</div>
                    <div class="step-desc">Choose a DEX compatible with your wallet</div>

                    <div class="exchange-grid" id="exchangeGrid">
                        <!-- Dynamic based on wallet type -->
                    </div>

                    <div class="btn-row">
                        <button class="btn btn-primary" id="step1Next" disabled>Continue</button>
                    </div>
                </div>

                <!-- Step 2: Trading Config -->
                <div class="step-content" data-step="2">
                    <div class="step-title">Trading Configuration</div>
                    <div class="step-desc">Set your trading parameters</div>

                    <div class="form-group">
                        <label class="form-label">Trading Mode</label>
                        <div class="mode-toggle">
                            <button class="mode-btn active" data-mode="paper">Paper Trading</button>
                            <button class="mode-btn" data-mode="live">Live Trading</button>
                        </div>
                    </div>

                    <div id="paperConfig">
                        <div class="info-box">
                            Paper trading uses simulated funds. Perfect for testing strategies.
                        </div>
                        <div class="form-group">
                            <label class="form-label">Starting Balance (USD)</label>
                            <input type="number" class="form-input" id="paperBalance" value="10000" min="100">
                        </div>
                    </div>

                    <div id="liveConfig" style="display:none;">
                        <div class="warning-box">
                            <strong>Live Trading:</strong> Your connected wallet will be used to sign transactions. Make sure you have sufficient funds.
                        </div>
                        <div class="form-group">
                            <label class="form-label">Network</label>
                            <div class="mode-toggle">
                                <button class="mode-btn active" data-testnet="true">Testnet</button>
                                <button class="mode-btn" data-testnet="false">Mainnet</button>
                            </div>
                        </div>

                        <!-- API Key fields (shown for exchanges that require them) -->
                        <div id="apiKeyFields" style="display:none;">
                            <div class="form-group">
                                <label class="form-label">API Key <span id="apiKeyExchange"></span></label>
                                <input type="password" class="form-input" id="apiKey" placeholder="Enter your API key">
                                <div class="form-hint">Required for selected exchange. Get it from the exchange dashboard.</div>
                            </div>
                            <div id="subAccountField" class="form-group" style="display:none;">
                                <label class="form-label">Sub-Account ID (GRVT)</label>
                                <input type="text" class="form-input" id="subAccountId" placeholder="main or sub-account ID">
                            </div>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Trading Pair</label>
                            <select class="form-select" id="symbol">
                                <option value="BTC">BTC-PERP</option>
                                <option value="ETH">ETH-PERP</option>
                                <option value="SOL">SOL-PERP</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Timeframe</label>
                            <select class="form-select" id="timeframe">
                                <option value="5m">5 minutes</option>
                                <option value="15m" selected>15 minutes</option>
                                <option value="1h">1 hour</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Leverage</label>
                            <input type="number" class="form-input" id="leverage" value="3" min="1" max="50">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Max Position (%)</label>
                            <input type="number" class="form-input" id="positionSize" value="20" min="1" max="100">
                        </div>
                    </div>

                    <div class="btn-row">
                        <button class="btn btn-secondary" onclick="goToStep(1)">Back</button>
                        <button class="btn btn-primary" id="startBotBtn" onclick="startBot()">Start Bot</button>
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
                <div class="wallet-display">
                    <span class="wallet-dot"></span>
                    <span id="headerWallet">0x0000...0000</span>
                </div>
                <div id="statusBadge" class="status-badge status-stopped">
                    <span class="status-dot"></span>
                    <span id="statusText">Stopped</span>
                </div>
                <button class="btn btn-sm btn-danger" onclick="stopBot()">Stop Bot</button>
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
                    <div class="card-sub" id="totalPnl">Total: $0.00</div>
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
                    <div id="positionContent"><div class="no-data">No open position</div></div>
                </div>
                <div class="card">
                    <div class="card-title">Price Chart</div>
                    <div class="chart-container"><canvas id="priceChart"></canvas></div>
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
                    <div class="chart-container"><canvas id="equityChart"></canvas></div>
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

            <!-- Analytics Panel -->
            <div class="card analytics-panel" style="margin-bottom:24px;">
                <div class="analytics-header">
                    <div class="card-title">Analytics & Export</div>
                    <div class="export-buttons">
                        <button class="btn btn-sm btn-outline" onclick="exportCSV()">Export CSV</button>
                        <button class="btn btn-sm btn-outline" onclick="exportJSON()">Export JSON</button>
                        <button class="btn btn-sm btn-primary" onclick="showAnalyticsModal()">Full Report</button>
                    </div>
                </div>

                <div class="analytics-grid">
                    <div class="analytics-section">
                        <div class="section-title">Risk Metrics</div>
                        <div class="metric-row">
                            <span class="metric-label">Max Drawdown</span>
                            <span class="metric-value negative" id="analyticsMaxDD">0.00%</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Sharpe Ratio</span>
                            <span class="metric-value" id="analyticsSharpe">0.00</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Sortino Ratio</span>
                            <span class="metric-value" id="analyticsSortino">0.00</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Recovery Factor</span>
                            <span class="metric-value" id="analyticsRecovery">0.00</span>
                        </div>
                    </div>

                    <div class="analytics-section">
                        <div class="section-title">Trade Analysis</div>
                        <div class="metric-row">
                            <span class="metric-label">Expectancy</span>
                            <span class="metric-value" id="analyticsExpectancy">$0.00</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Avg Hold Time</span>
                            <span class="metric-value" id="analyticsHoldTime">0h</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Max Win Streak</span>
                            <span class="metric-value positive" id="analyticsWinStreak">0</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Max Loss Streak</span>
                            <span class="metric-value negative" id="analyticsLossStreak">0</span>
                        </div>
                    </div>

                    <div class="analytics-section">
                        <div class="section-title">Performance</div>
                        <div class="metric-row">
                            <span class="metric-label">ROI</span>
                            <span class="metric-value" id="analyticsROI">0.00%</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Peak Equity</span>
                            <span class="metric-value" id="analyticsPeakEquity">$0.00</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Calmar Ratio</span>
                            <span class="metric-value" id="analyticsCalmar">0.00</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Long/Short Ratio</span>
                            <span class="metric-value" id="analyticsLSRatio">-</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Daily Breakdown -->
            <div class="card" style="margin-bottom:24px;">
                <div class="card-title">Daily Performance</div>
                <div style="max-height:200px;overflow-y:auto;">
                    <table class="trades-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Trades</th>
                                <th>Wins</th>
                                <th>Losses</th>
                                <th>Win Rate</th>
                                <th>PnL</th>
                            </tr>
                        </thead>
                        <tbody id="dailyStatsBody">
                            <tr><td colspan="6" class="no-data">No daily data</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Backtest Panel -->
            <div class="card backtest-panel" style="margin-bottom:24px;">
                <div class="analytics-header">
                    <div class="card-title">Strategy Backtester</div>
                    <button class="btn btn-sm btn-primary" id="runBacktestBtn" onclick="runBacktest()">Run Backtest</button>
                </div>

                <div class="backtest-config">
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Days to Test</label>
                            <input type="number" class="form-input" id="btDays" value="30" min="7" max="365">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Initial Equity ($)</label>
                            <input type="number" class="form-input" id="btEquity" value="10000" min="100">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Leverage</label>
                            <input type="number" class="form-input" id="btLeverage" value="3" min="1" max="50">
                        </div>
                        <div class="form-group">
                            <label class="form-label">R:R Ratio</label>
                            <input type="number" class="form-input" id="btRR" value="1.5" min="0.5" max="5" step="0.1">
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Supertrend Period</label>
                            <input type="number" class="form-input" id="btStPeriod" value="10" min="5" max="30">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Supertrend Mult</label>
                            <input type="number" class="form-input" id="btStMult" value="3" min="1" max="5" step="0.5">
                        </div>
                        <div class="form-group">
                            <label class="form-label">ADX Threshold</label>
                            <input type="number" class="form-input" id="btAdx" value="20" min="10" max="40">
                        </div>
                        <div class="form-group">
                            <label class="form-label">SL ATR Mult</label>
                            <input type="number" class="form-input" id="btSlMult" value="1.5" min="0.5" max="3" step="0.1">
                        </div>
                    </div>
                </div>

                <!-- Backtest Results -->
                <div id="backtestResults" class="backtest-results" style="display:none;">
                    <div class="section-title" style="margin-top:20px;">Backtest Results</div>
                    <div class="backtest-summary">
                        <div class="bt-stat">
                            <span class="bt-label">Total PnL</span>
                            <span class="bt-value" id="btTotalPnl">$0.00</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">ROI</span>
                            <span class="bt-value" id="btROI">0.00%</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">Win Rate</span>
                            <span class="bt-value" id="btWinRate">0.00%</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">Trades</span>
                            <span class="bt-value" id="btTrades">0</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">Profit Factor</span>
                            <span class="bt-value" id="btPF">0.00</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">Max Drawdown</span>
                            <span class="bt-value negative" id="btMaxDD">0.00%</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">Sharpe Ratio</span>
                            <span class="bt-value" id="btSharpe">0.00</span>
                        </div>
                        <div class="bt-stat">
                            <span class="bt-label">Final Equity</span>
                            <span class="bt-value" id="btFinalEquity">$0.00</span>
                        </div>
                    </div>

                    <div class="section-title" style="margin-top:16px;">Sample Trades</div>
                    <div style="max-height:150px;overflow-y:auto;">
                        <table class="trades-table">
                            <thead>
                                <tr>
                                    <th>Side</th>
                                    <th>Entry</th>
                                    <th>Exit</th>
                                    <th>PnL</th>
                                    <th>Exit Reason</th>
                                </tr>
                            </thead>
                            <tbody id="btTradesBody">
                                <tr><td colspan="5" class="no-data">No backtest run yet</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
        <div class="footer">Auto-refresh every 3 seconds | <span id="lastUpdate">-</span></div>

        <!-- Analytics Modal -->
        <div id="analyticsModal" class="modal hidden">
            <div class="modal-overlay" onclick="hideAnalyticsModal()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Performance Report</h2>
                    <button class="modal-close" onclick="hideAnalyticsModal()">&times;</button>
                </div>
                <div class="modal-body" id="analyticsModalContent">
                    Loading...
                </div>
            </div>
        </div>
    </div>

    <script>
        // State
        let connectedWallet = null;
        let walletType = null;
        let walletChain = null;
        let selectedExchange = null;
        let tradingMode = 'paper';
        let isTestnet = true;
        let priceChart, equityChart;
        let equityHistory = [];

        // Exchange definitions
        const exchanges = {
            evm: [
                { id: 'NADO', name: 'Nado', desc: 'Kraken-backed CLOB on Ink L2', badge: 'Up to 20x', chain: 'Ink L2' },
                { id: 'GRVT', name: 'GRVT', desc: 'Hybrid DEX on zkSync', badge: 'Up to 50x', chain: 'zkSync' }
            ],
            solana: [
                { id: 'PACIFICA', name: 'Pacifica', desc: 'High-performance Solana DEX', badge: 'Up to 50x', chain: 'Solana' },
                { id: 'STANDX', name: 'StandX', desc: 'Solana/BNB with DUSD yield', badge: 'Up to 20x', chain: 'Solana' }
            ]
        };

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initModeToggle();
            initCharts();
            checkExistingConnection();
        });

        // Check if wallet was previously connected
        async function checkExistingConnection() {
            // Check MetaMask
            if (window.ethereum?.selectedAddress) {
                await connectWallet('metamask');
            }
            // Check Phantom
            else if (window.solana?.isConnected) {
                await connectWallet('phantom');
            }
            // Also check if bot is already running
            else {
                try {
                    const res = await fetch('/api/status');
                    const status = await res.json();
                    if (status.botRunning && status.connectedWallet) {
                        connectedWallet = status.connectedWallet;
                        showDashboard();
                    }
                } catch (e) {}
            }
        }

        // Connect wallet
        async function connectWallet(type) {
            const btn = document.getElementById('connect' + type.charAt(0).toUpperCase() + type.slice(1));
            if (btn) {
                btn.classList.add('connecting');
                btn.disabled = true;
            }

            try {
                let address, chain;

                if (type === 'metamask') {
                    if (!window.ethereum) {
                        alert('MetaMask not installed! Please install MetaMask extension.');
                        return;
                    }
                    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                    address = accounts[0];
                    chain = 'evm';
                    walletType = 'metamask';
                }
                else if (type === 'phantom') {
                    if (!window.solana?.isPhantom) {
                        alert('Phantom not installed! Please install Phantom extension.');
                        return;
                    }
                    const resp = await window.solana.connect();
                    address = resp.publicKey.toString();
                    chain = 'solana';
                    walletType = 'phantom';
                }

                // Save to backend
                const res = await fetch('/api/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: address, walletType: type, chain })
                });
                const data = await res.json();

                if (data.success) {
                    connectedWallet = address;
                    walletChain = chain;
                    showSetupScreen(data.profile);
                }
            } catch (error) {
                console.error('Connection error:', error);
                alert('Failed to connect wallet: ' + error.message);
            } finally {
                if (btn) {
                    btn.classList.remove('connecting');
                    btn.disabled = false;
                }
            }
        }

        function disconnectWallet() {
            connectedWallet = null;
            walletType = null;
            walletChain = null;
            selectedExchange = null;
            document.getElementById('connectOverlay').classList.remove('hidden');
            document.getElementById('setupOverlay').classList.add('hidden');
            document.getElementById('mainDashboard').style.display = 'none';
        }

        function showSetupScreen(profile) {
            document.getElementById('connectOverlay').classList.add('hidden');
            document.getElementById('setupOverlay').classList.remove('hidden');

            // Update profile header
            document.getElementById('profileAddress').textContent = profile.shortAddress;
            document.getElementById('profileWallet').textContent = walletType === 'metamask' ? 'MetaMask' : 'Phantom';
            document.getElementById('profileAvatar').textContent = walletType === 'metamask' ? '🦊' : '👻';

            // Render exchanges based on wallet chain
            renderExchanges();
            goToStep(1);
        }

        function renderExchanges() {
            const grid = document.getElementById('exchangeGrid');
            const availableExchanges = exchanges[walletChain] || [];

            grid.innerHTML = availableExchanges.map(ex => \`
                <div class="exchange-card" data-exchange="\${ex.id}" onclick="selectExchange('\${ex.id}')">
                    <div class="exchange-chain">\${ex.chain}</div>
                    <div class="exchange-name">\${ex.name}</div>
                    <div class="exchange-desc">\${ex.desc}</div>
                    <div class="exchange-badge">\${ex.badge}</div>
                </div>
            \`).join('');
        }

        function selectExchange(exchangeId) {
            document.querySelectorAll('.exchange-card').forEach(c => c.classList.remove('selected'));
            document.querySelector(\`.exchange-card[data-exchange="\${exchangeId}"]\`).classList.add('selected');
            selectedExchange = exchangeId;
            document.getElementById('step1Next').disabled = false;
            updateApiKeyFields();
        }

        // Show/hide API key fields based on exchange and mode
        function updateApiKeyFields() {
            const apiKeyFields = document.getElementById('apiKeyFields');
            const subAccountField = document.getElementById('subAccountField');
            const apiKeyExchange = document.getElementById('apiKeyExchange');

            // Exchanges that require API keys for live trading
            const requiresApiKey = ['GRVT', 'PACIFICA'].includes(selectedExchange);
            const requiresSubAccount = selectedExchange === 'GRVT';

            if (tradingMode === 'live' && requiresApiKey) {
                apiKeyFields.style.display = 'block';
                apiKeyExchange.textContent = '(' + selectedExchange + ')';
                subAccountField.style.display = requiresSubAccount ? 'block' : 'none';
            } else {
                apiKeyFields.style.display = 'none';
            }
        }

        document.getElementById('step1Next')?.addEventListener('click', () => goToStep(2));

        function goToStep(step) {
            document.querySelectorAll('.step-content').forEach(c => c.classList.remove('active'));
            document.querySelector(\`.step-content[data-step="\${step}"]\`).classList.add('active');
            document.querySelectorAll('.step-dot').forEach(d => {
                const dotStep = parseInt(d.dataset.step);
                d.classList.remove('active', 'completed');
                if (dotStep === step) d.classList.add('active');
                else if (dotStep < step) d.classList.add('completed');
            });
        }

        function initModeToggle() {
            document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    tradingMode = btn.dataset.mode;
                    document.getElementById('paperConfig').style.display = tradingMode === 'paper' ? 'block' : 'none';
                    document.getElementById('liveConfig').style.display = tradingMode === 'live' ? 'block' : 'none';
                    updateApiKeyFields();
                });
            });

            document.querySelectorAll('.mode-btn[data-testnet]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.mode-btn[data-testnet]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    isTestnet = btn.dataset.testnet === 'true';
                });
            });
        }

        async function startBot() {
            const credentials = {
                exchange: selectedExchange,
                mode: tradingMode,
                testnet: isTestnet,
                walletAddress: connectedWallet,
                walletType: walletType,
                symbol: document.getElementById('symbol').value,
                timeframe: document.getElementById('timeframe').value,
                leverage: parseInt(document.getElementById('leverage').value),
                paperBalance: parseInt(document.getElementById('paperBalance').value) || 10000,
                // API keys for exchanges that require them
                apiKey: document.getElementById('apiKey')?.value || undefined,
                subAccountId: document.getElementById('subAccountId')?.value || undefined
            };

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
                    showDashboard();
                } else {
                    alert('Failed to start: ' + data.message);
                }
            } catch (e) {
                alert('Error: ' + e.message);
            } finally {
                document.getElementById('startBotBtn').disabled = false;
                document.getElementById('startBotBtn').textContent = 'Start Bot';
            }
        }

        function showDashboard() {
            document.getElementById('connectOverlay').classList.add('hidden');
            document.getElementById('setupOverlay').classList.add('hidden');
            document.getElementById('mainDashboard').style.display = 'block';

            // Update header wallet display
            if (connectedWallet) {
                document.getElementById('headerWallet').textContent =
                    connectedWallet.slice(0, 6) + '...' + connectedWallet.slice(-4);
            }

            startDataFetching();
        }

        function showSetup() {
            document.getElementById('mainDashboard').style.display = 'none';
            document.getElementById('setupOverlay').classList.remove('hidden');
            goToStep(1);
        }

        async function stopBot() {
            if (!confirm('Stop the bot?')) return;
            try {
                const res = await fetch('/api/stop', { method: 'POST' });
                const data = await res.json();
                if (data.success) showSetup();
                else alert(data.message);
            } catch (e) { alert(e.message); }
        }

        function initCharts() {
            const priceCtx = document.getElementById('priceChart')?.getContext('2d');
            if (priceCtx) {
                priceChart = new Chart(priceCtx, {
                    type: 'line',
                    data: { labels: [], datasets: [{ data: [], borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', fill: true, tension: 0.4, pointRadius: 0 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#71717a' } } } }
                });
            }
            const equityCtx = document.getElementById('equityChart')?.getContext('2d');
            if (equityCtx) {
                equityChart = new Chart(equityCtx, {
                    type: 'line',
                    data: { labels: [], datasets: [{ data: [], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.4, pointRadius: 0 }] },
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
                    fetch('/api/status'), fetch('/api/trades'), fetch('/api/prices')
                ]);
                updateUI(await statusRes.json(), await tradesRes.json(), await pricesRes.json());
            } catch (e) {}
        }

        function updateUI(status, trades, prices) {
            document.getElementById('exchangeTag').textContent = status.exchange || 'PAPER';
            document.getElementById('testnetBadge').style.display = status.testnet ? 'inline-block' : 'none';

            const badge = document.getElementById('statusBadge');
            document.getElementById('statusText').textContent = status.botRunning ? 'Running' : 'Stopped';
            badge.className = 'status-badge ' + (status.botRunning ? 'status-running' : 'status-stopped');

            document.getElementById('currentPrice').textContent = '$' + (status.currentPrice || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('priceInfo').textContent = (status.symbol || 'BTC') + ' | ' + (status.timeframe || '15m');
            document.getElementById('equity').textContent = '$' + (status.equity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('totalPnl').innerHTML = 'Total: <span class="' + (status.totalPnl >= 0 ? 'positive' : 'negative') + '">' + (status.totalPnl >= 0 ? '+' : '') + '$' + (status.totalPnl || 0).toFixed(2) + '</span>';

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
                posContent.innerHTML = \`
                    <div class="position-header">
                        <span class="side-badge side-\${p.side.toLowerCase()}">\${p.side}</span>
                        <span class="position-pnl \${p.unrealizedPnl >= 0 ? 'positive' : 'negative'}">\${p.unrealizedPnl >= 0 ? '+' : ''}\$\${p.unrealizedPnl.toFixed(2)}</span>
                    </div>
                    <div class="position-grid">
                        <div><div class="position-label">Entry</div><div class="position-value">\$\${p.entryPrice.toLocaleString()}</div></div>
                        <div><div class="position-label">Size</div><div class="position-value">\${p.size.toFixed(4)}</div></div>
                        <div><div class="position-label">SL</div><div class="position-value negative">\$\${p.stopLoss.toLocaleString()}</div></div>
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
            document.getElementById('statPF').textContent = (s.profitFactor || 0).toFixed(2);
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

            // Trades
            const tbody = document.getElementById('tradesBody');
            if (!trades || trades.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="no-data">No trades yet</td></tr>';
            } else {
                tbody.innerHTML = trades.slice(0, 10).map(t => \`
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

            // Also fetch analytics and daily stats
            fetchAnalytics();
            fetchDailyStats();
        }

        // Export functions
        function exportCSV() {
            window.location.href = '/api/export/csv';
        }

        function exportJSON() {
            window.location.href = '/api/export/json';
        }

        // Analytics functions
        async function fetchAnalytics() {
            try {
                const res = await fetch('/api/analytics/report');
                const report = await res.json();
                updateAnalyticsPanel(report);
            } catch (e) {
                console.error('Failed to fetch analytics:', e);
            }
        }

        function updateAnalyticsPanel(report) {
            if (!report || !report.metrics) return;
            const m = report.metrics;

            // Risk Metrics
            document.getElementById('analyticsMaxDD').textContent = (m.maxDrawdownPercent || 0).toFixed(2) + '%';
            document.getElementById('analyticsSharpe').textContent = (m.sharpeRatio || 0).toFixed(2);
            document.getElementById('analyticsSortino').textContent = (m.sortinoRatio || 0).toFixed(2);
            document.getElementById('analyticsRecovery').textContent = (m.recoveryFactor || 0).toFixed(2);

            // Trade Analysis
            document.getElementById('analyticsExpectancy').textContent = '$' + (m.expectancy || 0).toFixed(2);
            const holdHours = ((m.avgHoldTime || 0) / (1000 * 60 * 60)).toFixed(1);
            document.getElementById('analyticsHoldTime').textContent = holdHours + 'h';
            document.getElementById('analyticsWinStreak').textContent = m.maxConsecutiveWins || 0;
            document.getElementById('analyticsLossStreak').textContent = m.maxConsecutiveLosses || 0;

            // Performance
            const roi = document.getElementById('analyticsROI');
            roi.textContent = (m.returnOnInvestment || 0).toFixed(2) + '%';
            roi.className = 'metric-value ' + ((m.returnOnInvestment || 0) >= 0 ? 'positive' : 'negative');

            document.getElementById('analyticsPeakEquity').textContent = '$' + (m.peakEquity || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
            document.getElementById('analyticsCalmar').textContent = (m.calmarRatio || 0).toFixed(2);

            // Long/Short ratio
            const longTrades = report.summary?.longTrades || 0;
            const shortTrades = report.summary?.shortTrades || 0;
            if (longTrades + shortTrades > 0) {
                document.getElementById('analyticsLSRatio').textContent = longTrades + '/' + shortTrades;
            }
        }

        async function fetchDailyStats() {
            try {
                const res = await fetch('/api/analytics/daily');
                const stats = await res.json();
                updateDailyTable(stats);
            } catch (e) {
                console.error('Failed to fetch daily stats:', e);
            }
        }

        function updateDailyTable(stats) {
            const tbody = document.getElementById('dailyStatsBody');
            if (!stats || stats.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="no-data">No daily data</td></tr>';
                return;
            }

            tbody.innerHTML = stats.slice(-10).reverse().map(day => \`
                <tr>
                    <td>\${day.date}</td>
                    <td>\${day.trades}</td>
                    <td class="positive">\${day.wins}</td>
                    <td class="negative">\${day.losses}</td>
                    <td>\${day.winRate.toFixed(1)}%</td>
                    <td class="\${day.pnl >= 0 ? 'positive' : 'negative'}">\${day.pnl >= 0 ? '+' : ''}\$\${day.pnl.toFixed(2)}</td>
                </tr>
            \`).join('');
        }

        // Modal functions
        function showAnalyticsModal() {
            document.getElementById('analyticsModal').classList.remove('hidden');
            loadFullReport();
        }

        function hideAnalyticsModal() {
            document.getElementById('analyticsModal').classList.add('hidden');
        }

        async function loadFullReport() {
            const content = document.getElementById('analyticsModalContent');
            content.innerHTML = '<div class="no-data">Loading report...</div>';

            try {
                const res = await fetch('/api/analytics/report');
                const report = await res.json();
                renderFullReport(report);
            } catch (e) {
                content.innerHTML = '<div class="no-data">Failed to load report</div>';
            }
        }

        function renderFullReport(report) {
            if (!report) return;
            const m = report.metrics || {};
            const s = report.summary || {};

            const content = document.getElementById('analyticsModalContent');
            content.innerHTML = \`
                <div class="report-section">
                    <div class="report-section-title">Summary</div>
                    <div class="report-grid">
                        <div class="report-item">
                            <span class="report-item-label">Period</span>
                            <span class="report-item-value">\${report.period || 'All Time'}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Generated</span>
                            <span class="report-item-value">\${new Date(report.generatedAt).toLocaleString()}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Initial Equity</span>
                            <span class="report-item-value">$\${(s.initialEquity || 0).toLocaleString()}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Final Equity</span>
                            <span class="report-item-value">$\${(m.finalEquity || 0).toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">Trade Statistics</div>
                    <div class="report-grid">
                        <div class="report-item">
                            <span class="report-item-label">Total Trades</span>
                            <span class="report-item-value">\${m.totalTrades || 0}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Win Rate</span>
                            <span class="report-item-value">\${(m.winRate || 0).toFixed(1)}%</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Winning Trades</span>
                            <span class="report-item-value positive">\${m.winningTrades || 0}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Losing Trades</span>
                            <span class="report-item-value negative">\${m.losingTrades || 0}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Long Trades</span>
                            <span class="report-item-value">\${s.longTrades || 0}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Short Trades</span>
                            <span class="report-item-value">\${s.shortTrades || 0}</span>
                        </div>
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">PnL Analysis</div>
                    <div class="report-grid">
                        <div class="report-item">
                            <span class="report-item-label">Total PnL</span>
                            <span class="report-item-value \${(m.totalPnl || 0) >= 0 ? 'positive' : 'negative'}">\${(m.totalPnl || 0) >= 0 ? '+' : ''}$\${(m.totalPnl || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">ROI</span>
                            <span class="report-item-value \${(m.returnOnInvestment || 0) >= 0 ? 'positive' : 'negative'}">\${(m.returnOnInvestment || 0).toFixed(2)}%</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Average Win</span>
                            <span class="report-item-value positive">+$\${(m.avgWin || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Average Loss</span>
                            <span class="report-item-value negative">-$\${(m.avgLoss || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Largest Win</span>
                            <span class="report-item-value positive">+$\${(m.largestWin || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Largest Loss</span>
                            <span class="report-item-value negative">-$\${Math.abs(m.largestLoss || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Profit Factor</span>
                            <span class="report-item-value">\${m.profitFactor === Infinity ? '∞' : (m.profitFactor || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Expectancy</span>
                            <span class="report-item-value">$\${(m.expectancy || 0).toFixed(2)}/trade</span>
                        </div>
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">Risk Metrics</div>
                    <div class="report-grid">
                        <div class="report-item">
                            <span class="report-item-label">Max Drawdown</span>
                            <span class="report-item-value negative">$\${(m.maxDrawdown || 0).toFixed(2)} (\${(m.maxDrawdownPercent || 0).toFixed(2)}%)</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Peak Equity</span>
                            <span class="report-item-value">$\${(m.peakEquity || 0).toLocaleString()}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Sharpe Ratio</span>
                            <span class="report-item-value">\${(m.sharpeRatio || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Sortino Ratio</span>
                            <span class="report-item-value">\${(m.sortinoRatio || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Calmar Ratio</span>
                            <span class="report-item-value">\${(m.calmarRatio || 0).toFixed(2)}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Recovery Factor</span>
                            <span class="report-item-value">\${(m.recoveryFactor || 0).toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">Trade Characteristics</div>
                    <div class="report-grid">
                        <div class="report-item">
                            <span class="report-item-label">Avg Hold Time</span>
                            <span class="report-item-value">\${(m.avgTradeDuration || 0).toFixed(1)} hours</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Max Win Streak</span>
                            <span class="report-item-value positive">\${m.maxConsecutiveWins || 0}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Max Loss Streak</span>
                            <span class="report-item-value negative">\${m.maxConsecutiveLosses || 0}</span>
                        </div>
                        <div class="report-item">
                            <span class="report-item-label">Avg Trade PnL</span>
                            <span class="report-item-value">$\${((m.totalPnl || 0) / (m.totalTrades || 1)).toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            \`;
        }

        // Close modal on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideAnalyticsModal();
        });

        // Backtest functions
        async function runBacktest() {
            const btn = document.getElementById('runBacktestBtn');
            const resultsDiv = document.getElementById('backtestResults');

            btn.disabled = true;
            btn.textContent = 'Running...';
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = '<div class="bt-loading">Running backtest... This may take a moment.</div>';

            const config = {
                days: parseInt(document.getElementById('btDays').value) || 30,
                initialEquity: parseInt(document.getElementById('btEquity').value) || 10000,
                leverage: parseInt(document.getElementById('btLeverage').value) || 3,
                riskRewardRatio: parseFloat(document.getElementById('btRR').value) || 1.5,
                supertrendPeriod: parseInt(document.getElementById('btStPeriod').value) || 10,
                supertrendMultiplier: parseFloat(document.getElementById('btStMult').value) || 3,
                adxThreshold: parseInt(document.getElementById('btAdx').value) || 20,
                stopLossAtrMultiplier: parseFloat(document.getElementById('btSlMult').value) || 1.5
            };

            try {
                const res = await fetch('/api/backtest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                const data = await res.json();

                if (data.success) {
                    displayBacktestResults(data.results, data.trades);
                } else {
                    resultsDiv.innerHTML = '<div class="bt-loading">Error: ' + data.message + '</div>';
                }
            } catch (e) {
                resultsDiv.innerHTML = '<div class="bt-loading">Error: ' + e.message + '</div>';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Run Backtest';
            }
        }

        function displayBacktestResults(results, trades) {
            const resultsDiv = document.getElementById('backtestResults');
            resultsDiv.style.display = 'block';

            // Update summary stats
            const pnlEl = document.getElementById('btTotalPnl');
            pnlEl.textContent = (results.totalPnl >= 0 ? '+' : '') + '$' + results.totalPnl.toFixed(2);
            pnlEl.className = 'bt-value ' + (results.totalPnl >= 0 ? 'positive' : 'negative');

            const roiEl = document.getElementById('btROI');
            roiEl.textContent = (results.totalPnlPercent >= 0 ? '+' : '') + results.totalPnlPercent.toFixed(2) + '%';
            roiEl.className = 'bt-value ' + (results.totalPnlPercent >= 0 ? 'positive' : 'negative');

            document.getElementById('btWinRate').textContent = results.winRate.toFixed(1) + '%';
            document.getElementById('btTrades').textContent = results.totalTrades;
            document.getElementById('btPF').textContent = results.profitFactor === Infinity ? '∞' : results.profitFactor.toFixed(2);
            document.getElementById('btMaxDD').textContent = results.maxDrawdownPercent.toFixed(2) + '%';
            document.getElementById('btSharpe').textContent = results.sharpeRatio.toFixed(2);
            document.getElementById('btFinalEquity').textContent = '$' + results.finalEquity.toLocaleString();

            // Update trades table
            const tbody = document.getElementById('btTradesBody');
            if (!trades || trades.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="no-data">No trades in backtest</td></tr>';
            } else {
                tbody.innerHTML = trades.slice(-10).map(t => \`
                    <tr>
                        <td><span class="badge badge-\${t.side.toLowerCase()}">\${t.side}</span></td>
                        <td>$\${t.entryPrice.toFixed(2)}</td>
                        <td>$\${t.exitPrice.toFixed(2)}</td>
                        <td class="\${t.pnl >= 0 ? 'positive' : 'negative'}">\${t.pnl >= 0 ? '+' : ''}$\${t.pnl.toFixed(2)}</td>
                        <td>\${t.exitReason}</td>
                    </tr>
                \`).join('');
            }
        }
    </script>
</body>
</html>`;
    }
}
