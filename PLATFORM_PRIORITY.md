# PLATFORM INTEGRATION PRIORITY

## Phase 1: Extended (Week 1-2) 🎯
**WHY**: Active airdrop (ends Q1 2026), clear ROI ($6/point OTC)

### Implementation Tasks
- [ ] Starknet wallet integration (starknet.js)
- [ ] Extended API connector
  - REST API for market data
  - WebSocket for real-time updates
  - Order execution via signatures
- [ ] Points tracking dashboard
- [ ] Gas optimization (batch transactions)

### Extended-Specific Features
```typescript
interface ExtendedStrategy {
  mode: 'volume' | 'points-optimized';
  minPointsPerTrade: number;
  pointsMultipliers: {
    trading: number;      // 1x base
    liquidity: number;    // 1.5x for vault
    referral: number;     // 0.5x per referee
  };
}
```

### Expected Outcome
- 200-300 points/week
- $12k-18k airdrop value (90 days)
- Break-even after 2 weeks even if points = 0

---

## Phase 2: GRVT (Week 3-4) 💰
**WHY**: Negative maker fees = instant profit + likely airdrop

### Implementation Tasks
- [ ] ZKsync Era wallet integration
- [ ] GRVT Hyperchain connector
- [ ] Maker order strategy (for negative fees)
- [ ] Privacy features (ZK proof handling)

### GRVT-Specific Features
```typescript
interface GRVTStrategy {
  orderType: 'maker' | 'taker' | 'mixed';
  negativeFeeOptimization: boolean;
  privacyMode: boolean; // Use ZK proofs
  spreadTargets: {
    btc: number;  // e.g., 0.02% from mid
    eth: number;
    alt: number;
  };
}
```

### Expected Outcome
- +$300-500 from negative fees alone
- Airdrop potential: $5k-15k
- Zero trading cost (fees = profit)

---

## Phase 3: Pacifica (Week 5-6) 🏎️
**WHY**: Highest volume, lowest latency, proven profitability

### Implementation Tasks
- [ ] Solana wallet integration (@solana/web3.js)
- [ ] Pacifica SDK (@pacifica/sdk - if available)
- [ ] High-frequency optimizations
  - WebSocket for <20ms execution
  - Transaction priority fees
  - Jito bundle support (MEV protection)

### Pacifica-Specific Features
```typescript
interface PacificaStrategy {
  mode: 'scalping' | 'trend-following';
  maxLatency: number;        // 20ms target
  useJitoBundles: boolean;   // MEV protection
  priorityFee: 'auto' | number; // Solana priority
  pointsTracking: boolean;   // Track 500k/week distribution
}
```

### Expected Outcome
- Pure trading profit: 5-10% monthly
- Points value: Unknown (may announce token)
- Latency advantage over other bots

---

## Technical Architecture (Multi-Chain Support)

```typescript
// packages/exchanges/src/factory.ts
export class ExchangeFactory {
  static create(config: ExchangeConfig): IExchange {
    switch (config.platform) {
      case 'extended':
        return new ExtendedConnector(config); // Starknet
      case 'grvt':
        return new GRVTConnector(config);     // ZKsync
      case 'pacifica':
        return new PacificaConnector(config); // Solana
      case 'hyperliquid':
        return new HyperliquidConnector(config); // L1
      default:
        throw new Error(`Unsupported platform: ${config.platform}`);
    }
  }
}

// Universal wallet manager
export class MultiChainWalletManager {
  private wallets: Map<ChainType, Wallet> = new Map();

  async addWallet(chain: ChainType, privateKey: string): Promise<void> {
    switch (chain) {
      case 'evm':
        // Ethereum, ZKsync, Arbitrum
        this.wallets.set(chain, new ethers.Wallet(privateKey));
        break;
      case 'starknet':
        // Extended
        this.wallets.set(chain, new StarknetWallet(privateKey));
        break;
      case 'solana':
        // Pacifica
        this.wallets.set(chain, Keypair.fromSecretKey(bs58.decode(privateKey)));
        break;
    }
  }

  getWallet(chain: ChainType): Wallet {
    const wallet = this.wallets.get(chain);
    if (!wallet) throw new Error(`No wallet for chain: ${chain}`);
    return wallet;
  }
}
```

---

## Multi-Platform Bot Orchestrator

```typescript
// packages/core/src/orchestrator/multi-platform.ts
export class MultiPlatformOrchestrator {
  private platformBots: Map<string, BotInstance> = new Map();

  async startFarming(config: FarmingConfig): Promise<void> {
    // Extended: Volume optimization
    const extendedBot = new BotInstance({
      exchange: 'extended',
      strategy: 'volume-optimized',
      capital: config.capitalPerPlatform.extended,
      goals: {
        dailyTrades: 15,
        weeklyPoints: 200,
      },
    });

    // GRVT: Maker order focus
    const grvtBot = new BotInstance({
      exchange: 'grvt',
      strategy: 'maker-optimized',
      capital: config.capitalPerPlatform.grvt,
      goals: {
        negativeFeeEarnings: 50, // $50/day
        orderBookDepth: 0.02, // 2% from mid
      },
    });

    // Pacifica: High-frequency scalping
    const pacificaBot = new BotInstance({
      exchange: 'pacifica',
      strategy: 'scalping',
      capital: config.capitalPerPlatform.pacifica,
      goals: {
        profitTarget: 0.5, // 0.5% daily
        maxLatency: 20, // ms
      },
    });

    // Start all bots with staggered timing
    await extendedBot.start();
    await this.sleep(Math.random() * 300000); // 0-5 min delay

    await grvtBot.start();
    await this.sleep(Math.random() * 300000);

    await pacificaBot.start();

    // Register bots
    this.platformBots.set('extended', extendedBot);
    this.platformBots.set('grvt', grvtBot);
    this.platformBots.set('pacifica', pacificaBot);
  }

  async balanceCapital(): Promise<void> {
    // Rebalance capital based on performance
    const stats = await this.getStats();

    // Move capital to best performer
    if (stats.extended.roi > stats.grvt.roi && stats.extended.roi > stats.pacifica.roi) {
      await this.reallocateCapital('extended', 0.5); // 50% of total
    }
  }

  getAggregateStats(): AggregateStats {
    return {
      totalPnl: sum(bot.stats.pnl for bot in this.platformBots),
      totalVolume: sum(bot.stats.volume for bot in this.platformBots),
      totalPoints: {
        extended: this.platformBots.get('extended').stats.points,
        pacifica: this.platformBots.get('pacifica').stats.points,
      },
      estimatedAirdropValue: this.calculateAirdropValue(),
    };
  }

  private calculateAirdropValue(): number {
    const extended = this.platformBots.get('extended').stats.points * 6; // $6 OTC
    const grvt = 0; // Unknown, estimate $10k-15k
    const pacifica = 0; // Unknown

    return extended + 12500; // Extended points + conservative GRVT estimate
  }
}
```

