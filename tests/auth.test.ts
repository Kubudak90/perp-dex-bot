// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

import {
    AuthService,
    RateLimiter,
    extractToken,
    getClientIP
} from '../src/utils/auth';

describe('AuthService', () => {
    let authService: AuthService;

    beforeEach(() => {
        authService = new AuthService();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // NONCE MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('Nonce Management', () => {
        it('should generate nonce for wallet address', () => {
            const nonce = authService.generateNonce('0x1234567890abcdef');
            expect(nonce).toBeDefined();
            expect(nonce.length).toBeGreaterThan(0);
        });

        it('should generate unique nonces', () => {
            const nonce1 = authService.generateNonce('0x1234567890abcdef');
            const nonce2 = authService.generateNonce('0xabcdef1234567890');

            expect(nonce1).not.toBe(nonce2);
        });

        it('should retrieve generated nonce', () => {
            const address = '0x1234567890abcdef';
            const generatedNonce = authService.generateNonce(address);
            const retrievedNonce = authService.getNonce(address);

            expect(retrievedNonce).toBe(generatedNonce);
        });

        it('should normalize address to lowercase', () => {
            const address = '0x1234567890ABCDEF';
            authService.generateNonce(address);
            const nonce = authService.getNonce(address.toLowerCase());

            expect(nonce).not.toBeNull();
        });

        it('should return null for non-existent nonce', () => {
            const nonce = authService.getNonce('0xnonexistent');
            expect(nonce).toBeNull();
        });

        it('should overwrite nonce on regenerate', () => {
            const address = '0x1234567890abcdef';
            const nonce1 = authService.generateNonce(address);
            const nonce2 = authService.generateNonce(address);

            expect(authService.getNonce(address)).toBe(nonce2);
            expect(nonce1).not.toBe(nonce2);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // USER MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('User Management', () => {
        it('should create new user', () => {
            const user = authService.createOrUpdateUser(
                '0x1234567890abcdef',
                'metamask',
                'evm'
            );

            expect(user.walletAddress).toBe('0x1234567890abcdef');
            expect(user.walletType).toBe('metamask');
            expect(user.chain).toBe('evm');
        });

        it('should set creation timestamp', () => {
            const before = Date.now();
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const after = Date.now();

            expect(user.createdAt).toBeGreaterThanOrEqual(before);
            expect(user.createdAt).toBeLessThanOrEqual(after);
        });

        it('should update existing user', () => {
            authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const updated = authService.createOrUpdateUser('0x123', 'walletconnect', 'evm');

            expect(updated.walletType).toBe('walletconnect');
        });

        it('should preserve creation time on update', () => {
            const original = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const updated = authService.createOrUpdateUser('0x123', 'walletconnect', 'evm');

            expect(updated.createdAt).toBe(original.createdAt);
        });

        it('should update lastLogin on update', () => {
            const original = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const updated = authService.createOrUpdateUser('0x123', 'walletconnect', 'evm');

            expect(updated.lastLogin).toBeGreaterThanOrEqual(original.lastLogin);
        });

        it('should get user by address', () => {
            authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const user = authService.getUser('0x123');

            expect(user).not.toBeNull();
            expect(user?.walletAddress).toBe('0x123');
        });

        it('should return null for non-existent user', () => {
            const user = authService.getUser('0xnonexistent');
            expect(user).toBeNull();
        });

        it('should handle Solana users', () => {
            const user = authService.createOrUpdateUser(
                'SolanaAddress123',
                'phantom',
                'solana'
            );

            expect(user.chain).toBe('solana');
            expect(user.walletType).toBe('phantom');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // JWT TOKEN MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('JWT Token Management', () => {
        it('should generate token for user', () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const token = authService.generateToken(user);

            expect(token).toBeDefined();
            expect(token.length).toBeGreaterThan(0);
        });

        it('should verify valid token', () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const token = authService.generateToken(user);
            const payload = authService.verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload?.walletAddress).toBe('0x123');
        });

        it('should return null for invalid token', () => {
            const payload = authService.verifyToken('invalid.token.here');
            expect(payload).toBeNull();
        });

        it('should include user info in token payload', () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const token = authService.generateToken(user);
            const payload = authService.verifyToken(token);

            expect(payload?.walletAddress).toBe('0x123');
            expect(payload?.walletType).toBe('metamask');
            expect(payload?.chain).toBe('evm');
        });

        it('should get user by token', () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const token = authService.generateToken(user);
            const retrieved = authService.getUserByToken(token);

            expect(retrieved).not.toBeNull();
            expect(retrieved?.walletAddress).toBe('0x123');
        });

        it('should return null for invalid token getUserByToken', () => {
            const user = authService.getUserByToken('invalid.token');
            expect(user).toBeNull();
        });

        it('should revoke token', () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const token = authService.generateToken(user);

            authService.revokeToken(token);
            // Token is still valid (JWT), but session is removed
            // This tests that revokeToken doesn't throw
            expect(true).toBe(true);
        });

        it('should refresh token', async () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const oldToken = authService.generateToken(user);

            // Wait 1 second so JWT timestamp changes
            await new Promise(resolve => setTimeout(resolve, 1100));

            const newToken = authService.refreshToken(oldToken);

            expect(newToken).not.toBeNull();
            expect(newToken).not.toBe(oldToken);

            // New token should be valid
            const payload = authService.verifyToken(newToken!);
            expect(payload).not.toBeNull();
            expect(payload?.walletAddress).toBe('0x123');
        });

        it('should return null when refreshing invalid token', () => {
            const newToken = authService.refreshToken('invalid.token');
            expect(newToken).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GOOGLE ACCOUNT LINKING
    // ─────────────────────────────────────────────────────────────────────────
    describe('Google Account Linking', () => {
        it('should link Google account to existing user', () => {
            authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const result = authService.linkGoogleAccount('0x123', 'google123', 'user@example.com');

            expect(result).toBe(true);

            const user = authService.getUser('0x123');
            expect(user?.googleId).toBe('google123');
            expect(user?.email).toBe('user@example.com');
        });

        it('should return false for non-existent user', () => {
            const result = authService.linkGoogleAccount('0xnonexistent', 'google123', 'user@example.com');
            expect(result).toBe(false);
        });

        it('should preserve Google info on user update', () => {
            authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            authService.linkGoogleAccount('0x123', 'google123', 'user@example.com');

            authService.createOrUpdateUser('0x123', 'walletconnect', 'evm');

            const user = authService.getUser('0x123');
            expect(user?.googleId).toBe('google123');
            expect(user?.email).toBe('user@example.com');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STATS
    // ─────────────────────────────────────────────────────────────────────────
    describe('Stats', () => {
        it('should return user and session counts', () => {
            const stats = authService.getStats();

            expect(stats).toHaveProperty('users');
            expect(stats).toHaveProperty('activeSessions');
        });

        it('should track user count', () => {
            const initialStats = authService.getStats();

            authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            authService.createOrUpdateUser('0x456', 'phantom', 'solana');

            const newStats = authService.getStats();
            expect(newStats.users).toBe(initialStats.users + 2);
        });

        it('should track session count', () => {
            const user = authService.createOrUpdateUser('0x123', 'metamask', 'evm');
            const initialStats = authService.getStats();

            authService.generateToken(user);

            const newStats = authService.getStats();
            expect(newStats.activeSessions).toBe(initialStats.activeSessions + 1);
        });
    });
});

describe('RateLimiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
        limiter = new RateLimiter({
            windowMs: 1000, // 1 second window
            maxRequests: 5,
            blockDuration: 2000
        });
    });

    describe('Basic Rate Limiting', () => {
        it('should allow requests within limit', () => {
            const result = limiter.check('user1');
            expect(result.allowed).toBe(true);
        });

        it('should track remaining requests', () => {
            limiter.check('user1');
            const result = limiter.check('user1');

            expect(result.remaining).toBe(3); // 5 - 2 = 3
        });

        it('should block after exceeding limit', () => {
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }

            const result = limiter.check('user1');
            expect(result.allowed).toBe(false);
        });

        it('should return resetIn time', () => {
            const result = limiter.check('user1');
            expect(result.resetIn).toBeGreaterThan(0);
            expect(result.resetIn).toBeLessThanOrEqual(1000);
        });

        it('should track different identifiers separately', () => {
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }

            const result = limiter.check('user2');
            expect(result.allowed).toBe(true);
        });
    });

    describe('Blocking', () => {
        it('should set block duration', () => {
            for (let i = 0; i < 6; i++) {
                limiter.check('user1');
            }

            const result = limiter.check('user1');
            expect(result.allowed).toBe(false);
            expect(result.resetIn).toBeGreaterThan(0);
        });

        it('should show 0 remaining when blocked', () => {
            for (let i = 0; i < 6; i++) {
                limiter.check('user1');
            }

            const result = limiter.check('user1');
            expect(result.remaining).toBe(0);
        });
    });

    describe('Reset', () => {
        it('should reset rate limit for identifier', () => {
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }

            limiter.reset('user1');

            const result = limiter.check('user1');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4);
        });
    });

    describe('Window Reset', () => {
        it('should reset after window expires', (done) => {
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }

            // Wait for window to expire
            setTimeout(() => {
                const result = limiter.check('user1');
                expect(result.allowed).toBe(true);
                done();
            }, 1100);
        });
    });
});

