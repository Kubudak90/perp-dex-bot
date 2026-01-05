# PERP DEX BOT - REFACTORING PLAN
## SaaS Product Transformation

### PHASE 1: CORE ARCHITECTURE (2-3 weeks)

#### 1.1 Exchange Abstraction Layer

**File: `packages/exchanges/src/base/types.ts`**
```typescript
export interface ExchangeMetadata {
  name: string;
  displayName: string;
  chainId: number;
  contractAddresses: {
    clearingHouse: string;
    vault: string;
    oracle?: string;
  };
  fees: {
    maker: number;
    taker: number;
  };
  limits: {
    minPositionSize: number;
    maxPositionSize: number;
    maxLeverage: number;
  };
  features: {
    hasStopLoss: boolean;
    hasTakeProfit: boolean;
    hasTrailingStop: boolean;
    supportedOrderTypes: OrderType[];
  };
}

export interface IExchange {
  // Metadata
  getMetadata(): ExchangeMetadata;

  // Connection
  connect(config: ExchangeConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Market Data
  getCandles(params: CandleParams): Promise<Candle[]>;
  getOrderBook(symbol: string): Promise<OrderBook>;
  getFundingRate(symbol: string): Promise<number>;
  getMarkPrice(symbol: string): Promise<number>;
  getIndexPrice(symbol: string): Promise<number>;

  // Account
  getBalance(): Promise<Balance>;
  getPosition(symbol: string): Promise<Position | null>;
  getPositions(): Promise<Position[]>;
  getOpenOrders(symbol?: string): Promise<Order[]>;

  // Trading
  placeOrder(params: OrderParams): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  modifyOrder(orderId: string, params: Partial<OrderParams>): Promise<void>;

  // Risk Management
  setStopLoss(params: StopLossParams): Promise<string>;
  setTakeProfit(params: TakeProfitParams): Promise<string>;
  setTrailingStop(params: TrailingStopParams): Promise<string>;

  // Events (for real-time updates)
  on(event: ExchangeEvent, handler: EventHandler): void;
  off(event: ExchangeEvent, handler: EventHandler): void;
}
```

#### 1.2 Unified Order Management

**File: `packages/core/src/order/manager.ts`**
```typescript
export class OrderManager {
  private exchange: IExchange;
  private pendingOrders: Map<string, Order> = new Map();
  private orderHistory: OrderHistory;

  async placeSmartOrder(params: SmartOrderParams): Promise<OrderResult> {
    // Pre-flight checks
    await this.validateOrder(params);

    // Calculate optimal order parameters
    const optimized = await this.optimizeOrder(params);

    // Place order with retry logic
    const result = await this.executeWithRetry(async () => {
      return await this.exchange.placeOrder(optimized);
    });

    // Track order
    this.trackOrder(result.orderId);

    // Emit event
    this.emit('orderPlaced', result);

    return result;
  }

  private async optimizeOrder(params: SmartOrderParams): Promise<OrderParams> {
    // Gas optimization for L2s
    const gasPrice = await this.getOptimalGasPrice();

    // Slippage protection
    const slippageProtected = this.addSlippageProtection(params);

    // MEV protection (if applicable)
    const mevProtected = await this.addMevProtection(slippageProtected);

    return mevProtected;
  }
}
```

#### 1.3 Strategy Engine Refactor

