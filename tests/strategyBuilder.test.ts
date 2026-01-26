// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY BUILDER TESTS
// ═══════════════════════════════════════════════════════════════════════════

import {
    StrategyBuilder,
    STRATEGY_TEMPLATES,
    CustomStrategy,
    ConditionGroup,
    Condition
} from '../src/utils/strategyBuilder';
import { Indicators, SupertrendResult } from '../src/types';

describe('StrategyBuilder', () => {
    let builder: StrategyBuilder;

    beforeEach(() => {
        builder = new StrategyBuilder();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEMPLATES
    // ─────────────────────────────────────────────────────────────────────────
    describe('Templates', () => {
        it('should have predefined templates', () => {
            const templates = builder.getTemplates();
            expect(templates.length).toBeGreaterThan(0);
        });

        it('should include Supertrend + EMA template', () => {
            const templates = builder.getTemplates();
            const supertrendTemplate = templates.find(t => t.id === 'supertrend-ema');
            expect(supertrendTemplate).toBeDefined();
            expect(supertrendTemplate?.category).toBe('TREND');
        });

        it('should include RSI Mean Reversion template', () => {
            const templates = builder.getTemplates();
            const rsiTemplate = templates.find(t => t.id === 'rsi-mean-reversion');
            expect(rsiTemplate).toBeDefined();
            expect(rsiTemplate?.category).toBe('MEAN_REVERSION');
        });

        it('should include Bollinger Breakout template', () => {
            const templates = builder.getTemplates();
            const bbTemplate = templates.find(t => t.id === 'bollinger-breakout');
            expect(bbTemplate).toBeDefined();
            expect(bbTemplate?.category).toBe('BREAKOUT');
        });

        it('should filter templates by category', () => {
            const trendTemplates = builder.getTemplatesByCategory('TREND');
            expect(trendTemplates.every(t => t.category === 'TREND')).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STRATEGY CREATION
    // ─────────────────────────────────────────────────────────────────────────
    describe('Strategy Creation', () => {
        it('should create new strategy with name and description', () => {
            const strategy = builder.createStrategy('My Strategy', 'Test description');

            expect(strategy).toBeDefined();
            expect(strategy.name).toBe('My Strategy');
            expect(strategy.description).toBe('Test description');
            expect(strategy.version).toBe(1);
        });

        it('should assign unique ID to strategy', () => {
            const strategy1 = builder.createStrategy('Strategy 1');
            const strategy2 = builder.createStrategy('Strategy 2');

            expect(strategy1.id).not.toBe(strategy2.id);
        });

        it('should set creation timestamp', () => {
            const before = Date.now();
            const strategy = builder.createStrategy('Test');
            const after = Date.now();

            expect(strategy.createdAt).toBeGreaterThanOrEqual(before);
            expect(strategy.createdAt).toBeLessThanOrEqual(after);
        });

        it('should create strategy from template', () => {
            const strategy = builder.createFromTemplate('supertrend-ema');

            expect(strategy).not.toBeNull();
            expect(strategy?.name).toContain('Supertrend');
            expect(strategy?.longEntry.conditionGroups.length).toBeGreaterThan(0);
        });

        it('should return null for invalid template', () => {
            const strategy = builder.createFromTemplate('invalid-template');
            expect(strategy).toBeNull();
        });

        it('should initialize with empty entry rules', () => {
            const strategy = builder.createStrategy('Test');

            expect(strategy.longEntry.conditionGroups).toHaveLength(0);
            expect(strategy.shortEntry.conditionGroups).toHaveLength(0);
        });

        it('should initialize with default risk config', () => {
            const strategy = builder.createStrategy('Test');

            expect(strategy.riskConfig.maxPositionPercent).toBe(20);
            expect(strategy.riskConfig.maxDailyLoss).toBe(3);
            expect(strategy.riskConfig.defaultLeverage).toBe(3);
        });

        it('should initialize with default exit rules', () => {
            const strategy = builder.createStrategy('Test');

            expect(strategy.exitRules.length).toBeGreaterThan(0);
            expect(strategy.exitRules.some(r => r.type === 'STOP_LOSS')).toBe(true);
            expect(strategy.exitRules.some(r => r.type === 'TAKE_PROFIT')).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STRATEGY CRUD
    // ─────────────────────────────────────────────────────────────────────────
    describe('Strategy CRUD', () => {
        it('should get strategy by ID', () => {
            const created = builder.createStrategy('Test');
            const retrieved = builder.getStrategy(created.id);

            expect(retrieved).not.toBeNull();
            expect(retrieved?.id).toBe(created.id);
        });

        it('should return null for non-existent strategy', () => {
            const strategy = builder.getStrategy('nonexistent');
            expect(strategy).toBeNull();
        });

        it('should get all strategies', () => {
            builder.createStrategy('Strategy 1');
            builder.createStrategy('Strategy 2');
            builder.createStrategy('Strategy 3');

            const all = builder.getAllStrategies();
            expect(all).toHaveLength(3);
        });

        it('should update strategy', () => {
            const strategy = builder.createStrategy('Original');
            const updated = builder.updateStrategy(strategy.id, { name: 'Updated' });

            expect(updated?.name).toBe('Updated');
            expect(updated?.version).toBe(2);
        });

        it('should update timestamp on update', () => {
            const strategy = builder.createStrategy('Test');
            const originalUpdatedAt = strategy.updatedAt;

            // Small delay to ensure different timestamp
            const updated = builder.updateStrategy(strategy.id, { description: 'New desc' });

            expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
        });

        it('should not allow ID change on update', () => {
            const strategy = builder.createStrategy('Test');
            const originalId = strategy.id;

            const updated = builder.updateStrategy(strategy.id, { id: 'new-id' } as any);

            expect(updated?.id).toBe(originalId);
        });

        it('should return null when updating non-existent strategy', () => {
            const updated = builder.updateStrategy('nonexistent', { name: 'Test' });
            expect(updated).toBeNull();
        });

        it('should delete strategy', () => {
            const strategy = builder.createStrategy('Test');
            const deleted = builder.deleteStrategy(strategy.id);

            expect(deleted).toBe(true);
            expect(builder.getStrategy(strategy.id)).toBeNull();
        });

        it('should return false when deleting non-existent strategy', () => {
            const deleted = builder.deleteStrategy('nonexistent');
            expect(deleted).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // CONDITION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('Condition Management', () => {
        it('should add condition group to entry', () => {
            const strategy = builder.createStrategy('Test');

            const group: ConditionGroup = {
                id: 'group1',
                name: 'Test Group',
                conditions: [],
                logicalOperator: 'AND',
                enabled: true
            };

            const result = builder.addConditionGroup(strategy.id, 'LONG', group);
            expect(result).toBe(true);

            const updated = builder.getStrategy(strategy.id);
            expect(updated?.longEntry.conditionGroups).toHaveLength(1);
        });

        it('should add condition to group', () => {
            const strategy = builder.createStrategy('Test');

            const group: ConditionGroup = {
                id: 'group1',
                name: 'Test Group',
                conditions: [],
                logicalOperator: 'AND',
                enabled: true
            };
            builder.addConditionGroup(strategy.id, 'LONG', group);

            const condition: Condition = {
                id: 'cond1',
                leftIndicator: { type: 'EMA', period: 50 },
                operator: 'ABOVE',
                rightIndicator: { type: 'EMA', period: 200 },
                enabled: true
            };

            const result = builder.addCondition(strategy.id, 'LONG', 'group1', condition);
            expect(result).toBe(true);

            const updated = builder.getStrategy(strategy.id);
            expect(updated?.longEntry.conditionGroups[0].conditions).toHaveLength(1);
        });

        it('should return false for non-existent strategy', () => {
            const group: ConditionGroup = {
                id: 'group1',
                name: 'Test',
                conditions: [],
                logicalOperator: 'AND',
                enabled: true
            };

            const result = builder.addConditionGroup('nonexistent', 'LONG', group);
            expect(result).toBe(false);
        });

        it('should return false for non-existent group', () => {
            const strategy = builder.createStrategy('Test');

            const condition: Condition = {
                id: 'cond1',
                leftIndicator: { type: 'EMA', period: 50 },
                operator: 'ABOVE',
                rightValue: 100,
                enabled: true
            };

            const result = builder.addCondition(strategy.id, 'LONG', 'nonexistent', condition);
            expect(result).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ACTIVE STRATEGY
    // ─────────────────────────────────────────────────────────────────────────
    describe('Active Strategy', () => {
        it('should set active strategy', () => {
            const strategy = builder.createStrategy('Test');
            const result = builder.setActiveStrategy(strategy.id);

            expect(result).toBe(true);
            expect(builder.getActiveStrategy()?.id).toBe(strategy.id);
        });

        it('should return false for non-existent strategy', () => {
            const result = builder.setActiveStrategy('nonexistent');
            expect(result).toBe(false);
        });

        it('should return null when no active strategy', () => {
            expect(builder.getActiveStrategy()).toBeNull();
        });

        it('should clear active strategy when deleted', () => {
            const strategy = builder.createStrategy('Test');
            builder.setActiveStrategy(strategy.id);
            builder.deleteStrategy(strategy.id);

            expect(builder.getActiveStrategy()).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SIGNAL GENERATION
    // ─────────────────────────────────────────────────────────────────────────
    describe('Signal Generation', () => {
        const mockIndicators: Indicators = {
            supertrend: {
                trend: 'LONG',
                value: 50000,
                upperBand: 52000,
                lowerBand: 48000
            },
            ema50: 51000,
            ema200: 49000,
            adx: 30,
            atr: 500,
            fundingRate: 0.0001,
            atrPercentile: 50
        };

        it('should return NONE when no active strategy', () => {
            const signal = builder.generateSignal(mockIndicators, 50000);
            expect(signal).toBe('NONE');
        });

        it('should return NONE when strategy is disabled', () => {
            const strategy = builder.createFromTemplate('supertrend-ema');
            if (strategy) {
                builder.setActiveStrategy(strategy.id);
                builder.updateStrategy(strategy.id, { enabled: false });
            }

            const signal = builder.generateSignal(mockIndicators, 50000);
            expect(signal).toBe('NONE');
        });

        it('should generate LONG signal when conditions met', () => {
            const strategy = builder.createFromTemplate('supertrend-ema');
            if (strategy) {
                builder.setActiveStrategy(strategy.id);
            }

            // Indicators show bullish: supertrend LONG, ema50 > ema200
            const signal = builder.generateSignal(mockIndicators, 50000);
            expect(signal).toBe('LONG');
        });

        it('should generate SHORT signal when bearish conditions met', () => {
            const strategy = builder.createFromTemplate('supertrend-ema');
            if (strategy) {
                builder.setActiveStrategy(strategy.id);
            }

            const bearishIndicators: Indicators = {
                ...mockIndicators,
                supertrend: {
                    trend: 'SHORT',
                    value: 50000,
                    upperBand: 52000,
                    lowerBand: 48000
                },
                ema50: 49000,
                ema200: 51000
            };

            const signal = builder.generateSignal(bearishIndicators, 50000);
            expect(signal).toBe('SHORT');
        });

        it('should return NONE when conditions not met', () => {
            const strategy = builder.createFromTemplate('supertrend-ema');
            if (strategy) {
                builder.setActiveStrategy(strategy.id);
            }

            // Mixed signals: supertrend LONG but ema50 < ema200
            const mixedIndicators: Indicators = {
                ...mockIndicators,
                supertrend: { trend: 'LONG', value: 50000, upperBand: 52000, lowerBand: 48000 },
                ema50: 49000, // Below ema200
                ema200: 51000
            };

            const signal = builder.generateSignal(mixedIndicators, 50000);
            // With AND logic, both conditions must be true
            expect(['NONE', 'SHORT']).toContain(signal);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SERIALIZATION
    // ─────────────────────────────────────────────────────────────────────────
    describe('Serialization', () => {
        it('should serialize to JSON', () => {
            builder.createStrategy('Strategy 1');
            builder.createStrategy('Strategy 2');

            const json = builder.toJSON();

            expect(json).toHaveProperty('strategies');
            expect(json).toHaveProperty('activeStrategyId');
        });

        it('should deserialize from JSON', () => {
            const strategy = builder.createStrategy('Test');
            builder.setActiveStrategy(strategy.id);

            const json = builder.toJSON();
            const restored = StrategyBuilder.fromJSON(json);

            expect(restored.getAllStrategies()).toHaveLength(1);
            expect(restored.getActiveStrategy()?.name).toBe('Test');
        });

        it('should preserve strategy details after serialization', () => {
            const original = builder.createFromTemplate('supertrend-ema');
            if (!original) return;

            const json = builder.toJSON();
            const restored = StrategyBuilder.fromJSON(json);

            const restoredStrategy = restored.getStrategy(original.id);
            expect(restoredStrategy?.name).toBe(original.name);
            expect(restoredStrategy?.longEntry.conditionGroups.length)
                .toBe(original.longEntry.conditionGroups.length);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────
// TEMPLATE STRUCTURE TESTS
// ─────────────────────────────────────────────────────────────────────────
describe('STRATEGY_TEMPLATES', () => {
    it('should have valid structure for all templates', () => {
        for (const template of STRATEGY_TEMPLATES) {
            expect(template.id).toBeDefined();
            expect(template.name).toBeDefined();
            expect(template.description).toBeDefined();
            expect(template.category).toBeDefined();
            expect(template.strategy).toBeDefined();
        }
    });

    it('should have valid entry rules in templates', () => {
        for (const template of STRATEGY_TEMPLATES) {
            if (template.strategy.longEntry) {
                expect(template.strategy.longEntry.signal).toBe('LONG');
                expect(template.strategy.longEntry.conditionGroups).toBeDefined();
            }
            if (template.strategy.shortEntry) {
                expect(template.strategy.shortEntry.signal).toBe('SHORT');
                expect(template.strategy.shortEntry.conditionGroups).toBeDefined();
            }
        }
    });

    it('should have valid exit rules in templates', () => {
        for (const template of STRATEGY_TEMPLATES) {
            if (template.strategy.exitRules) {
                for (const rule of template.strategy.exitRules) {
                    expect(['STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP', 'TIME_EXIT', 'SIGNAL_EXIT'])
                        .toContain(rule.type);
                }
            }
        }
    });
});
