// ═══════════════════════════════════════════════════════════════════════════
// POSITION STATE MACHINE
// Manages position lifecycle with explicit state transitions
// ═══════════════════════════════════════════════════════════════════════════

import { PositionState, ExitReason, SignalType } from './constants';
import { Position, TradeResult } from '../types';
import { Logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────
// STATE TRANSITION DEFINITIONS
// Valid transitions: [fromState] -> [toState[]]
// ─────────────────────────────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<PositionState, PositionState[]> = {
    [PositionState.IDLE]: [
        PositionState.PENDING_ENTRY
    ],
    [PositionState.PENDING_ENTRY]: [
        PositionState.OPEN,
        PositionState.IDLE // Order cancelled/failed
    ],
    [PositionState.OPEN]: [
        PositionState.PARTIAL_CLOSED,
        PositionState.PENDING_EXIT
    ],
    [PositionState.PARTIAL_CLOSED]: [
        PositionState.PARTIAL_CLOSED, // Multiple partial TPs
        PositionState.PENDING_EXIT
    ],
    [PositionState.PENDING_EXIT]: [
        PositionState.CLOSED,
        PositionState.OPEN // Exit order failed
    ],
    [PositionState.CLOSED]: [
        PositionState.IDLE
    ]
};

// ─────────────────────────────────────────────────────────────────────────
// STATE EVENT TYPES
// ─────────────────────────────────────────────────────────────────────────
export type StateEvent =
    | { type: 'ENTRY_SIGNAL'; signal: SignalType }
    | { type: 'ORDER_FILLED'; price: number; size: number }
    | { type: 'ORDER_CANCELLED'; reason: string }
    | { type: 'PARTIAL_TP_HIT'; level: number; price: number }
    | { type: 'EXIT_SIGNAL'; reason: ExitReason }
    | { type: 'POSITION_CLOSED'; result: TradeResult }
    | { type: 'RESET' };

// ─────────────────────────────────────────────────────────────────────────
// POSITION STATE DATA
// ─────────────────────────────────────────────────────────────────────────
export interface PositionStateData {
    state: PositionState;
    position: Position | null;
    entryOrder?: {
        side: 'LONG' | 'SHORT';
        expectedPrice: number;
        size: number;
        timestamp: number;
    };
    exitOrder?: {
        reason: ExitReason;
        expectedPrice: number;
        timestamp: number;
    };
    partialTpHit: number[];
    history: StateTransition[];
}

export interface StateTransition {
    from: PositionState;
    to: PositionState;
    event: StateEvent;
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────
// POSITION STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────
export class PositionStateMachine {
    private data: PositionStateData;
    private logger: Logger;
    private listeners: ((data: PositionStateData, event: StateEvent) => void)[] = [];

    constructor() {
        this.logger = new Logger('PositionStateMachine');
        this.data = this.createInitialState();
    }

