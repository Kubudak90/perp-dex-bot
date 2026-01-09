// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET MANAGER TESTS
// Unit tests for WebSocket connection and subscription management
// ═══════════════════════════════════════════════════════════════════════════

import { WebSocketManager } from '../src/utils/websocket';
import WebSocket from 'ws';

// Mock WebSocket
jest.mock('ws');

describe('WebSocketManager', () => {
    let wsManager: WebSocketManager;
    let mockWs: any;

    beforeEach(() => {
        mockWs = {
            readyState: WebSocket.OPEN,
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn(),
            ping: jest.fn(),
            pong: jest.fn()
        };

        (WebSocket as any).mockImplementation(() => mockWs);
        (WebSocket as any).OPEN = 1;
        (WebSocket as any).CONNECTING = 0;
        (WebSocket as any).CLOSING = 2;
        (WebSocket as any).CLOSED = 3;

        wsManager = new WebSocketManager({
            url: 'wss://test.example.com',
            reconnectDelay: 1000,
            maxReconnectAttempts: 3,
            pingInterval: 30000
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Connection Management', () => {
        it('should connect to WebSocket server', async () => {
            const connectPromise = wsManager.connect();

            // Simulate successful connection
            const onOpenCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'open'
            )?.[1];

            if (onOpenCallback) {
                onOpenCallback();
            }

            await connectPromise;

            expect(WebSocket).toHaveBeenCalledWith('wss://test.example.com');
            expect(wsManager.isConnected()).toBe(true);
        });

        it('should handle connection errors', async () => {
            const connectPromise = wsManager.connect();

            const onErrorCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'error'
            )?.[1];

            if (onErrorCallback) {
                onErrorCallback(new Error('Connection failed'));
            }

            await expect(connectPromise).rejects.toThrow();
        });

        it('should disconnect properly', () => {
            wsManager.disconnect();

            expect(mockWs.close).toHaveBeenCalledWith(1000, 'Normal closure');
        });

        it('should report correct connection state', () => {
            mockWs.readyState = WebSocket.OPEN;
            expect(wsManager.getState()).toBe('OPEN');

            mockWs.readyState = WebSocket.CONNECTING;
            expect(wsManager.getState()).toBe('CONNECTING');

            mockWs.readyState = WebSocket.CLOSED;
            expect(wsManager.getState()).toBe('CLOSED');
        });
    });

    describe('Subscription Management', () => {
        beforeEach(async () => {
            // Connect first
            const connectPromise = wsManager.connect();
            const onOpenCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'open'
            )?.[1];
            if (onOpenCallback) {
                onOpenCallback();
            }
            await connectPromise;
        });

        it('should subscribe to a channel', () => {
            wsManager.subscribe('candles', { asset: 'BTC', interval: '15m' });

            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"candles"')
            );
            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"asset":"BTC"')
            );
        });

        it('should unsubscribe from a channel', () => {
            wsManager.subscribe('trades', { asset: 'BTC' });
            mockWs.send.mockClear();

            wsManager.unsubscribe('trades');

            expect(mockWs.send).toHaveBeenCalledWith(
                expect.stringContaining('"method":"unsubscribe"')
            );
        });

        it('should send custom messages', () => {
            wsManager.send({ action: 'ping' });

            expect(mockWs.send).toHaveBeenCalledWith('{"action":"ping"}');
        });

        it('should throw when sending while disconnected', () => {
            mockWs.readyState = WebSocket.CLOSED;

            expect(() => wsManager.send({ test: 'data' })).toThrow(
                'WebSocket not connected'
            );
        });
    });

    describe('Message Handling', () => {
        beforeEach(async () => {
            const connectPromise = wsManager.connect();
            const onOpenCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'open'
            )?.[1];
            if (onOpenCallback) {
                onOpenCallback();
            }
            await connectPromise;
        });

        it('should emit candle events', (done) => {
            const candleData = { channel: 'candle', data: { price: 40000 } };

            wsManager.on('candle', (data) => {
                expect(data).toEqual({ price: 40000 });
                done();
            });

            const onMessageCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'message'
            )?.[1];

            if (onMessageCallback) {
                onMessageCallback(JSON.stringify(candleData));
            }
        });

        it('should emit trade events', (done) => {
            const tradeData = { channel: 'trades', data: { price: 40000, size: 1 } };

            wsManager.on('trade', (data) => {
                expect(data).toEqual({ price: 40000, size: 1 });
                done();
            });

            const onMessageCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'message'
            )?.[1];

            if (onMessageCallback) {
                onMessageCallback(JSON.stringify(tradeData));
            }
        });

        it('should handle malformed messages gracefully', () => {
            const onMessageCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'message'
            )?.[1];

            // Should not throw
            expect(() => {
                if (onMessageCallback) {
                    onMessageCallback('invalid json {');
                }
            }).not.toThrow();
        });
    });

    describe('Reconnection Logic', () => {
        it('should attempt reconnection on disconnect', (done) => {
            const onCloseCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'close'
            )?.[1];

            if (onCloseCallback) {
                onCloseCallback(1006, 'Connection lost');
            }

            // Check that reconnection is scheduled
            setTimeout(() => {
                expect(WebSocket).toHaveBeenCalled();
                done();
            }, 1500); // After reconnect delay
        });

        it('should stop reconnecting after max attempts', () => {
            wsManager = new WebSocketManager({
                url: 'wss://test.example.com',
                reconnectDelay: 100,
                maxReconnectAttempts: 2,
                pingInterval: 30000
            });

            const onCloseCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'close'
            )?.[1];

            // Trigger multiple disconnections
            for (let i = 0; i < 3; i++) {
                if (onCloseCallback) {
                    onCloseCallback(1006, 'Connection lost');
                }
            }

            // After max attempts, should stop trying
            expect(WebSocket).toHaveBeenCalledTimes(3); // Initial + 2 reconnects
        });
    });

    describe('Ping/Pong', () => {
        beforeEach(async () => {
            const connectPromise = wsManager.connect();
            const onOpenCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'open'
            )?.[1];
            if (onOpenCallback) {
                onOpenCallback();
            }
            await connectPromise;
        });

        it('should respond to ping with pong', () => {
            const onPingCallback = mockWs.on.mock.calls.find(
                (call: any) => call[0] === 'ping'
            )?.[1];

            if (onPingCallback) {
                onPingCallback();
            }

            expect(mockWs.pong).toHaveBeenCalled();
        });

        it('should send periodic pings', (done) => {
            setTimeout(() => {
                expect(mockWs.ping).toHaveBeenCalled();
                done();
            }, 31000);
        }, 32000);
    });
});