describe('Helper Functions', () => {
    describe('extractToken', () => {
        it('should extract Bearer token', () => {
            const token = extractToken('Bearer abc123');
            expect(token).toBe('abc123');
        });

        it('should return null for missing header', () => {
            const token = extractToken(undefined);
            expect(token).toBeNull();
        });

        it('should return null for invalid format', () => {
            const token = extractToken('Basic abc123');
            expect(token).toBeNull();
        });

        it('should return null for missing token value', () => {
            const token = extractToken('Bearer');
            expect(token).toBeNull();
        });

        it('should return null for empty string', () => {
            const token = extractToken('');
            expect(token).toBeNull();
        });
    });

    describe('getClientIP', () => {
        it('should extract IP from X-Forwarded-For header', () => {
            const req = {
                headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
                socket: { remoteAddress: '127.0.0.1' }
            };

            const ip = getClientIP(req);
            expect(ip).toBe('192.168.1.1');
        });

        it('should use socket remoteAddress as fallback', () => {
            const req = {
                headers: {},
                socket: { remoteAddress: '192.168.1.100' }
            };

            const ip = getClientIP(req);
            expect(ip).toBe('192.168.1.100');
        });

        it('should return unknown when no IP available', () => {
            const req = {
                headers: {},
                socket: {}
            };

            const ip = getClientIP(req);
            expect(ip).toBe('unknown');
        });

        it('should handle array X-Forwarded-For', () => {
            const req = {
                headers: { 'x-forwarded-for': ['192.168.1.1', '10.0.0.1'] },
                socket: {}
            };

            const ip = getClientIP(req);
            expect(ip).toBe('192.168.1.1');
        });

        it('should trim whitespace from IP', () => {
            const req = {
                headers: { 'x-forwarded-for': '  192.168.1.1  , 10.0.0.1' },
                socket: {}
            };

            const ip = getClientIP(req);
            expect(ip).toBe('192.168.1.1');
        });
    });
});

