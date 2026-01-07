'use client'

import { useState, useEffect, useCallback } from 'react'

export interface ExtendedBalance {
  total: number
  available: number
  margin: number
}

export interface ExtendedPosition {
  symbol: string
  side: 'LONG' | 'SHORT'
  size: number
  entryPrice: number
  markPrice: number
  unrealizedPnl: number
  realizedPnl: number
  leverage: number
  liquidationPrice: number
}

export interface ExtendedStats {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  totalPnl: number
  totalVolume: number
  averageWin: number
  averageLoss: number
  largestWin: number
  largestLoss: number
}

export interface ExtendedData {
  balance: ExtendedBalance
  positions: ExtendedPosition[]
  stats: ExtendedStats
}

export interface UseExtendedDataReturn {
  data: ExtendedData | null
  connected: boolean
  error: string | null
  reconnect: () => void
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws'
const RECONNECT_DELAY = 3000 // 3 seconds

export function useExtendedData(): UseExtendedDataReturn {
  const [data, setData] = useState<ExtendedData | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shouldReconnect, setShouldReconnect] = useState(true)
  const [ws, setWs] = useState<WebSocket | null>(null)

  const connect = useCallback(() => {
    if (!shouldReconnect) return

    console.log('🔌 Connecting to WebSocket:', WS_URL)
    setError(null)

    try {
      const socket = new WebSocket(WS_URL)

      socket.onopen = () => {
        console.log('✅ WebSocket connected')
        setConnected(true)
        setError(null)
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'init' || message.type === 'update') {
            setData(message.data)
          }
        } catch (err) {
          console.error('❌ Failed to parse WebSocket message:', err)
        }
      }

      socket.onerror = (event) => {
        console.error('❌ WebSocket error:', event)
        setError('Connection error')
        setConnected(false)
      }

      socket.onclose = () => {
        console.log('📡 WebSocket disconnected')
        setConnected(false)
        setWs(null)

        // Auto-reconnect after delay
        if (shouldReconnect) {
          setTimeout(() => {
            console.log('🔄 Reconnecting...')
            connect()
          }, RECONNECT_DELAY)
        }
      }

      setWs(socket)
    } catch (err) {
      console.error('❌ Failed to create WebSocket:', err)
      setError('Failed to connect')
      setConnected(false)
    }
  }, [shouldReconnect])

  const reconnect = useCallback(() => {
    if (ws) {
      ws.close()
    }
    setShouldReconnect(true)
    connect()
  }, [ws, connect])

  useEffect(() => {
    connect()

    return () => {
      console.log('🛑 Cleaning up WebSocket connection')
      setShouldReconnect(false)
      if (ws) {
        ws.close()
      }
    }
  }, [connect])

  return { data, connected, error, reconnect }
}
