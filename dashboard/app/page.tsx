'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils"
import { Activity, TrendingUp, DollarSign, BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react"

export default function Dashboard() {
  // Mock data - will be replaced with real-time data from Extended connector
  const mockStats = {
    equity: 12450.50,
    dailyPnl: 324.20,
    dailyPnlPercent: 2.67,
    totalTrades: 156,
    winRate: 68.5,
    activeBots: 2,
    totalVolume: 1245000,
  }

  const mockPositions = [
    {
      market: 'BTC-USD',
      side: 'LONG',
      size: 0.05,
      entryPrice: 62000,
      markPrice: 62450,
      pnl: 22.50,
      pnlPercent: 0.73,
    },
    {
      market: 'ETH-USD',
      side: 'SHORT',
      size: 1.2,
      entryPrice: 3200,
      markPrice: 3180,
      pnl: 24.00,
      pnlPercent: 0.63,
    },
  ]

  const mockTrades = [
    {
      id: '1',
      market: 'BTC-USD',
      side: 'LONG',
      size: 0.03,
      entryPrice: 61500,
      exitPrice: 62100,
      pnl: 18.00,
      time: '10:23:45',
    },
    {
      id: '2',
      market: 'SOL-USD',
      side: 'SHORT',
      size: 50,
      entryPrice: 142,
      exitPrice: 140.5,
      pnl: 75.00,
      time: '09:15:22',
    },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="mr-4 flex">
            <a className="mr-6 flex items-center space-x-2" href="/">
              <Activity className="h-6 w-6" />
              <span className="font-bold">Perp DEX Bot</span>
            </a>
          </div>
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <nav className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-500">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span>Connected</span>
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="container py-6 space-y-6">
          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Equity
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(mockStats.equity)}</div>
                <p className="text-xs text-muted-foreground">
                  <span className={mockStats.dailyPnl >= 0 ? "text-green-500" : "text-red-500"}>
                    {formatCurrency(mockStats.dailyPnl)} ({formatPercent(mockStats.dailyPnlPercent)})
                  </span> today
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Trades
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{mockStats.totalTrades}</div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(mockStats.winRate)} win rate
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Trading Volume
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${formatNumber(mockStats.totalVolume / 1000, 0)}K</div>
                <p className="text-xs text-muted-foreground">
                  Airdrop points: <span className="text-yellow-500">~2000</span>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Active Bots
                </CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{mockStats.activeBots}</div>
                <p className="text-xs text-muted-foreground">
                  Extended (Testnet)
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Positions & Trades */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Open Positions */}
            <Card>
              <CardHeader>
                <CardTitle>Open Positions</CardTitle>
                <CardDescription>
                  {mockPositions.length} active positions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockPositions.map((pos, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{pos.market}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            pos.side === 'LONG' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                          }`}>
                            {pos.side}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pos.size} @ {formatCurrency(pos.entryPrice, 0)}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className={`font-medium ${pos.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pos.pnl >= 0 ? '+' : ''}{formatCurrency(pos.pnl)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatPercent(pos.pnlPercent)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent Trades */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Trades</CardTitle>
                <CardDescription>
                  Latest executed trades
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockTrades.map((trade) => (
                    <div key={trade.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{trade.market}</span>
                          {trade.side === 'LONG' ? (
                            <ArrowUpRight className="h-3 w-3 text-green-500" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 text-red-500" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {trade.size} @ {formatCurrency(trade.entryPrice, 0)} → {formatCurrency(trade.exitPrice, 0)}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className={`font-medium ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {trade.pnl >= 0 ? '+' : ''}{formatCurrency(trade.pnl)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {trade.time}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bot Status */}
          <Card>
            <CardHeader>
              <CardTitle>Bot Status</CardTitle>
              <CardDescription>
                Real-time bot performance and settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Strategy</div>
                  <div className="text-lg font-semibold">Supertrend + EMA</div>
                  <div className="text-xs text-muted-foreground">
                    Period: 10 | Multiplier: 3.0
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Risk Management</div>
                  <div className="text-lg font-semibold">Conservative</div>
                  <div className="text-xs text-muted-foreground">
                    Max Position: 5% | SL: 1.5x ATR
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Exchange</div>
                  <div className="text-lg font-semibold">Extended (Starknet)</div>
                  <div className="text-xs text-muted-foreground">
                    Testnet | Maker: 0.02% | Taker: 0.05%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
