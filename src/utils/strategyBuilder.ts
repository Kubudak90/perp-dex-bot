// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY BUILDER
// Visual strategy creation with configurable rules and conditions
// ═══════════════════════════════════════════════════════════════════════════

import { Logger } from './logger';
import { Signal, Indicators, StrategyType, MarketRegime } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────
export type IndicatorType =
    | 'SUPERTREND'
    | 'EMA'
    | 'SMA'
    | 'RSI'
    | 'MACD'
    | 'ADX'
    | 'ATR'
    | 'BOLLINGER'
    | 'VOLUME'
    | 'PRICE';

export type ConditionOperator =
    | 'ABOVE'
    | 'BELOW'
    | 'CROSSES_ABOVE'
    | 'CROSSES_BELOW'
    | 'EQUALS'
    | 'BETWEEN'
    | 'INCREASING'
    | 'DECREASING';

export type LogicalOperator = 'AND' | 'OR';

export interface IndicatorConfig {
    type: IndicatorType;
    period?: number;
    multiplier?: number;
    source?: 'close' | 'open' | 'high' | 'low' | 'hlc3' | 'ohlc4';
    // Specific params
    fastPeriod?: number;
    slowPeriod?: number;
    signalPeriod?: number;
    stdDev?: number;
}

export interface Condition {
    id: string;
    leftIndicator: IndicatorConfig;
    operator: ConditionOperator;
    rightIndicator?: IndicatorConfig;
    rightValue?: number;
    enabled: boolean;
}

export interface ConditionGroup {
    id: string;
    name: string;
    conditions: Condition[];
    logicalOperator: LogicalOperator;
    enabled: boolean;
}

export interface EntryRule {
    signal: 'LONG' | 'SHORT';
    conditionGroups: ConditionGroup[];
    groupOperator: LogicalOperator;
    filters?: {
        timeFilter?: {
            enabled: boolean;
            allowedHours?: number[];
            allowedDays?: number[]; // 0=Sunday, 6=Saturday
        };
        regimeFilter?: {
            enabled: boolean;
            allowedRegimes?: MarketRegime[];
        };
        volumeFilter?: {
            enabled: boolean;
            minRatio?: number;
            maxRatio?: number;
        };
    };
}

export interface ExitRule {
    type: 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP' | 'TIME_EXIT' | 'SIGNAL_EXIT';
    enabled: boolean;
    // Stop Loss
    slType?: 'FIXED_PERCENT' | 'ATR_BASED' | 'SWING_LOW';
    slValue?: number;
    slAtrMultiplier?: number;
    // Take Profit
    tpType?: 'FIXED_PERCENT' | 'ATR_BASED' | 'RR_RATIO';
    tpValue?: number;
    tpAtrMultiplier?: number;
    tpRrRatio?: number;
    // Trailing Stop
    trailType?: 'PERCENT' | 'ATR';
    trailValue?: number;
    trailActivation?: number; // Activate after X% profit
    // Time Exit
    maxHoldBars?: number;
    maxHoldHours?: number;
    // Signal Exit
    exitConditions?: ConditionGroup[];
}

export interface CustomStrategy {
    id: string;
    name: string;
    description: string;
    version: number;
    createdAt: number;
    updatedAt: number;
    enabled: boolean;
    // Entry Rules
    longEntry: EntryRule;
    shortEntry: EntryRule;
    // Exit Rules
    exitRules: ExitRule[];
    // Risk Management
    riskConfig: {
        maxPositionPercent: number;
        maxDailyLoss: number;
        maxDailyTrades: number;
        defaultLeverage: number;
    };
    // Backtest Results
    backtestResults?: {
        winRate: number;
        profitFactor: number;
        sharpeRatio: number;
        maxDrawdown: number;
        totalTrades: number;
        lastTested: number;
    };
}

export interface StrategyTemplate {
    id: string;
    name: string;
    description: string;
    category: 'TREND' | 'MEAN_REVERSION' | 'BREAKOUT' | 'SCALPING' | 'SWING';
    strategy: Partial<CustomStrategy>;
}

