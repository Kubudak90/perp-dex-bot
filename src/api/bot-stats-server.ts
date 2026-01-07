// ═══════════════════════════════════════════════════════════════════════════
// BOT STATS SERVER
// Serves bot statistics and trade history for dashboard
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { BotState, TradeResult } from '../types';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(cors());
app.use(express.json());

// Shared bot state (will be updated by bot)
let botState: BotState | null = null;
const wsClients = new Set<WebSocket>();

// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export function updateBotState(state: BotState): void {
    botState = state;
    broadcastUpdate();
}

function broadcastUpdate(): void {
    if (!botState || wsClients.size === 0) return;

    const stats = calculateStats(botState.trades);

    const update = {
        type: 'update',
        timestamp: Date.now(),
        data: {
            balance: {
                total: botState.equity,
                available: botState.position ? botState.equity - (botState.position.size * botState.position.entryPrice / 3) : botState.equity,
                margin: botState.position ? botState.position.size * botState.position.entryPrice / 3 : 0,
            },
            positions: botState.position ? [{
                symbol: 'BTC-USD',
                side: botState.position.side,
                size: botState.position.size,
                entryPrice: botState.position.entryPrice,
                markPrice: botState.position.entryPrice, // Would be updated in real-time
                unrealizedPnl: botState.position.unrealizedPnl || 0,
                realizedPnl: botState.dailyPnl,
                leverage: 3,
                liquidationPrice: botState.position.liquidationPrice || 0,
            }] : [],
            stats,
        },
    };

    broadcast(update);
}

function calculateStats(trades: TradeResult[]) {
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalVolume = trades.reduce((sum, t) => sum + Math.abs(t.entryPrice * (t.exitPrice / t.entryPrice - 1)), 0);

    const averageWin = winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
        : 0;

    const averageLoss = losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
        : 0;

    const largestWin = winningTrades.length > 0
        ? Math.max(...winningTrades.map(t => t.pnl))
        : 0;

    const largestLoss = losingTrades.length > 0
        ? Math.abs(Math.min(...losingTrades.map(t => t.pnl)))
        : 0;

    return {
        totalTrades: trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
        totalPnl,
        totalVolume,
        averageWin,
        averageLoss,
        largestWin,
        largestLoss,
    };
}

function broadcast(data: any): void {
    const message = JSON.stringify(data);
    wsClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET HANDLER
// ═══════════════════════════════════════════════════════════════════════════

wss.on('connection', (ws) => {
    console.log('📡 Dashboard connected via WebSocket');
    wsClients.add(ws);

    // Send initial state
    if (botState) {
        const stats = calculateStats(botState.trades);
        ws.send(JSON.stringify({
            type: 'init',
            timestamp: Date.now(),
            data: {
                balance: {
                    total: botState.equity,
                    available: botState.position ? botState.equity - (botState.position.size * botState.position.entryPrice / 3) : botState.equity,
                    margin: botState.position ? botState.position.size * botState.position.entryPrice / 3 : 0,
                },
                positions: botState.position ? [{
                    symbol: 'BTC-USD',
                    side: botState.position.side,
                    size: botState.position.size,
                    entryPrice: botState.position.entryPrice,
                    markPrice: botState.position.entryPrice,
                    unrealizedPnl: botState.position.unrealizedPnl || 0,
                    realizedPnl: botState.dailyPnl,
                    leverage: 3,
                    liquidationPrice: botState.position.liquidationPrice || 0,
                }] : [],
                stats,
            },
        }));
    }

    ws.on('close', () => {
        console.log('📡 Dashboard disconnected');
        wsClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        wsClients.delete(ws);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// REST API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        botActive: botState?.isActive || false,
        timestamp: Date.now(),
    });
});

app.get('/api/stats', (req, res) => {
    if (!botState) {
        return res.status(503).json({ error: 'Bot not running' });
    }

    const stats = calculateStats(botState.trades);
    return res.json({ success: true, data: stats });
});

app.get('/api/trades', (req, res) => {
    if (!botState) {
        return res.status(503).json({ error: 'Bot not running' });
    }

    return res.json({ success: true, data: botState.trades });
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

const PORT = process.env.BOT_STATS_PORT || 3001;

export function startBotStatsServer(): void {
    server.listen(PORT, () => {
        console.log('╔═══════════════════════════════════════════════════════════════════════╗');
        console.log('║                   BOT STATS SERVER                                    ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════╝');
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
        console.log('');
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot stats server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