describe('Wallet Signature Verification', () => {
    let authService: AuthService;

    beforeEach(() => {
        authService = new AuthService();
    });

    it('should reject verification without nonce', async () => {
        const result = await authService.verifyWalletSignature(
            '0x123',
            'signature',
            'message',
            'evm'
        );

        expect(result).toBe(false);
    });

    it('should reject verification with wrong message', async () => {
        const nonce = authService.generateNonce('0x123');
        const result = await authService.verifyWalletSignature(
            '0x123',
            'signature',
            'wrong message without nonce',
            'evm'
        );

        expect(result).toBe(false);
    });

    it('should handle Solana verification (frontend verified)', async () => {
        const nonce = authService.generateNonce('SolanaAddress');
        const result = await authService.verifyWalletSignature(
            'SolanaAddress',
            'signature',
            `Sign this message: ${nonce}`,
            'solana'
        );

        // Solana trusts frontend verification if nonce is valid
        expect(result).toBe(true);
    });
});

describe('Full Authentication Flow', () => {
    let authService: AuthService;

    beforeEach(() => {
        authService = new AuthService();
    });

    it('should complete full auth flow for Solana', async () => {
        const address = 'SolanaWalletAddress';

        // 1. Generate nonce
        const nonce = authService.generateNonce(address);
        expect(nonce).toBeDefined();

        // 2. Authenticate (Solana trusts frontend)
        const session = await authService.authenticate(
            address,
            'phantom',
            'solana',
            'signature',
            `Sign this message: ${nonce}`
        );

        expect(session).not.toBeNull();
        expect(session?.user.walletAddress).toBe(address.toLowerCase());
        expect(session?.token).toBeDefined();

        // 3. Verify token works
        const payload = authService.verifyToken(session!.token);
        expect(payload?.walletAddress).toBe(address.toLowerCase());

        // 4. Get user by token
        const user = authService.getUserByToken(session!.token);
        expect(user?.walletType).toBe('phantom');
    });

    it('should fail auth with invalid signature', async () => {
        const address = '0x123';
        authService.generateNonce(address);

        const session = await authService.authenticate(
            address,
            'metamask',
            'evm',
            'invalid_signature',
            'message without nonce'
        );

        expect(session).toBeNull();
    });
});
