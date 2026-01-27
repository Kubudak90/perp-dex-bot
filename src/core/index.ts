// ═══════════════════════════════════════════════════════════════════════════
// CORE MODULE EXPORTS
// Centralized exports for core functionality
// ═══════════════════════════════════════════════════════════════════════════

// Constants & Enums
export {
    PositionState,
    SignalType,
    MarketRegime,
    TrendDirection,
    ExitReason,
    RiskLevel,
    TradingSession,
    ErrorCode,
    DEFAULTS,
    LIMITS
} from './constants';

// Validation
export {
    Result,
    ok,
    err,
    unwrap,
    ValidationError,
    Validators,
    ConfigValidator,
    TradingValidator
} from './validation';

// State Machine
export {
    PositionStateMachine,
    StateEvent,
    PositionStateData,
    StateTransition
} from './position-state-machine';
