// ═══════════════════════════════════════════════════════════════════════════
// TRADING HOURS & SESSION DETECTION (Phase 6A)
// Time-based filters for optimal trading windows
// ═══════════════════════════════════════════════════════════════════════════

export type TradingSession = 'NY' | 'LONDON' | 'ASIA' | 'WEEKEND' | 'OFF_HOURS';

export interface SessionInfo {
    session: TradingSession;
    isActiveSession: boolean;
    isWeekend: boolean;
    hourUTC: number;
    dayOfWeek: number;
}

// ─────────────────────────────────────────────────────────────────────────
// TRADING HOURS MANAGER
// ─────────────────────────────────────────────────────────────────────────
export class TradingHoursManager {

    /**
     * Get current session information
     * @param timestamp - Unix timestamp in ms (default: now)
     * @returns Session information
     */
    static getCurrentSession(timestamp: number = Date.now()): SessionInfo {
        const date = new Date(timestamp);
        const hourUTC = date.getUTCHours();
        const dayOfWeek = date.getUTCDay(); // 0=Sunday, 6=Saturday

        // Weekend detection
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        let session: TradingSession;
        let isActiveSession: boolean;

        if (isWeekend) {
            session = 'WEEKEND';
            isActiveSession = false;
        } else {
            // Session times (UTC):
            // ASIA: 00:00-08:00 UTC
            // LONDON: 08:00-16:00 UTC
            // NY: 13:00-21:00 UTC (overlap with London 13:00-16:00)

            if (hourUTC >= 13 && hourUTC < 21) {
                session = 'NY';          // NY session (13:00-21:00 UTC)
                isActiveSession = true;
            } else if (hourUTC >= 8 && hourUTC < 16) {
                session = 'LONDON';      // London session (08:00-16:00 UTC)
                isActiveSession = true;
            } else if (hourUTC >= 0 && hourUTC < 8) {
                session = 'ASIA';        // Asia session (00:00-08:00 UTC)
                isActiveSession = true;  // Can be disabled based on volume
            } else {
                session = 'OFF_HOURS';   // 21:00-00:00 UTC (low activity)
                isActiveSession = false;
            }
        }

        return {
            session,
            isActiveSession,
            isWeekend,
            hourUTC,
            dayOfWeek
        };
    }

    /**
     * Check if trading is allowed based on session filters
     * @param allowedSessions - Array of allowed sessions
     * @param avoidWeekends - Skip weekend trading
     * @param timestamp - Unix timestamp in ms (default: now)
     * @returns true if trading is allowed
     */
    static isTradingAllowed(
        allowedSessions: TradingSession[],
        avoidWeekends: boolean = true,
        timestamp: number = Date.now()
    ): boolean {
        const sessionInfo = this.getCurrentSession(timestamp);

        // Weekend filter
        if (avoidWeekends && sessionInfo.isWeekend) {
            return false;
        }

        // Session filter
        return allowedSessions.includes(sessionInfo.session);
    }

    /**
     * Get session name for logging
     */
    static getSessionName(timestamp: number = Date.now()): string {
        const info = this.getCurrentSession(timestamp);

        if (info.isWeekend) {
            return `WEEKEND (${info.hourUTC}:00 UTC)`;
        }

        return `${info.session} (${info.hourUTC}:00 UTC)`;
    }

    /**
     * Get high-liquidity session periods
     * Returns true during NY/London sessions or their overlap
     */
    static isHighLiquidityPeriod(timestamp: number = Date.now()): boolean {
        const info = this.getCurrentSession(timestamp);

        if (info.isWeekend) return false;

        // High liquidity: London (08:00-16:00) or NY (13:00-21:00)
        // Overlap period (13:00-16:00) is highest liquidity
        return info.session === 'NY' || info.session === 'LONDON';
    }

    /**
     * Check if currently in overlap period (highest liquidity)
     * London + NY overlap: 13:00-16:00 UTC
     */
    static isOverlapPeriod(timestamp: number = Date.now()): boolean {
        const hourUTC = new Date(timestamp).getUTCHours();
        const dayOfWeek = new Date(timestamp).getUTCDay();

        // Not weekend and during overlap hours
        return dayOfWeek !== 0 && dayOfWeek !== 6 && hourUTC >= 13 && hourUTC < 16;
    }
}