**File: `packages/core/src/strategies/engine.ts`**
```typescript
export abstract class BaseStrategy {
  abstract name: string;
  abstract description: string;
  abstract parameters: StrategyParameter[];

  // Strategy lifecycle
  abstract onInit(config: StrategyConfig): Promise<void>;
  abstract onCandle(candle: Candle, context: TradingContext): Promise<Signal>;
  abstract onPosition(position: Position, context: TradingContext): Promise<Signal>;
  abstract onStop(): Promise<void>;

  // Risk management hooks
  protected async calculatePositionSize(context: TradingContext): Promise<number> {
    return this.riskManager.calculateSize(context);
  }

  protected async calculateStopLoss(
    entry: number,
    side: 'LONG' | 'SHORT',
    context: TradingContext
  ): Promise<number> {
    // Override in subclass for custom SL logic
    return this.riskManager.calculateStopLoss(entry, side, context);
  }
}

// Example: Your current strategy
export class SupertrendEmaAdxStrategy extends BaseStrategy {
  name = 'Supertrend + EMA + ADX';
  description = 'Multi-filter trend following strategy';

  parameters = [
    { name: 'supertrendPeriod', type: 'number', default: 10, min: 5, max: 20 },
    { name: 'supertrendMultiplier', type: 'number', default: 3, min: 1, max: 5 },
    { name: 'emaFastPeriod', type: 'number', default: 50, min: 20, max: 100 },
    { name: 'emaSlowPeriod', type: 'number', default: 200, min: 100, max: 300 },
    // ... etc
  ];

  async onCandle(candle: Candle, context: TradingContext): Promise<Signal> {
    // Your existing logic from strategies/index.ts
    const indicators = await this.calculateIndicators(context.candles);
    return this.generateSignal(indicators, context.position, candle.close);
  }
}
```

#### 1.4 Multi-Bot Orchestrator

**File: `packages/core/src/orchestrator/manager.ts`**
```typescript
export class BotOrchestrator {
  private bots: Map<string, BotInstance> = new Map();
  private database: Database;
  private eventBus: EventBus;

  async createBot(config: BotCreationConfig): Promise<string> {
    // Validate user has permissions
    await this.validateUser(config.userId);

    // Create bot instance
    const bot = new BotInstance({
      id: generateId(),
      userId: config.userId,
      exchange: config.exchange,
      strategy: config.strategy,
      config: config.config,
    });

    // Save to database
    await this.database.bots.create(bot);

    // Register bot
    this.bots.set(bot.id, bot);

    // Initialize but don't start
    await bot.initialize();

    return bot.id;
  }

  async startBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');

    // Check if user has sufficient balance
    await this.validateBalance(bot.userId, bot.exchange);

    // Start bot
    await bot.start();

    // Emit event
    this.eventBus.emit('botStarted', { botId, userId: bot.userId });
  }

  async stopBot(botId: string, reason: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) return;

    await bot.stop(reason);
    this.eventBus.emit('botStopped', { botId, reason });
  }

  // Get real-time bot status
  getBotStatus(botId: string): BotStatus {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');

    return {
      id: bot.id,
      status: bot.status,
      exchange: bot.exchange.getMetadata().name,
      strategy: bot.strategy.name,
      position: bot.currentPosition,
      stats: bot.getStats(),
      lastUpdate: Date.now(),
    };
  }

  // Broadcast updates to UI
  private broadcastUpdate(botId: string): void {
    const status = this.getBotStatus(botId);
    this.eventBus.emit('botUpdate', status);
  }
}
```

### PHASE 2: DATABASE LAYER (1 week)

#### 2.1 Database Schema

**File: `packages/database/src/schema.prisma`**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  apiKey        String?   @unique
  plan          Plan      @default(FREE)
  createdAt     DateTime  @default(now())

  wallets       Wallet[]
  bots          Bot[]
  trades        Trade[]
}

model Wallet {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])

  name          String
  address       String
  encryptedKey  String    // Encrypted private key
  chainId       Int

  balance       Float     @default(0)
  lastSync      DateTime  @default(now())

  createdAt     DateTime  @default(now())

  @@unique([userId, address])
}

