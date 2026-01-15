// ═══════════════════════════════════════════════════════════════════════════
// PM2 ECOSYSTEM CONFIG
// Run with: pm2 start ecosystem.config.js
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    apps: [
        {
            name: 'perp-dex-bot',
            script: 'dist/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',

            // Environment variables
            env: {
                NODE_ENV: 'development',
                MODE: 'paper'
            },
            env_production: {
                NODE_ENV: 'production',
                MODE: 'live'
            },

            // Logging
            error_file: './logs/error.log',
            out_file: './logs/out.log',
            log_file: './logs/combined.log',
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

            // Restart policy
            exp_backoff_restart_delay: 100,
            max_restarts: 10,
            min_uptime: '10s',

            // Graceful shutdown
            kill_timeout: 5000,
            listen_timeout: 3000,

            // Cron restart (optional - restart daily at 00:00 UTC)
            // cron_restart: '0 0 * * *',
        }
    ]
};
