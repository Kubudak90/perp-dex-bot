'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils"
import { Activity, TrendingUp, DollarSign, BarChart3, ArrowUpRight, ArrowDownRight, WifiOff } from "lucide-react"
import { useExtendedData } from "@/lib/hooks/useExtendedData"

export default function Dashboard() {
  const { data, connected, error, reconnect } = useExtendedData()

  // Use real-time data if available, otherwise show loading state
  const stats = data?.stats || {
    totalTrades: 0,
    winRate: 0,
    totalPnl: 0,
    totalVolume: 0,
  }

  const balance = data?.balance || {
    total: 0,
    available: 0,
    margin: 0,
  }

  const positions = data?.positions || []

  // Calculate derived stats
  const dailyPnl = stats.totalPnl
  const dailyPnlPercent = balance.total > 0 ? (dailyPnl / balance.total) * 100 : 0

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
              {connected ? (
                <div className="flex items-center space-x-2 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-500">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span>Connected</span>
                </div>
              ) : (
                <button
                  onClick={reconnect}
                  className="flex items-center space-x-2 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors"
                >
                  <WifiOff className="h-3 w-3" />
                  <span>{error || 'Disconnected'} - Click to reconnect</span>
                </button>
              )}
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
                <div className="text-2xl font-bold">{formatCurrency(balance.total)}</div>
                <p className="text-xs text-muted-foreground">
                  <span className={dailyPnl >= 0 ? "text-green-500" : "text-red-500"}>
                    {formatCurrency(dailyPnl)} ({formatPercent(dailyPnlPercent)})
                  </span> total PnL
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
                <div className="text-2xl font-bold">{stats.totalTrades}</div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(stats.winRate)} win rate
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
                <div className="text-2xl font-bold">${formatNumber(stats.totalVolume / 1000, 0)}K</div>
                <p className="text-xs text-muted-foreground">
                  Airdrop points: <span className="text-yellow-500">~{Math.floor(stats.totalVolume / 500)}</span>
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
                <div className="text-2xl font-bold">{connected ? 1 : 0}</div>
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
                  {positions.length} active positions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {positions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No open positions
                  </div>
                ) : (
                  <div className="space-y-4">
                    {positions.map((pos, i) => {
                      const pnlPercent = ((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'LONG' ? 1 : -1)
                      return (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{pos.symbol}</span>
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
                            <div className={`font-medium ${pos.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {pos.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(pos.unrealizedPnl)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatPercent(pnlPercent)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Account Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Account Summary</CardTitle>
                <CardDescription>
                  Margin and balance details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Available Balance</div>
                      <div className="text-xs text-muted-foreground">
                        Free for trading
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-green-500">
                        {formatCurrency(balance.available)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Margin Used</div>
                      <div className="text-xs text-muted-foreground">
                        Locked in positions
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-orange-500">
                        {formatCurrency(balance.margin)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Total Equity</div>
                      <div className="text-xs text-muted-foreground">
                        Available + Margin + Unrealized PnL
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">
                        {formatCurrency(balance.total)}
                      </div>
                    </div>
                  </div>
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