model Bot {
  id            String     @id @default(cuid())
  userId        String
  user          User       @relation(fields: [userId], references: [id])

  name          String
  exchange      String     // 'hyperliquid', 'vertex', 'aevo'
  strategyName  String
  config        Json       // Bot configuration

  status        BotStatus  @default(STOPPED)
  walletId      String

  // Stats
  totalTrades   Int        @default(0)
  winRate       Float      @default(0)
  totalPnl      Float      @default(0)
  totalVolume   Float      @default(0)

  createdAt     DateTime   @default(now())
  startedAt     DateTime?
  stoppedAt     DateTime?

  trades        Trade[]

  @@index([userId, status])
}

model Trade {
  id            String     @id @default(cuid())
  botId         String
  bot           Bot        @relation(fields: [botId], references: [id])
  userId        String
  user          User       @relation(fields: [userId], references: [id])

  exchange      String
  symbol        String
  side          String     // 'LONG' | 'SHORT'

  entryPrice    Float
  exitPrice     Float?
  size          Float
  leverage      Int

  stopLoss      Float
  takeProfit    Float

  pnl           Float?
  pnlPercent    Float?
  fee           Float      @default(0)

  status        TradeStatus @default(OPEN)
  exitReason    String?    // 'SL' | 'TP' | 'SIGNAL' | 'MANUAL'

  openedAt      DateTime   @default(now())
  closedAt      DateTime?

  @@index([botId, status])
  @@index([userId, openedAt])
}

model SystemMetric {
  id            String     @id @default(cuid())
  timestamp     DateTime   @default(now())

  activeBots    Int
  totalVolume24h Float
  totalTrades24h Int
  systemHealth  Float

  @@index([timestamp])
}

enum Plan {
  FREE
  STARTER
  PRO
  ENTERPRISE
}

enum BotStatus {
  STOPPED
  STARTING
  RUNNING
  PAUSED
  ERROR
}

