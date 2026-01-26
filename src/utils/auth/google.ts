// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH MODULE
// Optional Google login integration
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { Logger } from '../logger';

const logger = new Logger('GoogleOAuth');

// ─────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback';

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────
export interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
    token_type: string;
    id_token?: string;
}

export interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    given_name: string;
    family_name?: string;
    picture: string;
    locale?: string;
}

export interface GoogleAuthState {
    walletAddress: string;
    nonce: string;
    createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────
// GOOGLE OAUTH SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class GoogleOAuthService {
    private stateStore: Map<string, GoogleAuthState> = new Map();
    private readonly STATE_EXPIRY = 10 * 60 * 1000; // 10 minutes

    constructor() {
        // Cleanup expired states every minute
        setInterval(() => this.cleanupExpiredStates(), 60000);
    }

    isConfigured(): boolean {
        return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
    }

    // ─────────────────────────────────────────────────────────────────────
    // AUTHORIZATION URL
    // ─────────────────────────────────────────────────────────────────────
    getAuthorizationUrl(walletAddress: string): string | null {
        if (!this.isConfigured()) {
            logger.warn('Google OAuth not configured');
            return null;
        }

        // Generate state for CSRF protection
        const nonce = crypto.randomBytes(16).toString('hex');
        const state = crypto.randomBytes(16).toString('hex');

        this.stateStore.set(state, {
            walletAddress: walletAddress.toLowerCase(),
            nonce,
            createdAt: Date.now()
        });

        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: GOOGLE_REDIRECT_URI,
            response_type: 'code',
            scope: 'openid email profile',
            state,
            access_type: 'offline',
            prompt: 'consent'
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    // ─────────────────────────────────────────────────────────────────────
    // TOKEN EXCHANGE
    // ─────────────────────────────────────────────────────────────────────
    async exchangeCodeForTokens(code: string, state: string): Promise<{ tokens: GoogleTokenResponse; walletAddress: string } | null> {
        // Verify state
        const authState = this.stateStore.get(state);
        if (!authState) {
            logger.warn('Invalid OAuth state');
            return null;
        }

        if (Date.now() - authState.createdAt > this.STATE_EXPIRY) {
            logger.warn('OAuth state expired');
            this.stateStore.delete(state);
            return null;
        }

        // Remove used state
        this.stateStore.delete(state);

        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    code,
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: GOOGLE_REDIRECT_URI,
                    grant_type: 'authorization_code'
                }).toString()
            });

            if (!response.ok) {
                logger.error('Token exchange failed', new Error(`HTTP ${response.status}`));
                return null;
            }

            const tokens = await response.json() as GoogleTokenResponse;
            logger.success('Google tokens obtained');

            return {
                tokens,
                walletAddress: authState.walletAddress
            };
        } catch (error) {
            logger.error('Token exchange error', error as Error);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET USER INFO
    // ─────────────────────────────────────────────────────────────────────
    async getUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                logger.error('Failed to get user info', new Error(`HTTP ${response.status}`));
                return null;
            }

            const userInfo = await response.json() as GoogleUserInfo;
            logger.info(`Google user: ${userInfo.email}`);
            return userInfo;
        } catch (error) {
            logger.error('Get user info error', error as Error);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // VERIFY ID TOKEN (for frontend-only flow)
    // ─────────────────────────────────────────────────────────────────────
    async verifyIdToken(idToken: string): Promise<GoogleUserInfo | null> {
        try {
            // Verify with Google's tokeninfo endpoint
            const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);

            if (!response.ok) {
                logger.error('ID token verification failed', new Error(`HTTP ${response.status}`));
                return null;
            }

            const payload = await response.json();

            // Verify audience matches our client ID
            if (payload.aud !== GOOGLE_CLIENT_ID) {
                logger.warn('Token audience mismatch');
                return null;
            }

            // Check if token is expired
            if (payload.exp && Date.now() / 1000 > payload.exp) {
                logger.warn('ID token expired');
                return null;
            }

            return {
                id: payload.sub,
                email: payload.email,
                verified_email: payload.email_verified === 'true',
                name: payload.name || '',
                given_name: payload.given_name || '',
                family_name: payload.family_name,
                picture: payload.picture || '',
                locale: payload.locale
            };
        } catch (error) {
            logger.error('ID token verification error', error as Error);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────
    private cleanupExpiredStates(): void {
        const now = Date.now();
        for (const [state, data] of this.stateStore.entries()) {
            if (now - data.createdAt > this.STATE_EXPIRY) {
                this.stateStore.delete(state);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────
export const googleOAuth = new GoogleOAuthService();
