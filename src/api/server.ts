// ═══════════════════════════════════════════════════════════════════════════
// API SERVER
// REST API and WebSocket server for dashboard integration
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { ExtendedConnector } from '../exchanges/extended';
import { ExchangeFactory, ExchangePlatform } from '../exchanges';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(cors());
app.use(express.json());

// Extended connector instance
let connector: ExtendedConnector | null = null;
let isConnected = false;

// WebSocket clients
const wsClients = new Set<WebSocket>();

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZE EXTENDED CONNECTOR
// ═══════════════════════════════════════════════════════════════════════════

async function initializeConnector() {
    try {
        console.log('🔌 Initializing Extended connector...');

        connector = ExchangeFactory.create(
            ExchangePlatform.EXTENDED,
            {
                apiUrl: 'https://starknet-sepolia.public.blastapi.io',
                testnet: process.env.USE_TESTNET === 'true',
            }
        ) as ExtendedConnector;

        await connector.connect();
        isConnected = true;

        console.log('✅ Extended connector initialized');

        // Start broadcasting updates
        startBroadcasting();
    } catch (error) {
        console.error('❌ Failed to initialize connector:', error);
        isConnected = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET BROADCASTING
// ═══════════════════════════════════════════════════════════════════════════

function startBroadcasting() {
    // Broadcast updates every 5 seconds
    setInterval(async () => {
        if (!connector || !isConnected || wsClients.size === 0) {
            return;
        }

        try {
            // Fetch latest data
            const [balance, positions, stats] = await Promise.all([
                connector.getBalance(),
                connector.getPositions(),
                connector.getStats(),
            ]);

            // Broadcast to all connected clients
            const update = {
                type: 'update',
                timestamp: Date.now(),
                data: {
                    balance,
                    positions,
                    stats,
                },
            };

            broadcast(update);
        } catch (error) {
            console.error('❌ Error fetching data:', error);
        }
    }, 5000); // 5 seconds
}

function broadcast(data: any) {
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
    if (connector && isConnected) {
        Promise.all([
            connector.getBalance(),
            connector.getPositions(),
            connector.getStats(),
        ]).then(([balance, positions, stats]) => {
            ws.send(
                JSON.stringify({
                    type: 'init',
                    timestamp: Date.now(),
                    data: {
                        balance,
                        positions,
                        stats,
                        connected: isConnected,
                    },
                })
            );
        }).catch((error) => {
            console.error('❌ Error sending initial state:', error);
        });
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: isConnected,
        timestamp: Date.now(),
    });
});

// Get balance
app.get('/api/balance', async (req, res) => {
    try {
        if (!connector || !isConnected) {
            return res.status(503).json({ error: 'Connector not initialized' });
        }

        const balance = await connector.getBalance();
        return res.json({ success: true, data: balance });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// Get positions
app.get('/api/positions', async (req, res) => {
    try {
        if (!connector || !isConnected) {
            return res.status(503).json({ error: 'Connector not initialized' });
        }

        const positions = await connector.getPositions();
        return res.json({ success: true, data: positions });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// Get stats
app.get('/api/stats', async (req, res) => {
    try {
        if (!connector || !isConnected) {
            return res.status(503).json({ error: 'Connector not initialized' });
        }

        const stats = await connector.getStats();
        return res.json({ success: true, data: stats });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// Get market data
app.get('/api/market/:symbol', async (req, res) => {
    try {
        if (!connector || !isConnected) {
            return res.status(503).json({ error: 'Connector not initialized' });
        }

        const { symbol } = req.params;
        const marketData = await connector.getMarketData(symbol);
        return res.json({ success: true, data: marketData });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

const PORT = process.env.API_PORT || 3000;

server.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    PERP DEX BOT API SERVER                            ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
    console.log('');

    // Initialize connector
    initializeConnector();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');

    if (connector) {
        await connector.disconnect();
    }

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
