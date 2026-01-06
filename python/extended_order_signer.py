#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# EXTENDED ORDER SIGNER
# Python script for signing and placing orders on Extended exchange
# Uses x10-python-trading SDK for SNIP12 signature generation
# ═══════════════════════════════════════════════════════════════════════════

import sys
import json
import os
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime

try:
    from x10.perpetual.accounts import StarkPerpetualAccount
    from x10.perpetual.orders import OrderSide, OrderType, TimeInForce
    from x10.perpetual.configuration import (
        MAINNET_CONFIG,
        TESTNET_CONFIG
    )
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "x10-python-trading SDK not installed. Run: pip install x10-python-trading"
    }))
    sys.exit(1)


class ExtendedOrderSigner:
    """Extended Exchange Order Signer using Python SDK"""

    def __init__(self, api_key: str, private_key: str, vault: str, testnet: bool = False):
        """Initialize account with Extended SDK"""
        self.config = TESTNET_CONFIG if testnet else MAINNET_CONFIG
        self.api_key = api_key
        self.private_key = private_key
        self.vault = vault
        self.account: Optional[StarkPerpetualAccount] = None

    async def initialize(self):
        """Create Stark account"""
        try:
            self.account = StarkPerpetualAccount(
                config=self.config,
                api_key=self.api_key,
                private_key=self.private_key,
                vault=self.vault
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def place_order(self, order_params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Place order on Extended exchange

        Args:
            order_params: Order parameters
                - market: str (e.g., "BTC-USD")
                - side: str ("BUY" or "SELL")
                - order_type: str ("LIMIT", "MARKET", "CONDITIONAL")
                - size: str
                - price: str (optional for market orders)
                - trigger_price: str (for conditional orders)
                - trigger_price_type: str ("LAST", "MARK", "INDEX")
                - trigger_direction: str ("UP", "DOWN")
                - time_in_force: str ("GTC", "GTT", "IOC", "FOK")
                - expiry_epoch_millis: int
                - reduce_only: bool
                - post_only: bool
                - take_profit: dict (optional)
                - stop_loss: dict (optional)

        Returns:
            Order response with order ID and details
        """
        if not self.account:
            return {"success": False, "error": "Account not initialized"}

        try:
            # Convert string enums to SDK enums
            side = OrderSide.BUY if order_params["side"] == "BUY" else OrderSide.SELL

            order_type_map = {
                "LIMIT": OrderType.LIMIT,
                "CONDITIONAL": OrderType.CONDITIONAL,
                "TPSL": OrderType.TPSL,
                "TWAP": OrderType.TWAP,
            }
            order_type = order_type_map.get(order_params.get("order_type", "LIMIT"))

            time_in_force_map = {
                "GTC": TimeInForce.GTC,
                "GTT": TimeInForce.GTT,
                "IOC": TimeInForce.IOC,
                "FOK": TimeInForce.FOK,
            }
            time_in_force = time_in_force_map.get(
                order_params.get("time_in_force", "GTT")
            )

            # Build order kwargs
            kwargs = {
                "market": order_params["market"],
                "side": side,
                "order_type": order_type,
                "size": order_params["size"],
                "time_in_force": time_in_force,
            }

            # Add optional params
            if "price" in order_params:
                kwargs["price"] = order_params["price"]

            if "trigger_price" in order_params:
                kwargs["trigger_price"] = order_params["trigger_price"]
                kwargs["trigger_price_type"] = order_params.get("trigger_price_type", "LAST")
                kwargs["trigger_direction"] = order_params.get("trigger_direction", "DOWN")

            if "execution_price_type" in order_params:
                kwargs["execution_price_type"] = order_params["execution_price_type"]

            if "expiry_epoch_millis" in order_params:
                kwargs["expiry_epoch_millis"] = int(order_params["expiry_epoch_millis"])

            if "reduce_only" in order_params:
                kwargs["reduce_only"] = order_params["reduce_only"]

            if "post_only" in order_params:
                kwargs["post_only"] = order_params["post_only"]

            if "external_id" in order_params:
                kwargs["external_id"] = order_params["external_id"]

            # TP/SL
            if "tpsl_type" in order_params:
                kwargs["tpsl_type"] = order_params["tpsl_type"]

            if "take_profit" in order_params:
                kwargs["take_profit"] = order_params["take_profit"]

            if "stop_loss" in order_params:
                kwargs["stop_loss"] = order_params["stop_loss"]

            # Place order
            order = await self.account.place_order(**kwargs)

            return {
                "success": True,
                "order": {
                    "id": order.get("id"),
                    "market": order.get("market"),
                    "side": order.get("side"),
                    "size": order.get("size"),
                    "price": order.get("price"),
                    "status": order.get("status"),
                    "created_at": order.get("createdAt"),
                }
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__
            }

    async def cancel_order(self, order_id: Optional[int] = None, external_id: Optional[str] = None) -> Dict[str, Any]:
        """Cancel order by ID or external ID"""
        if not self.account:
            return {"success": False, "error": "Account not initialized"}

        try:
            if order_id:
                await self.account.cancel_order(order_id=order_id)
            elif external_id:
                await self.account.cancel_order(external_id=external_id)
            else:
                return {"success": False, "error": "Either order_id or external_id required"}

            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def mass_cancel(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mass cancel orders"""
        if not self.account:
            return {"success": False, "error": "Account not initialized"}

        try:
            await self.account.mass_cancel(**params)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}


async def main():
    """Main entry point - reads JSON from stdin, processes, outputs JSON to stdout"""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())

        # Extract config
        api_key = input_data.get("api_key") or os.getenv("EXTENDED_API_KEY")
        private_key = input_data.get("private_key") or os.getenv("STARKNET_PRIVATE_KEY")
        vault = input_data.get("vault") or os.getenv("EXTENDED_VAULT")
        testnet = input_data.get("testnet", False)

        if not api_key:
            print(json.dumps({
                "success": False,
                "error": "EXTENDED_API_KEY not provided"
            }))
            return

        if not private_key:
            print(json.dumps({
                "success": False,
                "error": "STARKNET_PRIVATE_KEY not provided"
            }))
            return

        if not vault:
            print(json.dumps({
                "success": False,
                "error": "EXTENDED_VAULT not provided"
            }))
            return

        # Create signer
        signer = ExtendedOrderSigner(api_key, private_key, vault, testnet)

        # Initialize account
        init_result = await signer.initialize()
        if not init_result["success"]:
            print(json.dumps(init_result))
            return

        # Execute command
        command = input_data.get("command")

        if command == "place_order":
            result = await signer.place_order(input_data["params"])
            print(json.dumps(result))

        elif command == "cancel_order":
            result = await signer.cancel_order(
                order_id=input_data["params"].get("order_id"),
                external_id=input_data["params"].get("external_id")
            )
            print(json.dumps(result))

        elif command == "mass_cancel":
            result = await signer.mass_cancel(input_data["params"])
            print(json.dumps(result))

        else:
            print(json.dumps({
                "success": False,
                "error": f"Unknown command: {command}"
            }))

    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "error": f"Invalid JSON input: {str(e)}"
        }))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }))


if __name__ == "__main__":
    asyncio.run(main())