    private createInitialState(): PositionStateData {
        return {
            state: PositionState.IDLE,
            position: null,
            partialTpHit: [],
            history: []
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get current state
     */
    getState(): PositionState {
        return this.data.state;
    }

    /**
     * Get current position (if any)
     */
    getPosition(): Position | null {
        return this.data.position;
    }

    /**
     * Get full state data
     */
    getData(): Readonly<PositionStateData> {
        return this.data;
    }

    /**
     * Check if can accept event
     */
    canTransition(event: StateEvent): boolean {
        const nextState = this.getNextState(event);
        return nextState !== null;
    }

    /**
     * Process an event and transition state
     */
    dispatch(event: StateEvent): boolean {
        const nextState = this.getNextState(event);

        if (nextState === null) {
            this.logger.warn(`Invalid transition: ${this.data.state} + ${event.type}`);
            return false;
        }

        this.transition(nextState, event);
        return true;
    }

    /**
     * Subscribe to state changes
     */
    subscribe(listener: (data: PositionStateData, event: StateEvent) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Check if in a tradable state (can enter new position)
     */
    canEnterPosition(): boolean {
        return this.data.state === PositionState.IDLE;
    }

    /**
     * Check if has an open position
     */
    hasPosition(): boolean {
        return this.data.state === PositionState.OPEN ||
               this.data.state === PositionState.PARTIAL_CLOSED;
    }

    /**
     * Check if position is being closed
     */
    isClosing(): boolean {
        return this.data.state === PositionState.PENDING_EXIT;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATE TRANSITION LOGIC
    // ─────────────────────────────────────────────────────────────────────────

    private getNextState(event: StateEvent): PositionState | null {
        const currentState = this.data.state;

        switch (event.type) {
            case 'ENTRY_SIGNAL':
                if (currentState === PositionState.IDLE &&
                    (event.signal === SignalType.LONG || event.signal === SignalType.SHORT)) {
                    return PositionState.PENDING_ENTRY;
                }
                break;

            case 'ORDER_FILLED':
                if (currentState === PositionState.PENDING_ENTRY) {
                    return PositionState.OPEN;
                }
                break;

            case 'ORDER_CANCELLED':
                if (currentState === PositionState.PENDING_ENTRY) {
                    return PositionState.IDLE;
                }
                if (currentState === PositionState.PENDING_EXIT) {
                    // Exit failed, back to open
                    return this.data.partialTpHit.length > 0
                        ? PositionState.PARTIAL_CLOSED
                        : PositionState.OPEN;
                }
                break;

            case 'PARTIAL_TP_HIT':
                if (currentState === PositionState.OPEN ||
                    currentState === PositionState.PARTIAL_CLOSED) {
                    return PositionState.PARTIAL_CLOSED;
                }
                break;

            case 'EXIT_SIGNAL':
                if (currentState === PositionState.OPEN ||
                    currentState === PositionState.PARTIAL_CLOSED) {
                    return PositionState.PENDING_EXIT;
                }
                break;

            case 'POSITION_CLOSED':
                if (currentState === PositionState.PENDING_EXIT) {
                    return PositionState.CLOSED;
                }
                break;

            case 'RESET':
                if (currentState === PositionState.CLOSED) {
                    return PositionState.IDLE;
                }
                break;
        }

        return null;
    }

    private transition(nextState: PositionState, event: StateEvent): void {
        const previousState = this.data.state;

        // Validate transition
        if (!VALID_TRANSITIONS[previousState].includes(nextState)) {
            throw new Error(`Invalid state transition: ${previousState} -> ${nextState}`);
        }

        // Update state data based on event
        this.updateStateData(event, nextState);

        // Record transition
        this.data.history.push({
            from: previousState,
            to: nextState,
            event,
            timestamp: Date.now()
        });

        // Keep history size manageable
        if (this.data.history.length > 100) {
            this.data.history = this.data.history.slice(-50);
        }

        this.logger.debug(`State transition: ${previousState} -> ${nextState} (${event.type})`);

        // Notify listeners
        this.notifyListeners(event);
    }

    private updateStateData(event: StateEvent, nextState: PositionState): void {
        switch (event.type) {
            case 'ENTRY_SIGNAL':
                if (event.signal === SignalType.LONG || event.signal === SignalType.SHORT) {
                    this.data.entryOrder = {
                        side: event.signal as 'LONG' | 'SHORT',
                        expectedPrice: 0,
                        size: 0,
                        timestamp: Date.now()
                    };
                }
                break;

            case 'ORDER_FILLED':
                if (this.data.entryOrder) {
                    this.data.position = {
                        side: this.data.entryOrder.side,
                        entryPrice: event.price,
                        size: event.size,
                        stopLoss: 0,
                        takeProfit: 0,
                        entryTime: Date.now(),
                        unrealizedPnl: 0,
                        initialSize: event.size,
                        remainingSize: event.size,
                        partialTpLevels: []
                    };
                    this.data.entryOrder = undefined;
                }
                break;

            case 'ORDER_CANCELLED':
                this.data.entryOrder = undefined;
                this.data.exitOrder = undefined;
                break;

            case 'PARTIAL_TP_HIT':
                if (!this.data.partialTpHit.includes(event.level)) {
                    this.data.partialTpHit.push(event.level);
                    if (this.data.position) {
                        this.data.position.partialTpLevels = [...this.data.partialTpHit];
                    }
                }
                break;

            case 'EXIT_SIGNAL':
                this.data.exitOrder = {
                    reason: event.reason,
                    expectedPrice: 0,
                    timestamp: Date.now()
                };
                break;

            case 'POSITION_CLOSED':
                this.data.exitOrder = undefined;
                break;

            case 'RESET':
                this.data.position = null;
                this.data.entryOrder = undefined;
                this.data.exitOrder = undefined;
                this.data.partialTpHit = [];
                break;
        }

        this.data.state = nextState;
    }

    private notifyListeners(event: StateEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(this.data, event);
            } catch (error) {
                this.logger.error('Listener error', error as Error);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITY METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Set position details (SL, TP, etc.)
     */
    updatePosition(updates: Partial<Position>): void {
        if (this.data.position) {
            this.data.position = { ...this.data.position, ...updates };
        }
    }

    /**
     * Get transition history
     */
    getHistory(): StateTransition[] {
        return [...this.data.history];
    }

    /**
     * Get state as string for debugging
     */
    toString(): string {
        const pos = this.data.position;
        return `PositionStateMachine {
  state: ${this.data.state}
  position: ${pos ? `${pos.side} @ $${pos.entryPrice.toFixed(2)}` : 'none'}
  partialTpHit: [${this.data.partialTpHit.join(', ')}]
  historyLength: ${this.data.history.length}
}`;
    }
}
