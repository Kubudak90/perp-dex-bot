// ═══════════════════════════════════════════════════════════════════════════
// PYTHON BRIDGE
// Bridge between TypeScript and Python SDK for order signing
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import * as path from 'path';
import { CreateOrderRequest, OrderResponse, Order } from './types';

/**
 * Python Bridge Response
 */
interface PythonResponse {
    success: boolean;
    order?: any;
    error?: string;
    error_type?: string;
}

/**
 * Python Bridge for Extended Order Signing
 * Uses x10-python-trading SDK via subprocess
 */
export class PythonBridge {
    private pythonPath: string;
    private scriptPath: string;
    private apiKey: string;
    private privateKey: string;
    private vault: string;
    private testnet: boolean;

    constructor(
        apiKey: string,
        privateKey: string,
        vault: string,
        testnet: boolean = false
    ) {
        this.apiKey = apiKey;
        this.privateKey = privateKey;
        this.vault = vault;
        this.testnet = testnet;

        // Python paths
        this.pythonPath = process.env.PYTHON_PATH || 'python3';
        this.scriptPath = path.join(__dirname, '../../../python/extended_order_signer.py');
    }

    /**
     * Place order using Python SDK
     */
    async placeOrder(orderRequest: CreateOrderRequest): Promise<OrderResponse> {
        try {
            // Prepare input for Python script
            const input = {
                command: 'place_order',
                api_key: this.apiKey,
                private_key: this.privateKey,
                vault: this.vault,
                testnet: this.testnet,
                params: {
                    market: orderRequest.market,
                    side: orderRequest.side,
                    order_type: orderRequest.type,
                    size: orderRequest.size,
                    price: orderRequest.price,
                    trigger_price: orderRequest.triggerPrice,
                    trigger_price_type: orderRequest.triggerPriceType,
                    trigger_direction: orderRequest.triggerDirection,
                    execution_price_type: orderRequest.executionPriceType,
                    time_in_force: orderRequest.timeInForce,
                    expiry_epoch_millis: orderRequest.expiryEpochMillis,
                    reduce_only: orderRequest.reduceOnly,
                    post_only: orderRequest.postOnly,
                    external_id: orderRequest.externalId,
                    tpsl_type: orderRequest.tpslType,
                    take_profit: orderRequest.takeProfit,
                    stop_loss: orderRequest.stopLoss,
                },
            };

            // Call Python script
            const response = await this.callPython(input);

            if (!response.success) {
                throw new Error(response.error || 'Order placement failed');
            }

            // Convert Python response to OrderResponse
            const order = response.order as Order;
            return { order };
        } catch (error) {
            console.error('❌ Python bridge error:', error);
            throw error;
        }
    }

    /**
     * Cancel order using Python SDK
     */
    async cancelOrder(orderId?: number, externalId?: string): Promise<void> {
        const input = {
            command: 'cancel_order',
            api_key: this.apiKey,
            private_key: this.privateKey,
            vault: this.vault,
            testnet: this.testnet,
            params: {
                order_id: orderId,
                external_id: externalId,
            },
        };

        const response = await this.callPython(input);

        if (!response.success) {
            throw new Error(response.error || 'Order cancellation failed');
        }
    }

    /**
     * Mass cancel orders using Python SDK
     */
    async massCancel(params: any): Promise<void> {
        const input = {
            command: 'mass_cancel',
            api_key: this.apiKey,
            private_key: this.privateKey,
            vault: this.vault,
            testnet: this.testnet,
            params,
        };

        const response = await this.callPython(input);

        if (!response.success) {
            throw new Error(response.error || 'Mass cancel failed');
        }
    }

    /**
     * Call Python script with JSON input/output
     */
    private async callPython(input: any): Promise<PythonResponse> {
        return new Promise((resolve, reject) => {
            const python = spawn(this.pythonPath, [this.scriptPath]);

            let stdout = '';
            let stderr = '';

            // Send input to Python stdin
            python.stdin.write(JSON.stringify(input));
            python.stdin.end();

            // Collect stdout
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            // Collect stderr
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Handle completion
            python.on('close', (code) => {
                if (code !== 0) {
                    console.error('Python script stderr:', stderr);
                    reject(new Error(`Python script exited with code ${code}`));
                    return;
                }

                try {
                    const response = JSON.parse(stdout);
                    resolve(response);
                } catch (error) {
                    console.error('Failed to parse Python output:', stdout);
                    console.error('stderr:', stderr);
                    reject(new Error('Failed to parse Python response'));
                }
            });

            // Handle errors
            python.on('error', (error) => {
                reject(new Error(`Failed to spawn Python: ${error.message}`));
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                python.kill();
                reject(new Error('Python script timeout'));
            }, 30000);
        });
    }

    /**
     * Check if Python SDK is installed
     */
    static async checkPythonSetup(): Promise<{ installed: boolean; error?: string }> {
        return new Promise((resolve) => {
            const python = spawn('python3', ['-c', 'import x10; print("OK")']);

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                if (code === 0 && stdout.includes('OK')) {
                    resolve({ installed: true });
                } else {
                    resolve({
                        installed: false,
                        error: 'x10-python-trading not installed. Run: pip install x10-python-trading',
                    });
                }
            });

            python.on('error', (error) => {
                resolve({
                    installed: false,
                    error: `Python not found: ${error.message}`,
                });
            });

            setTimeout(() => {
                python.kill();
                resolve({
                    installed: false,
                    error: 'Python check timeout',
                });
            }, 5000);
        });
    }
}
