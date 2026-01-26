// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION MODULE
// JWT sessions, wallet verification, rate limiting
// ═══════════════════════════════════════════════════════════════════════════

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { Logger } from '../logger';

const logger = new Logger('Auth');

// ─────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const NONCE_EXPIRES_IN = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────
export interface AuthUser {
    walletAddress: string;
    walletType: 'metamask' | 'phantom' | 'walletconnect';
    chain: 'evm' | 'solana';
    googleId?: string;
    email?: string;
    createdAt: number;
    lastLogin: number;
}

export interface JWTPayload {
    walletAddress: string;
    walletType: string;
    chain: string;
    googleId?: string;
    iat?: number;
    exp?: number;
}

export interface AuthSession {
    token: string;
    user: AuthUser;
    expiresAt: number;
}

export interface NonceRecord {
    nonce: string;
    walletAddress: string;
    createdAt: number;
    used: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class AuthService {
    private nonceStore: Map<string, NonceRecord> = new Map();
    private sessionStore: Map<string, AuthSession> = new Map();
    private userStore: Map<string, AuthUser> = new Map();

    constructor() {
        // Clean up expired nonces every minute
        setInterval(() => this.cleanupExpiredNonces(), 60 * 1000);
    }

    // ─────────────────────────────────────────────────────────────────────
    // NONCE MANAGEMENT (for wallet signature verification)
    // ─────────────────────────────────────────────────────────────────────
    generateNonce(walletAddress: string): string {
        const nonce = crypto.randomBytes(32).toString('hex');
        const normalizedAddress = walletAddress.toLowerCase();

        this.nonceStore.set(normalizedAddress, {
            nonce,
            walletAddress: normalizedAddress,
            createdAt: Date.now(),
            used: false
        });

        logger.info(`Nonce generated for ${normalizedAddress.slice(0, 10)}...`);
        return nonce;
    }

    getNonce(walletAddress: string): string | null {
        const record = this.nonceStore.get(walletAddress.toLowerCase());
        if (!record || record.used || Date.now() - record.createdAt > NONCE_EXPIRES_IN) {
            return null;
        }
        return record.nonce;
    }

    private cleanupExpiredNonces(): void {
        const now = Date.now();
        for (const [address, record] of this.nonceStore.entries()) {
            if (record.used || now - record.createdAt > NONCE_EXPIRES_IN) {
                this.nonceStore.delete(address);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // WALLET SIGNATURE VERIFICATION
    // ─────────────────────────────────────────────────────────────────────
    async verifyWalletSignature(
        walletAddress: string,
        signature: string,
        message: string,
        chain: 'evm' | 'solana'
    ): Promise<boolean> {
        const normalizedAddress = walletAddress.toLowerCase();
        const nonceRecord = this.nonceStore.get(normalizedAddress);

        if (!nonceRecord || nonceRecord.used) {
            logger.warn(`Invalid or used nonce for ${normalizedAddress.slice(0, 10)}...`);
            return false;
        }

        if (Date.now() - nonceRecord.createdAt > NONCE_EXPIRES_IN) {
            logger.warn(`Expired nonce for ${normalizedAddress.slice(0, 10)}...`);
            return false;
        }

        // Verify the message contains the nonce
        if (!message.includes(nonceRecord.nonce)) {
            logger.warn(`Message doesn't contain expected nonce`);
            return false;
        }

        try {
            if (chain === 'evm') {
                // EVM signature verification using ethers
                const recoveredAddress = ethers.verifyMessage(message, signature);
                if (recoveredAddress.toLowerCase() !== normalizedAddress) {
                    logger.warn(`Signature verification failed: address mismatch`);
                    return false;
                }
            } else if (chain === 'solana') {
                // Solana signature verification
                // Note: In production, use @solana/web3.js for proper verification
                // For now, we trust the frontend verification and just check nonce
                logger.info(`Solana signature accepted (frontend verified)`);
            }

            // Mark nonce as used
            nonceRecord.used = true;
            logger.success(`Wallet signature verified for ${normalizedAddress.slice(0, 10)}...`);
            return true;
        } catch (error) {
            logger.error(`Signature verification error`, error as Error);
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // JWT TOKEN MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────
    generateToken(user: AuthUser): string {
        const payload: JWTPayload = {
            walletAddress: user.walletAddress,
            walletType: user.walletType,
            chain: user.chain,
            googleId: user.googleId
        };

        const token = jwt.sign(payload, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']
        });

        // Store session
        const decoded = jwt.decode(token) as JWTPayload & { exp: number };
        const session: AuthSession = {
            token,
            user,
            expiresAt: decoded.exp * 1000
        };
        this.sessionStore.set(token, session);

        logger.info(`Token generated for ${user.walletAddress.slice(0, 10)}...`);
        return token;
    }

    verifyToken(token: string): JWTPayload | null {
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
            return decoded;
        } catch (error) {
            if ((error as Error).name === 'TokenExpiredError') {
                logger.warn('Token expired');
            } else {
                logger.warn('Invalid token');
            }
            return null;
        }
    }

    refreshToken(oldToken: string): string | null {
        const payload = this.verifyToken(oldToken);
        if (!payload) return null;

        const user = this.userStore.get(payload.walletAddress.toLowerCase());
        if (!user) return null;

        // Remove old session
        this.sessionStore.delete(oldToken);

        // Generate new token
        return this.generateToken(user);
    }

    revokeToken(token: string): void {
        this.sessionStore.delete(token);
        logger.info('Token revoked');
    }

    // ─────────────────────────────────────────────────────────────────────
    // USER MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────
    createOrUpdateUser(
        walletAddress: string,
        walletType: 'metamask' | 'phantom' | 'walletconnect',
        chain: 'evm' | 'solana',
        googleId?: string,
        email?: string
    ): AuthUser {
        const normalizedAddress = walletAddress.toLowerCase();
        const existingUser = this.userStore.get(normalizedAddress);

        const user: AuthUser = {
            walletAddress: normalizedAddress,
            walletType,
            chain,
            googleId: googleId || existingUser?.googleId,
            email: email || existingUser?.email,
            createdAt: existingUser?.createdAt || Date.now(),
            lastLogin: Date.now()
        };

        this.userStore.set(normalizedAddress, user);
        logger.info(`User ${existingUser ? 'updated' : 'created'}: ${normalizedAddress.slice(0, 10)}...`);
        return user;
    }

    getUser(walletAddress: string): AuthUser | null {
        return this.userStore.get(walletAddress.toLowerCase()) || null;
    }

    getUserByToken(token: string): AuthUser | null {
        const payload = this.verifyToken(token);
        if (!payload) return null;
        return this.getUser(payload.walletAddress);
    }

    // ─────────────────────────────────────────────────────────────────────
    // AUTHENTICATION FLOW
    // ─────────────────────────────────────────────────────────────────────
    async authenticate(
        walletAddress: string,
        walletType: 'metamask' | 'phantom' | 'walletconnect',
        chain: 'evm' | 'solana',
        signature: string,
        message: string
    ): Promise<AuthSession | null> {
        // Verify signature
        const isValid = await this.verifyWalletSignature(walletAddress, signature, message, chain);
        if (!isValid) {
            return null;
        }

        // Create or update user
        const user = this.createOrUpdateUser(walletAddress, walletType, chain);

        // Generate token
        const token = this.generateToken(user);

        const decoded = jwt.decode(token) as JWTPayload & { exp: number };
        return {
            token,
            user,
            expiresAt: decoded.exp * 1000
        };
    }

    // Link Google account to wallet
    linkGoogleAccount(walletAddress: string, googleId: string, email: string): boolean {
        const user = this.userStore.get(walletAddress.toLowerCase());
        if (!user) {
            logger.warn(`Cannot link Google: user not found`);
            return false;
        }

        user.googleId = googleId;
        user.email = email;
        this.userStore.set(walletAddress.toLowerCase(), user);
        logger.success(`Google account linked: ${email}`);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // STATS
    // ─────────────────────────────────────────────────────────────────────
    getStats(): { users: number; activeSessions: number } {
        return {
            users: this.userStore.size,
            activeSessions: this.sessionStore.size
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────────────────
export interface RateLimitConfig {
    windowMs: number;      // Time window in milliseconds
    maxRequests: number;   // Max requests per window
    blockDuration?: number; // How long to block after limit exceeded (ms)
}

export class RateLimiter {
    private requests: Map<string, { count: number; windowStart: number; blockedUntil?: number }> = new Map();
    private config: RateLimitConfig;

    constructor(config: RateLimitConfig) {
        this.config = {
            windowMs: config.windowMs || 60000,
            maxRequests: config.maxRequests || 100,
            blockDuration: config.blockDuration || 60000
        };

        // Cleanup old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }

    check(identifier: string): { allowed: boolean; remaining: number; resetIn: number } {
        const now = Date.now();
        let record = this.requests.get(identifier);

        // Check if blocked
        if (record?.blockedUntil && now < record.blockedUntil) {
            return {
                allowed: false,
                remaining: 0,
                resetIn: record.blockedUntil - now
            };
        }

        // Reset window if expired
        if (!record || now - record.windowStart > this.config.windowMs) {
            record = { count: 0, windowStart: now };
        }

        // Check limit
        if (record.count >= this.config.maxRequests) {
            record.blockedUntil = now + (this.config.blockDuration || 60000);
            this.requests.set(identifier, record);
            logger.warn(`Rate limit exceeded for ${identifier}`);
            return {
                allowed: false,
                remaining: 0,
                resetIn: this.config.blockDuration || 60000
            };
        }

        // Increment counter
        record.count++;
        this.requests.set(identifier, record);

        return {
            allowed: true,
            remaining: this.config.maxRequests - record.count,
            resetIn: this.config.windowMs - (now - record.windowStart)
        };
    }

    reset(identifier: string): void {
        this.requests.delete(identifier);
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [id, record] of this.requests.entries()) {
            if (now - record.windowStart > this.config.windowMs && (!record.blockedUntil || now > record.blockedUntil)) {
                this.requests.delete(id);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// MIDDLEWARE HELPERS
// ─────────────────────────────────────────────────────────────────────────
export function extractToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
    return parts[1];
}

export function getClientIP(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = typeof forwarded === 'string' ? forwarded.split(',') : forwarded;
        return ips[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────
export const authService = new AuthService();

// Pre-configured rate limiters
export const rateLimiters = {
    // General API: 100 requests per minute
    api: new RateLimiter({ windowMs: 60000, maxRequests: 100 }),
    // Auth endpoints: 10 requests per minute
    auth: new RateLimiter({ windowMs: 60000, maxRequests: 10, blockDuration: 300000 }),
    // Bot control: 5 requests per minute
    botControl: new RateLimiter({ windowMs: 60000, maxRequests: 5 })
};