// ─────────────────────────────────────────────────────────────────────────
// PRE-BUILT TEMPLATES
// ─────────────────────────────────────────────────────────────────────────
export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
    {
        id: 'supertrend-ema',
        name: 'Supertrend + EMA Crossover',
        description: 'Classic trend-following strategy using Supertrend with EMA confirmation',
        category: 'TREND',
        strategy: {
            name: 'Supertrend + EMA',
            longEntry: {
                signal: 'LONG',
                conditionGroups: [
                    {
                        id: 'trend-group',
                        name: 'Trend Conditions',
                        conditions: [
                            {
                                id: 'st-bullish',
                                leftIndicator: { type: 'SUPERTREND', period: 10, multiplier: 3 },
                                operator: 'EQUALS',
                                rightValue: 1, // 1 = bullish
                                enabled: true
                            },
                            {
                                id: 'ema-cross',
                                leftIndicator: { type: 'EMA', period: 50 },
                                operator: 'ABOVE',
                                rightIndicator: { type: 'EMA', period: 200 },
                                enabled: true
                            }
                        ],
                        logicalOperator: 'AND',
                        enabled: true
                    }
                ],
                groupOperator: 'AND'
            },
            shortEntry: {
                signal: 'SHORT',
                conditionGroups: [
                    {
                        id: 'trend-group',
                        name: 'Trend Conditions',
                        conditions: [
                            {
                                id: 'st-bearish',
                                leftIndicator: { type: 'SUPERTREND', period: 10, multiplier: 3 },
                                operator: 'EQUALS',
                                rightValue: -1, // -1 = bearish
                                enabled: true
                            },
                            {
                                id: 'ema-cross',
                                leftIndicator: { type: 'EMA', period: 50 },
                                operator: 'BELOW',
                                rightIndicator: { type: 'EMA', period: 200 },
                                enabled: true
                            }
                        ],
                        logicalOperator: 'AND',
                        enabled: true
                    }
                ],
                groupOperator: 'AND'
            },
            exitRules: [
                {
                    type: 'STOP_LOSS',
                    enabled: true,
                    slType: 'ATR_BASED',
                    slAtrMultiplier: 1.5
                },
                {
                    type: 'TAKE_PROFIT',
                    enabled: true,
                    tpType: 'RR_RATIO',
                    tpRrRatio: 1.5
                }
            ],
            riskConfig: {
                maxPositionPercent: 20,
                maxDailyLoss: 3,
                maxDailyTrades: 3,
                defaultLeverage: 3
            }
        }
    },
    {
        id: 'rsi-mean-reversion',
        name: 'RSI Mean Reversion',
        description: 'Buy oversold, sell overbought with RSI extremes',
        category: 'MEAN_REVERSION',
        strategy: {
            name: 'RSI Mean Reversion',
            longEntry: {
                signal: 'LONG',
                conditionGroups: [
                    {
                        id: 'oversold',
                        name: 'Oversold Condition',
                        conditions: [
                            {
                                id: 'rsi-low',
                                leftIndicator: { type: 'RSI', period: 14 },
                                operator: 'BELOW',
                                rightValue: 30,
                                enabled: true
                            }
                        ],
                        logicalOperator: 'AND',
                        enabled: true
                    }
                ],
                groupOperator: 'AND'
            },
            shortEntry: {
                signal: 'SHORT',
                conditionGroups: [
                    {
                        id: 'overbought',
                        name: 'Overbought Condition',
                        conditions: [
                            {
                                id: 'rsi-high',
                                leftIndicator: { type: 'RSI', period: 14 },
                                operator: 'ABOVE',
                                rightValue: 70,
                                enabled: true
                            }
                        ],
                        logicalOperator: 'AND',
                        enabled: true
                    }
                ],
                groupOperator: 'AND'
            },
            exitRules: [
                {
                    type: 'STOP_LOSS',
                    enabled: true,
                    slType: 'FIXED_PERCENT',
                    slValue: 2
                },
                {
                    type: 'SIGNAL_EXIT',
                    enabled: true,
                    exitConditions: [
                        {
                            id: 'rsi-exit',
                            name: 'RSI Neutral',
                            conditions: [
                                {
                                    id: 'rsi-mid',
                                    leftIndicator: { type: 'RSI', period: 14 },
                                    operator: 'BETWEEN',
                                    rightValue: 50,
                                    enabled: true
                                }
                            ],
                            logicalOperator: 'AND',
                            enabled: true
                        }
                    ]
                }
            ],
            riskConfig: {
                maxPositionPercent: 15,
                maxDailyLoss: 2,
                maxDailyTrades: 5,
                defaultLeverage: 2
            }
        }
    },
    {
        id: 'bollinger-breakout',
        name: 'Bollinger Breakout',
        description: 'Trade breakouts from Bollinger Bands with volume confirmation',
        category: 'BREAKOUT',
        strategy: {
            name: 'Bollinger Breakout',
            longEntry: {
                signal: 'LONG',
                conditionGroups: [
                    {
                        id: 'breakout-up',
                        name: 'Upside Breakout',
                        conditions: [
                            {
                                id: 'bb-upper',
                                leftIndicator: { type: 'PRICE', source: 'close' },
                                operator: 'CROSSES_ABOVE',
                                rightIndicator: { type: 'BOLLINGER', period: 20, stdDev: 2 },
                                enabled: true
                            },
                            {
                                id: 'volume-confirm',
                                leftIndicator: { type: 'VOLUME' },
                                operator: 'ABOVE',
                                rightValue: 1.5, // 1.5x average
                                enabled: true
                            }
                        ],
                        logicalOperator: 'AND',
                        enabled: true
                    }
                ],
                groupOperator: 'AND',
                filters: {
                    volumeFilter: {
                        enabled: true,
                        minRatio: 1.2
                    }
                }
            },
            shortEntry: {
                signal: 'SHORT',
                conditionGroups: [
                    {
                        id: 'breakout-down',
                        name: 'Downside Breakout',
                        conditions: [
                            {
                                id: 'bb-lower',
                                leftIndicator: { type: 'PRICE', source: 'close' },
                                operator: 'CROSSES_BELOW',
                                rightIndicator: { type: 'BOLLINGER', period: 20, stdDev: 2 },
                                enabled: true
                            },
                            {
                                id: 'volume-confirm',
                                leftIndicator: { type: 'VOLUME' },
                                operator: 'ABOVE',
                                rightValue: 1.5,
                                enabled: true
                            }
                        ],
                        logicalOperator: 'AND',
                        enabled: true
                    }
                ],
                groupOperator: 'AND',
                filters: {
                    volumeFilter: {
                        enabled: true,
                        minRatio: 1.2
                    }
                }
            },
            exitRules: [
                {
                    type: 'TRAILING_STOP',
                    enabled: true,
                    trailType: 'PERCENT',
                    trailValue: 1.5,
                    trailActivation: 1
                },
                {
                    type: 'TIME_EXIT',
                    enabled: true,
                    maxHoldHours: 4
                }
            ],
            riskConfig: {
                maxPositionPercent: 25,
                maxDailyLoss: 4,
                maxDailyTrades: 4,
                defaultLeverage: 5
            }
        }
    }
];

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY BUILDER SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class StrategyBuilder {
    private logger: Logger;
    private strategies: Map<string, CustomStrategy> = new Map();
    private activeStrategyId: string | null = null;

    constructor() {
        this.logger = new Logger('StrategyBuilder');
    }

    // ─────────────────────────────────────────────────────────────────────
    // STRATEGY CRUD
    // ─────────────────────────────────────────────────────────────────────
    createStrategy(name: string, description: string = ''): CustomStrategy {
        const id = `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const strategy: CustomStrategy = {
            id,
            name,
            description,
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            enabled: true,
            longEntry: this.createEmptyEntryRule('LONG'),
            shortEntry: this.createEmptyEntryRule('SHORT'),
            exitRules: [
                { type: 'STOP_LOSS', enabled: true, slType: 'ATR_BASED', slAtrMultiplier: 1.5 },
                { type: 'TAKE_PROFIT', enabled: true, tpType: 'RR_RATIO', tpRrRatio: 1.5 }
            ],
            riskConfig: {
                maxPositionPercent: 20,
                maxDailyLoss: 3,
                maxDailyTrades: 3,
                defaultLeverage: 3
            }
        };

        this.strategies.set(id, strategy);
        this.logger.info(`Strategy created: ${name} (${id})`);

        return strategy;
    }

    createFromTemplate(templateId: string): CustomStrategy | null {
        const template = STRATEGY_TEMPLATES.find(t => t.id === templateId);
        if (!template) {
            this.logger.warn(`Template not found: ${templateId}`);
            return null;
        }

        const id = `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const strategy: CustomStrategy = {
            id,
            name: template.strategy.name || template.name,
            description: template.description,
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            enabled: true,
            longEntry: template.strategy.longEntry || this.createEmptyEntryRule('LONG'),
            shortEntry: template.strategy.shortEntry || this.createEmptyEntryRule('SHORT'),
            exitRules: template.strategy.exitRules || [],
            riskConfig: template.strategy.riskConfig || {
                maxPositionPercent: 20,
                maxDailyLoss: 3,
                maxDailyTrades: 3,
                defaultLeverage: 3
            }
        };

        this.strategies.set(id, strategy);
        this.logger.info(`Strategy created from template: ${template.name}`);

        return strategy;
    }

    private createEmptyEntryRule(signal: 'LONG' | 'SHORT'): EntryRule {
        return {
            signal,
            conditionGroups: [],
            groupOperator: 'AND'
        };
    }

    getStrategy(id: string): CustomStrategy | null {
        return this.strategies.get(id) || null;
    }

    getAllStrategies(): CustomStrategy[] {
        return Array.from(this.strategies.values());
    }

    updateStrategy(id: string, updates: Partial<CustomStrategy>): CustomStrategy | null {
        const strategy = this.strategies.get(id);
        if (!strategy) return null;

        const updated = {
            ...strategy,
            ...updates,
            id: strategy.id, // Prevent ID change
            version: strategy.version + 1,
            updatedAt: Date.now()
        };

        this.strategies.set(id, updated);
        this.logger.info(`Strategy updated: ${updated.name} (v${updated.version})`);

        return updated;
    }

    deleteStrategy(id: string): boolean {
        if (this.activeStrategyId === id) {
            this.activeStrategyId = null;
        }
        const deleted = this.strategies.delete(id);
        if (deleted) {
            this.logger.info(`Strategy deleted: ${id}`);
        }
        return deleted;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CONDITION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────
    addConditionGroup(strategyId: string, entryType: 'LONG' | 'SHORT', group: ConditionGroup): boolean {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return false;

        const entry = entryType === 'LONG' ? strategy.longEntry : strategy.shortEntry;
        entry.conditionGroups.push(group);
        strategy.updatedAt = Date.now();

        return true;
    }

    addCondition(strategyId: string, entryType: 'LONG' | 'SHORT', groupId: string, condition: Condition): boolean {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return false;

        const entry = entryType === 'LONG' ? strategy.longEntry : strategy.shortEntry;
        const group = entry.conditionGroups.find(g => g.id === groupId);
        if (!group) return false;

        group.conditions.push(condition);
        strategy.updatedAt = Date.now();

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACTIVE STRATEGY
    // ─────────────────────────────────────────────────────────────────────
    setActiveStrategy(id: string): boolean {
        if (!this.strategies.has(id)) return false;
        this.activeStrategyId = id;
        this.logger.info(`Active strategy set: ${this.strategies.get(id)?.name}`);
        return true;
    }

    getActiveStrategy(): CustomStrategy | null {
        if (!this.activeStrategyId) return null;
        return this.strategies.get(this.activeStrategyId) || null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SIGNAL GENERATION
    // ─────────────────────────────────────────────────────────────────────
    generateSignal(indicators: Indicators, currentPrice: number): Signal {
        const strategy = this.getActiveStrategy();
        if (!strategy || !strategy.enabled) return 'NONE';

        // Check long entry
        if (this.evaluateEntryRule(strategy.longEntry, indicators, currentPrice)) {
            return 'LONG';
        }

        // Check short entry
        if (this.evaluateEntryRule(strategy.shortEntry, indicators, currentPrice)) {
            return 'SHORT';
        }

        return 'NONE';
    }

    private evaluateEntryRule(rule: EntryRule, indicators: Indicators, price: number): boolean {
        if (rule.conditionGroups.length === 0) return false;

        const results = rule.conditionGroups
            .filter(g => g.enabled)
            .map(group => this.evaluateConditionGroup(group, indicators, price));

        if (results.length === 0) return false;

        return rule.groupOperator === 'AND'
            ? results.every(r => r)
            : results.some(r => r);
    }

    private evaluateConditionGroup(group: ConditionGroup, indicators: Indicators, price: number): boolean {
        const results = group.conditions
            .filter(c => c.enabled)
            .map(condition => this.evaluateCondition(condition, indicators, price));

        if (results.length === 0) return false;

        return group.logicalOperator === 'AND'
            ? results.every(r => r)
            : results.some(r => r);
    }

    private evaluateCondition(condition: Condition, indicators: Indicators, price: number): boolean {
        const leftValue = this.getIndicatorValue(condition.leftIndicator, indicators, price);
        const rightValue = condition.rightIndicator
            ? this.getIndicatorValue(condition.rightIndicator, indicators, price)
            : condition.rightValue || 0;

        switch (condition.operator) {
            case 'ABOVE':
                return leftValue > rightValue;
            case 'BELOW':
                return leftValue < rightValue;
            case 'EQUALS':
                return Math.abs(leftValue - rightValue) < 0.0001;
            case 'BETWEEN':
                // rightValue is center, assume +/- 10 range
                return leftValue >= rightValue - 10 && leftValue <= rightValue + 10;
            case 'CROSSES_ABOVE':
            case 'CROSSES_BELOW':
            case 'INCREASING':
            case 'DECREASING':
                // These need historical data, simplified for now
                return condition.operator === 'CROSSES_ABOVE' ? leftValue > rightValue : leftValue < rightValue;
            default:
                return false;
        }
    }

    private getIndicatorValue(config: IndicatorConfig, indicators: Indicators, price: number): number {
        switch (config.type) {
            case 'SUPERTREND':
                return indicators.supertrend.trend === 'LONG' ? 1 : -1;
            case 'EMA':
                if (config.period === 50) return indicators.ema50;
                if (config.period === 200) return indicators.ema200;
                return indicators.ema50;
            case 'ADX':
                return indicators.adx;
            case 'ATR':
                return indicators.atr;
            case 'PRICE':
                return price;
            case 'VOLUME':
                return indicators.volume?.ratio || 1;
            case 'RSI':
                // Would need RSI in indicators, return neutral for now
                return 50;
            default:
                return 0;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEMPLATES
    // ─────────────────────────────────────────────────────────────────────
    getTemplates(): StrategyTemplate[] {
        return STRATEGY_TEMPLATES;
    }

    getTemplatesByCategory(category: StrategyTemplate['category']): StrategyTemplate[] {
        return STRATEGY_TEMPLATES.filter(t => t.category === category);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SERIALIZATION
    // ─────────────────────────────────────────────────────────────────────
    toJSON(): object {
        return {
            strategies: Array.from(this.strategies.entries()),
            activeStrategyId: this.activeStrategyId
        };
    }

    static fromJSON(data: any): StrategyBuilder {
        const builder = new StrategyBuilder();
        for (const [key, value] of data.strategies || []) {
            builder.strategies.set(key, value as CustomStrategy);
        }
        builder.activeStrategyId = data.activeStrategyId || null;
        return builder;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT SINGLETON
// ─────────────────────────────────────────────────────────────────────────
export const strategyBuilder = new StrategyBuilder();