---

## Capital Allocation Strategy

### Conservative (Total: $5,000)
```
Extended:  $2,000 (40%) - Active airdrop, proven ROI
GRVT:      $2,000 (40%) - Negative fees, low risk
Pacifica:  $1,000 (20%) - High risk/reward scalping
```

### Aggressive (Total: $10,000)
```
Extended:  $4,000 (40%) - Max points farming
GRVT:      $3,000 (30%) - Max negative fee earnings
Pacifica:  $3,000 (30%) - High-frequency profit
```

### Expected Returns (90 days)

| Platform | Capital | Trading PnL | Airdrop Value | Gas | NET |
|----------|---------|-------------|---------------|-----|-----|
| Extended | $2,000  | -$200       | $12,000       | -$100 | **$11,700** |
| GRVT     | $2,000  | +$500       | $10,000       | -$50  | **$10,450** |
| Pacifica | $1,000  | +$450       | $0 (unknown)  | -$150 | **$300** |
| **TOTAL** | **$5,000** | **+$750** | **$22,000** | **-$300** | **$22,450** |

**ROI: 449% in 90 days** 🚀

---

## Risk Management

### Platform-Specific Risks

**Extended (Starknet)**
- Risk: Season ends suddenly
- Mitigation: Trade daily, don't wait for "perfect" setups
- Stop-loss: If points OTC < $3, reduce activity

**GRVT (ZKsync)**
- Risk: Negative fees change to positive
- Mitigation: Monitor fee schedule, adjust strategy
- Stop-loss: If maker fee > 0.01%, switch to taker only

**Pacifica (Solana)**
- Risk: High competition, low margins
- Mitigation: Use latency advantage, sub-20ms execution
- Stop-loss: If daily PnL < -2%, pause

### Portfolio Risk
- Max loss per platform: 5% of capital
- Daily stop-loss: -3% total portfolio
- Correlation: Low (different chains, different strategies)

---

## UI Dashboard Features

### Multi-Platform Overview
```typescript
interface DashboardData {
  platforms: {
    extended: {
      status: 'running' | 'paused' | 'stopped';
      pnl: number;
      points: number;
      pointsValue: number; // @ $6 OTC
      daysUntilSeasonEnd: number;
    };
    grvt: {
      status: string;
      pnl: number;
      negativeFeeEarnings: number;
      makerOrderRatio: number; // % maker orders
    };
    pacifica: {
      status: string;
      pnl: number;
      avgLatency: number;
      points: number;
    };
  };
  aggregate: {
    totalPnl: number;
    totalVolume: number;
    estimatedAirdropValue: number;
    totalRoi: number;
  };
}
```

### Real-Time Metrics
- Live PnL per platform
- Points accumulation (Extended)
- Negative fee earnings (GRVT)
- Latency monitoring (Pacifica)
- Capital allocation pie chart
- Airdrop value calculator

---

## Next Steps

### Week 1: Extended Connector
1. Install Starknet dependencies
2. Implement Extended API wrapper
3. Test order execution on testnet
4. Deploy to mainnet with $100 test capital

### Week 2: GRVT Connector
1. Install ZKsync dependencies
2. Implement GRVT API + maker strategy
3. Test negative fee collection
4. Deploy with $100 test capital

### Week 3: Pacifica Connector
1. Install Solana dependencies
2. Implement Pacifica SDK wrapper
3. Optimize for <20ms latency
4. Deploy with $100 test capital

### Week 4: Integration
1. Multi-platform orchestrator
2. Unified dashboard
3. Capital rebalancing
4. Production deployment with full capital

---

## Monitoring & Alerts

### Telegram Notifications
- Daily PnL summary (all platforms)
- Weekly points update (Extended)
- Negative fee earnings (GRVT)
- System errors/warnings
- Platform status changes

### Critical Alerts
- Extended: "Season ending in 7 days!"
- GRVT: "Fee structure changed!"
- Pacifica: "Latency > 50ms!"
- All: "Daily loss > 3%"

---

## Conclusion

**Primary Focus**: Extended (Q1 2026 deadline!)
**Secondary**: GRVT (negative fees = no-brainer)
**Tertiary**: Pacifica (pure profit, bonus points)

**Total Expected Outcome**: $22k+ in 90 days with $5k capital

Start with Extended ASAP - Season ends Q1 2026! 🏃‍♂️💨