enum TradeStatus {
  OPEN
  CLOSED
  CANCELLED
}
```

#### 2.2 Repository Pattern

**File: `packages/database/src/repositories/bot.repository.ts`**
```typescript
export class BotRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateBotData): Promise<Bot> {
    return await this.prisma.bot.create({
      data: {
        ...data,
        config: data.config as any, // Prisma Json type
      },
    });
  }

  async findByUserId(userId: string): Promise<Bot[]> {
    return await this.prisma.bot.findMany({
      where: { userId },
      include: {
        trades: {
          orderBy: { openedAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async updateStats(botId: string, stats: BotStatsUpdate): Promise<void> {
    await this.prisma.bot.update({
      where: { id: botId },
      data: {
        totalTrades: { increment: stats.tradesIncrement || 0 },
        totalPnl: { increment: stats.pnlIncrement || 0 },
        totalVolume: { increment: stats.volumeIncrement || 0 },
        winRate: stats.newWinRate,
      },
    });
  }

  async getLeaderboard(limit: number = 10): Promise<BotLeaderboard[]> {
    return await this.prisma.bot.findMany({
      where: {
        status: 'RUNNING',
        totalTrades: { gte: 10 }, // Min 10 trades
      },
      orderBy: {
        totalPnl: 'desc',
      },
      take: limit,
      select: {
        id: true,
        name: true,
        strategyName: true,
        exchange: true,
        totalPnl: true,
        winRate: true,
        totalTrades: true,
      },
    });
  }
}
```

### PHASE 3: API LAYER (1-2 weeks)

#### 3.1 REST API

**File: `packages/api/src/routes/bots.ts`**
```typescript
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Create bot
router.post('/bots', authenticate, rateLimit('10/hour'), async (req, res) => {
  const { name, exchange, strategy, config, walletId } = req.body;

  // Validate config
  const validation = await validateBotConfig(exchange, strategy, config);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors });
  }

  // Create bot
  const bot = await orchestrator.createBot({
    userId: req.user.id,
    name,
    exchange,
    strategy,
    config,
    walletId,
  });

  res.json({ botId: bot.id });
});

// Get user's bots
router.get('/bots', authenticate, async (req, res) => {
  const bots = await botRepository.findByUserId(req.user.id);
  res.json({ bots });
});

// Start bot
router.post('/bots/:id/start', authenticate, async (req, res) => {
  const { id } = req.params;

  // Check ownership
  const bot = await botRepository.findById(id);
  if (bot.userId !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  await orchestrator.startBot(id);
  res.json({ success: true });
});

// Stop bot
router.post('/bots/:id/stop', authenticate, async (req, res) => {
  const { id } = req.params;
  await orchestrator.stopBot(id, 'User requested');
  res.json({ success: true });
});

// Get bot stats
router.get('/bots/:id/stats', authenticate, async (req, res) => {
  const { id } = req.params;
  const stats = await botRepository.getStats(id);
  res.json(stats);
});

// Get bot trades
router.get('/bots/:id/trades', authenticate, async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const trades = await tradeRepository.findByBotId(id, {
    page: Number(page),
    limit: Number(limit),
  });

  res.json(trades);
});

export default router;
```

#### 3.2 WebSocket for Real-Time Updates

**File: `packages/api/src/websocket/server.ts`**
```typescript
import { Server } from 'socket.io';
import { authenticateSocket } from './auth';

export function setupWebSocket(io: Server) {
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const userId = socket.data.userId;

    // Join user's room
    socket.join(`user:${userId}`);

    // Subscribe to bot updates
    socket.on('subscribe:bot', async (botId: string) => {
      // Verify ownership
      const bot = await botRepository.findById(botId);
      if (bot.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      socket.join(`bot:${botId}`);

      // Send current status
      const status = orchestrator.getBotStatus(botId);
      socket.emit('bot:status', status);
    });

    // Unsubscribe
    socket.on('unsubscribe:bot', (botId: string) => {
      socket.leave(`bot:${botId}`);
    });

    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected`);
    });
  });

  // Bot events -> WebSocket
  eventBus.on('botUpdate', (data: BotStatus) => {
    io.to(`bot:${data.id}`).emit('bot:update', data);
  });

  eventBus.on('tradeOpened', (data: Trade) => {
    io.to(`bot:${data.botId}`).emit('trade:opened', data);
  });

  eventBus.on('tradeClosed', (data: Trade) => {
    io.to(`bot:${data.botId}`).emit('trade:closed', data);
  });
}
```

### PHASE 4: SECURITY & WALLET MANAGEMENT (1 week)

#### 4.1 Encrypted Wallet Storage

**File: `packages/core/src/wallet/manager.ts`**
```typescript
import { encrypt, decrypt } from '../crypto/aes';

export class WalletManager {
  async addWallet(
    userId: string,
    name: string,
    privateKey: string,
    masterPassword: string
  ): Promise<string> {
    // Encrypt private key with user's master password
    const encryptedKey = await encrypt(privateKey, masterPassword);

    // Derive address
    const wallet = new ethers.Wallet(privateKey);

    // Store in database
    const walletRecord = await walletRepository.create({
      userId,
      name,
      address: wallet.address,
      encryptedKey,
      chainId: 42161, // Arbitrum
    });

    return walletRecord.id;
  }

  async getWallet(
    walletId: string,
    masterPassword: string
  ): Promise<ethers.Wallet> {
    const record = await walletRepository.findById(walletId);

    // Decrypt private key
    const privateKey = await decrypt(record.encryptedKey, masterPassword);

    return new ethers.Wallet(privateKey);
  }

  async syncBalance(walletId: string): Promise<number> {
    const record = await walletRepository.findById(walletId);
    const provider = getProvider(record.chainId);

    const balance = await provider.getBalance(record.address);
    const balanceInUsd = await convertToUsd(balance, record.chainId);

    await walletRepository.updateBalance(walletId, balanceInUsd);

    return balanceInUsd;
  }
}
```

#### 4.2 API Key Management

**File: `packages/api/src/auth/apiKey.ts`**
```typescript
export class ApiKeyManager {
  async generateApiKey(userId: string): Promise<string> {
    const apiKey = `pk_${generateSecureRandom(32)}`;
    const hashedKey = await hashApiKey(apiKey);

    await userRepository.updateApiKey(userId, hashedKey);

    // Return only once (like Stripe)
    return apiKey;
  }

  async validateApiKey(apiKey: string): Promise<User | null> {
    const hashedKey = await hashApiKey(apiKey);
    return await userRepository.findByApiKey(hashedKey);
  }
}

// Middleware
export async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const user = await apiKeyManager.validateApiKey(apiKey);
  if (!user) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.user = user;
  next();
}
```

### PHASE 5: UI/UX (2-3 weeks)

#### 5.1 Dashboard Components

**File: `packages/ui/src/pages/Dashboard.tsx`**
```typescript
import { useBots } from '../hooks/useBots';
import { BotCard } from '../components/BotCard';
import { CreateBotModal } from '../components/CreateBotModal';

export function Dashboard() {
  const { bots, loading, createBot, startBot, stopBot } = useBots();
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  return (
    <div className="dashboard">
      <header>
        <h1>My Trading Bots</h1>
        <button onClick={() => setCreateModalOpen(true)}>
          + New Bot
        </button>
      </header>

      <div className="stats-grid">
        <StatCard title="Total PnL" value="$2,345.67" change="+12.5%" />
        <StatCard title="Active Bots" value="3" />
        <StatCard title="Win Rate" value="68.5%" />
        <StatCard title="24h Volume" value="$45,230" />
      </div>

      <div className="bots-grid">
        {bots.map(bot => (
          <BotCard
            key={bot.id}
            bot={bot}
            onStart={() => startBot(bot.id)}
            onStop={() => stopBot(bot.id)}
          />
        ))}
      </div>

      <CreateBotModal
        isOpen={isCreateModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={createBot}
      />
    </div>
  );
}
```

#### 5.2 Real-Time Updates Hook

**File: `packages/ui/src/hooks/useBot.ts`**
```typescript
import { useEffect, useState } from 'react';
import { socket } from '../services/socket';

export function useBot(botId: string) {
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    // Subscribe to bot updates
    socket.emit('subscribe:bot', botId);

    socket.on('bot:update', (data: BotStatus) => {
      if (data.id === botId) {
        setBot(data);
      }
    });

    socket.on('trade:opened', (trade: Trade) => {
      if (trade.botId === botId) {
        setTrades(prev => [trade, ...prev]);
      }
    });

    socket.on('trade:closed', (trade: Trade) => {
      if (trade.botId === botId) {
        setTrades(prev =>
          prev.map(t => (t.id === trade.id ? trade : t))
        );
      }
    });

    return () => {
      socket.emit('unsubscribe:bot', botId);
      socket.off('bot:update');
      socket.off('trade:opened');
      socket.off('trade:closed');
    };
  }, [botId]);

  return { bot, trades };
}
```

### PHASE 6: MONETIZATION (1 week)

#### 6.1 Pricing Plans

```typescript
export const PRICING_PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    features: {
      maxBots: 1,
      maxDailyTrades: 10,
      exchanges: ['hyperliquid'],
      strategies: ['supertrend'],
      support: 'community',
      apiAccess: false,
    },
  },
  STARTER: {
    name: 'Starter',
    price: 29,
    features: {
      maxBots: 3,
      maxDailyTrades: 50,
      exchanges: ['hyperliquid', 'vertex', 'aevo'],
      strategies: ['all'],
      support: 'email',
      apiAccess: true,
    },
  },
  PRO: {
    name: 'Pro',
    price: 99,
    features: {
      maxBots: 10,
      maxDailyTrades: -1, // unlimited
      exchanges: ['all'],
      strategies: ['all'],
      support: 'priority',
      apiAccess: true,
      customStrategies: true,
    },
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: 499,
    features: {
      maxBots: -1, // unlimited
      maxDailyTrades: -1,
      exchanges: ['all'],
      strategies: ['all'],
      support: 'dedicated',
      apiAccess: true,
      customStrategies: true,
      whiteLabel: true,
      onPremise: true,
    },
  },
};
```

#### 6.2 Plan Enforcement Middleware

**File: `packages/api/src/middleware/planCheck.ts`**
```typescript
export function checkPlanLimits(resource: 'bots' | 'trades') {
  return async (req, res, next) => {
    const user = req.user;
    const plan = PRICING_PLANS[user.plan];

    if (resource === 'bots') {
      const botCount = await botRepository.countByUserId(user.id);
      if (plan.features.maxBots !== -1 && botCount >= plan.features.maxBots) {
        return res.status(402).json({
          error: 'Plan limit reached',
          message: `Your ${plan.name} plan allows maximum ${plan.features.maxBots} bots`,
          upgrade: true,
        });
      }
    }

    if (resource === 'trades') {
      const today = startOfDay(new Date());
      const tradeCount = await tradeRepository.countByUserIdSince(user.id, today);

      if (plan.features.maxDailyTrades !== -1 &&
          tradeCount >= plan.features.maxDailyTrades) {
        return res.status(429).json({
          error: 'Daily trade limit reached',
          message: `Your ${plan.name} plan allows ${plan.features.maxDailyTrades} trades per day`,
          upgrade: true,
        });
      }
    }

    next();
  };
}

// Usage:
router.post('/bots', authenticate, checkPlanLimits('bots'), createBot);
```

### PHASE 7: DEPLOYMENT & DEVOPS (1 week)

#### 7.1 Docker Setup

**File: `docker-compose.yml`**
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: perpbot
      POSTGRES_USER: perpbot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: apps/api-server/Dockerfile
    environment:
      DATABASE_URL: postgresql://perpbot:${DB_PASSWORD}@postgres:5432/perpbot
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment:
      DATABASE_URL: postgresql://perpbot:${DB_PASSWORD}@postgres:5432/perpbot
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 3

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "80:80"
    depends_on:
      - api

volumes:
  postgres_data:
```

#### 7.2 Monitoring Setup

**File: `packages/core/src/monitoring/metrics.ts`**
```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

export const metrics = {
  // Trades
  tradesTotal: new Counter({
    name: 'trades_total',
    help: 'Total number of trades',
    labelNames: ['exchange', 'strategy', 'side', 'result'],
  }),

  tradePnl: new Histogram({
    name: 'trade_pnl_usd',
    help: 'Trade PnL in USD',
    labelNames: ['exchange', 'strategy'],
    buckets: [-1000, -500, -100, -50, 0, 50, 100, 500, 1000],
  }),

  // Bots
  activeBots: new Gauge({
    name: 'active_bots_total',
    help: 'Number of active bots',
    labelNames: ['exchange'],
  }),

  // System
  apiLatency: new Histogram({
    name: 'api_latency_seconds',
    help: 'API request latency',
    labelNames: ['method', 'route', 'status'],
  }),

  exchangeErrors: new Counter({
    name: 'exchange_errors_total',
    help: 'Exchange API errors',
    labelNames: ['exchange', 'type'],
  }),
};

// Usage in bot
await metrics.tradesTotal.inc({
  exchange: 'vertex',
  strategy: 'supertrend',
  side: 'LONG',
  result: 'win',
});
```

## IMPLEMENTATION ROADMAP

### Week 1-3: Core Refactoring
- [ ] Multi-DEX architecture
- [ ] Exchange connectors (Hyperliquid, Vertex, Aevo)
- [ ] Strategy engine refactor
- [ ] Order management system

### Week 4: Database Layer
- [ ] Prisma schema
- [ ] Repositories
- [ ] Migrations
- [ ] Seed data

### Week 5-6: API Layer
- [ ] REST API endpoints
- [ ] WebSocket server
- [ ] Authentication (JWT + API keys)
- [ ] Rate limiting

### Week 7: Security
- [ ] Wallet encryption
- [ ] API key management
- [ ] Plan enforcement
- [ ] Audit logging

### Week 8-10: UI Development
- [ ] Dashboard
- [ ] Bot creation wizard
- [ ] Real-time charts
- [ ] Trade history
- [ ] Settings

### Week 11: Monetization
- [ ] Stripe integration
- [ ] Plan limits
- [ ] Usage tracking
- [ ] Billing portal

### Week 12: DevOps
- [ ] Docker setup
- [ ] CI/CD pipeline
- [ ] Monitoring (Prometheus + Grafana)
- [ ] Error tracking (Sentry)
- [ ] Production deployment

## TECH STACK RECOMMENDATIONS

### Backend
- **Framework**: Fastify (faster than Express) or NestJS (more structured)
- **Database**: PostgreSQL (reliability) + Redis (caching)
- **ORM**: Prisma (type-safe, great DX)
- **Queue**: BullMQ (for background jobs)
- **WebSocket**: Socket.io or ws

### Frontend
- **Framework**: Next.js 14 (App Router)
- **UI Library**: Shadcn/ui or Mantine
- **Charts**: TradingView Lightweight Charts or Recharts
- **State**: Zustand or Jotai (lighter than Redux)
- **Forms**: React Hook Form + Zod

### Infrastructure
- **Hosting**: Railway / Render / AWS
- **CDN**: Cloudflare
- **Monitoring**: Better Stack / Datadog
- **Error Tracking**: Sentry
- **Analytics**: PostHog or Mixpanel

### Blockchain
- **RPC**: Alchemy / Infura / QuickNode
- **Wallet**: ethers.js v6
- **Contracts**: Depend on exchange

## ESTIMATED COSTS

### Development (3 months)
- 1 Full-stack developer: $15k-20k/mo × 3 = $45k-60k
- Or DIY: 3 months full-time

### Infrastructure (Monthly)
- Database (Postgres): $25-50
- Redis: $10-20
- API Server (2 instances): $40-80
- Worker (3 instances): $60-120
- Storage: $10-20
- CDN: $20-50
- Monitoring: $50-100
- **Total: ~$215-440/mo**

### Break-even Analysis
- 10 Starter users ($29) = $290/mo ✅
- 3 Pro users ($99) = $297/mo ✅
- 1 Enterprise ($499) = $499/mo ✅

## GO-TO-MARKET STRATEGY

### Phase 1: MVP Launch (Month 1)
- Free tier only
- 1 exchange (Hyperliquid)
- 1 strategy (Supertrend)
- Basic UI
- Goal: 50 users, feedback

### Phase 2: Paid Plans (Month 2)
- Starter + Pro plans
- 3 exchanges
- 3 strategies
- Improved UI
- Goal: $1k MRR

### Phase 3: Scale (Month 3-6)
- Enterprise plan
- Custom strategies
- API access
- Referral program
- Goal: $10k MRR

### Marketing Channels
1. **Crypto Twitter** - Share PnL screenshots
2. **YouTube** - Tutorial videos
3. **Discord** - Community building
4. **Reddit** - r/CryptoTrading, r/algotrading
5. **Product Hunt** - Launch
6. **Partnerships** - Crypto influencers

## NEXT STEPS

Would you like me to:
1. ✅ **Start implementing** - Pick a phase and I'll write the code
2. 📊 **Create UI mockups** - Design the dashboard
3. 🔌 **Build exchange connector** - Which DEX? (Vertex, Aevo, Hyperliquid)
4. 🗄️ **Set up database** - Create Prisma schema + migrations
5. 🎨 **Design monetization** - Detailed pricing strategy

Let me know what you want to tackle first!
