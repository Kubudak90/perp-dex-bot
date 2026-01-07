# Dashboard Integration

## Architecture

The bot now includes a dedicated **Bot Stats Server** that serves real-time trading data to the dashboard via WebSocket.

```
┌──────────────┐         ┌─────────────────┐         ┌──────────────┐
│              │         │   Bot Stats     │         │              │
│   Bot Core   ├────────►│    Server       ├────────►│  Dashboard   │
│   (index.ts) │  State  │  (Port 3001)    │   WS   │  (Next.js)   │
│              │         │                 │         │              │
└──────────────┘         └─────────────────┘         └──────────────┘
```

## How It Works

### 1. Bot State Broadcasting

Every tick (15m), the bot:
- Executes trading logic
- Updates internal state
- Broadcasts state to Bot Stats Server

```typescript
// src/bot.ts
async tick(): Promise<void> {
    // ... trading logic ...

    // Broadcast state to dashboard
    updateBotState(this.state);
}
```

### 2. Bot Stats Server

Dedicated server (`src/api/bot-stats-server.ts`) that:
- Receives bot state updates
- Calculates real-time statistics
- Broadcasts to dashboard via WebSocket
- Serves REST API endpoints

**Port**: 3001 (configurable via `BOT_STATS_PORT`)

**WebSocket Endpoint**: `ws://localhost:3001/ws`

**Stats Calculated**:
- `totalTrades`: Total number of trades
- `winningTrades` / `losingTrades`: Win/loss breakdown
- `winRate`: Win rate percentage
- `totalPnl`: Total profit/loss
- `totalVolume`: Trading volume
- `averageWin` / `averageLoss`: Average gains/losses
- `largestWin` / `largestLoss`: Best/worst trades

### 3. Dashboard Connection

Dashboard (`dashboard/`) connects to Bot Stats Server:
- Real-time WebSocket connection
- Auto-reconnect on disconnect
- Displays live bot performance

**Environment Variable**: `NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws`

## No Mock Data! ✅

All data is real:
- ✅ Frontend uses `useExtendedData` hook (WebSocket)
- ✅ Backend serves bot's actual trading state
- ✅ Stats calculated from real trade history
- ❌ No mock data anywhere in the codebase

## Running the System

### Start Bot (with integrated stats server)

```bash
# Paper trading mode (recommended for testing)
MODE=paper npm run dev

# Live mode (requires API keys)
MODE=live EXCHANGE=extended npm run dev
```

The bot automatically starts the Bot Stats Server on port 3001.

### Start Dashboard

```bash
cd dashboard
npm run dev
```

Dashboard runs on port 3000 and connects to Bot Stats Server on port 3001.

### Full System

Terminal 1:
```bash
MODE=paper npm run dev  # Bot + Stats Server
```

Terminal 2:
```bash
cd dashboard && npm run dev  # Dashboard
```

Open: http://localhost:3000

## API Endpoints

The Bot Stats Server provides REST endpoints:

### GET /api/health
Health check and bot status
```json
{
  "status": "ok",
  "botActive": true,
  "timestamp": 1704067200000
}
```

### GET /api/stats
Current bot statistics
```json
{
  "success": true,
  "data": {
    "totalTrades": 42,
    "winningTrades": 28,
    "losingTrades": 14,
    "winRate": 66.67,
    "totalPnl": 1234.56,
    "totalVolume": 50000,
    "averageWin": 120.5,
    "averageLoss": 45.2,
    "largestWin": 500,
    "largestLoss": 150
  }
}
```

### GET /api/trades
Trade history
```json
{
  "success": true,
  "data": [
    {
      "side": "LONG",
      "entryPrice": 42000,
      "exitPrice": 42500,
      "pnl": 250,
      "pnlPercent": 1.19,
      "duration": 3600000,
      "exitReason": "TP"
    }
  ]
}
```

## WebSocket Protocol

### Initial Connection
When dashboard connects, it receives `init` message:
```json
{
  "type": "init",
  "timestamp": 1704067200000,
  "data": {
    "balance": { "total": 10000, "available": 9500, "margin": 500 },
    "positions": [...],
    "stats": {...}
  }
}
```

### Real-time Updates
Bot sends `update` messages every tick:
```json
{
  "type": "update",
  "timestamp": 1704067200000,
  "data": {
    "balance": {...},
    "positions": [...],
    "stats": {...}
  }
}
```

## Troubleshooting

### Dashboard shows "Disconnected"

1. Check Bot Stats Server is running (should start with bot)
2. Verify port 3001 is not in use: `lsof -i :3001`
3. Check `.env.local` in dashboard: `NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws`
4. Check bot logs for "BOT STATS SERVER" startup message

### No trade data showing

- Bot must execute trades first (wait for signals)
- Check bot is in correct mode (`MODE=paper` or `MODE=live`)
- Verify bot has market data access
- Check bot logs for trade execution messages

### Stats not updating

- Bot broadcasts state every tick (15m by default)
- Wait for next candle close
- Check WebSocket connection in browser console
- Verify bot is actually running (not crashed)

## Development Notes

### Adding New Stats

To add new statistics:

1. Calculate in `src/api/bot-stats-server.ts` → `calculateStats()`
2. Update dashboard interface in `dashboard/lib/hooks/useExtendedData.ts`
3. Display in `dashboard/app/page.tsx`

### Changing Update Frequency

Bot updates on each tick (determined by `timeframe` config):
- 15m timeframe = updates every 15 minutes
- 5m timeframe = updates every 5 minutes

To update more frequently, modify bot's tick interval.

## Security Considerations

- Bot Stats Server binds to localhost by default
- No authentication required (local only)
- For production deployment, add:
  - Authentication (API keys)
  - HTTPS/WSS
  - Rate limiting
  - Input validation

## Performance

- Minimal overhead (<1ms per update)
- WebSocket connections are lightweight
- Stats calculated on-demand
- No database required (in-memory state)

## Future Enhancements

Potential improvements:
- [ ] Persistent trade history (database)
- [ ] Multiple bot instances support
- [ ] Historical performance charts
- [ ] Trade notifications
- [ ] Strategy parameter tuning UI
- [ ] Backtest result comparison
