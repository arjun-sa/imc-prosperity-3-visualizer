from datamodel import OrderDepth, TradingState, Order
from typing import Dict, List, Optional, Tuple

import json
import math
import statistics

Symbol = str
Product = str
Position = int

#hi
class Trader:
    PRODUCTS = ("ASH_COATED_OSMIUM", "INTARIAN_PEPPER_ROOT")
    POSITION_LIMITS: Dict[Product, int] = {
        "ASH_COATED_OSMIUM": 80,
        "INTARIAN_PEPPER_ROOT": 80,
    }
    PARAMS: Dict[Product, Dict[str, float]] = {
        "ASH_COATED_OSMIUM": {
            "base_half_spread": 8.0,
            "spread_weight": 0.45,
            "vol_weight": 1.6,
            "imbalance_weight": 5.0,
            "inventory_weight": 0.30,
            "drift_weight": 0.0,
            "quote_size": 18,
            "inventory_soft_limit": 24,
            "drift_window": 24,
            "vol_window": 24,
        },
        "INTARIAN_PEPPER_ROOT": {
            "base_half_spread": 7.0,
            "spread_weight": 0.55,
            "vol_weight": 2.8,
            "imbalance_weight": 5.5,
            "inventory_weight": 0.38,
            "drift_weight": 28.0,
            "quote_size": 14,
            "inventory_soft_limit": 18,
            "drift_window": 48,
            "vol_window": 32,
        },
    }

    def run(self, state: TradingState):
        state_cache = self._load_state(state.traderData)
        result: Dict[Product, List[Order]] = {}

        for product in self.PRODUCTS:
            order_depth = state.order_depths.get(product)
            if order_depth is None:
                continue

            product_state = state_cache.setdefault(product, {"mid_history": [], "return_history": []})
            orders = self._make_orders(
                product=product,
                order_depth=order_depth,
                position=state.position.get(product, 0),
                product_state=product_state,
            )
            result[product] = orders

        trader_data = self._dump_state(state_cache)
        conversions = 0
        return result, conversions, trader_data

    def _make_orders(
        self,
        product: Product,
        order_depth: OrderDepth,
        position: Position,
        product_state: Dict[str, List[float]],
    ) -> List[Order]:
        best_bid, bid_size, best_ask, ask_size = self._get_bbo(order_depth)
        if best_bid is None or best_ask is None:
            return []

        spread = best_ask - best_bid
        if spread <= 0:
            return []

        mid = (best_bid + best_ask) / 2.0
        has_bbo = mid > 0
        if not has_bbo:
            return []

        mid_history = product_state.setdefault("mid_history", [])
        return_history = product_state.setdefault("return_history", [])
        self._update_histories(mid_history, return_history, mid)

        params = self.PARAMS[product]
        volatility = self._rolling_vol(return_history, int(params["vol_window"]))
        drift = self._rolling_mean(return_history, int(params["drift_window"]))
        imbalance = self._imbalance(bid_size, ask_size)

        reservation_price = (
            mid
            + params["imbalance_weight"] * imbalance
            - params["inventory_weight"] * position
            - params["drift_weight"] * drift
        )
        half_spread = max(
            params["base_half_spread"],
            params["spread_weight"] * spread / 2.0 + params["vol_weight"] * volatility * mid,
        )

        raw_bid = reservation_price - half_spread
        raw_ask = reservation_price + half_spread
        bid_quote, ask_quote = self._quote_near_touch(best_bid, best_ask, raw_bid, raw_ask)

        bid_allowed, ask_allowed = self._side_permissions(product, position, drift, imbalance)
        buy_capacity = max(0, self.POSITION_LIMITS[product] - position)
        sell_capacity = max(0, self.POSITION_LIMITS[product] + position)
        clip_size = int(params["quote_size"])
        inventory_soft_limit = int(params["inventory_soft_limit"])

        orders: List[Order] = []

        if position >= inventory_soft_limit:
            buy_capacity = 0
        if position <= -inventory_soft_limit:
            sell_capacity = 0

        if bid_allowed and buy_capacity > 0:
            buy_size = min(clip_size, buy_capacity)
            if product == "INTARIAN_PEPPER_ROOT" and drift < 0:
                buy_size = max(0, buy_size - 4)
            if buy_size > 0:
                orders.append(Order(product, bid_quote, buy_size))

        if ask_allowed and sell_capacity > 0:
            sell_size = min(clip_size, sell_capacity)
            if product == "INTARIAN_PEPPER_ROOT" and drift > 0:
                sell_size = max(0, sell_size - 6)
            if sell_size > 0:
                orders.append(Order(product, ask_quote, -sell_size))

        return orders

    def _side_permissions(
        self,
        product: Product,
        position: Position,
        drift: float,
        imbalance: float,
    ) -> Tuple[bool, bool]:
        if product == "ASH_COATED_OSMIUM":
            return True, True

        bid_allowed = True
        ask_allowed = True

        if drift > 0.00045:
            ask_allowed = imbalance < -0.15 or position > 10
        if drift > 0.00075:
            ask_allowed = position > 6
        if drift < -0.00035:
            bid_allowed = imbalance > 0.10 or position < -10

        return bid_allowed, ask_allowed

    def _quote_near_touch(
        self,
        best_bid: int,
        best_ask: int,
        raw_bid: float,
        raw_ask: float,
    ) -> Tuple[int, int]:
        spread = best_ask - best_bid
        bid_quote = min(int(math.floor(raw_bid)), best_ask - 1)
        ask_quote = max(int(math.ceil(raw_ask)), best_bid + 1)

        if spread >= 3:
            bid_quote = max(bid_quote, best_bid + 1)
            ask_quote = min(ask_quote, best_ask - 1)
        else:
            bid_quote = min(max(bid_quote, best_bid), best_ask - 1)
            ask_quote = max(min(ask_quote, best_ask), best_bid + 1)

        if bid_quote >= ask_quote:
            midpoint = (best_bid + best_ask) / 2.0
            bid_quote = min(best_ask - 1, int(math.floor(midpoint)))
            ask_quote = max(best_bid + 1, int(math.ceil(midpoint)))

        return bid_quote, ask_quote

    def _get_bbo(self, order_depth: OrderDepth) -> Tuple[Optional[int], int, Optional[int], int]:
        best_bid = max(order_depth.buy_orders.keys()) if order_depth.buy_orders else None
        best_ask = min(order_depth.sell_orders.keys()) if order_depth.sell_orders else None
        bid_size = order_depth.buy_orders.get(best_bid, 0) if best_bid is not None else 0
        ask_size = -order_depth.sell_orders.get(best_ask, 0) if best_ask is not None else 0
        return best_bid, bid_size, best_ask, ask_size

    def _imbalance(self, bid_size: int, ask_size: int) -> float:
        total = bid_size + ask_size
        if total <= 0:
            return 0.0
        return (bid_size - ask_size) / total

    def _update_histories(self, mid_history: List[float], return_history: List[float], mid: float) -> None:
        if mid_history:
            prev_mid = mid_history[-1]
            if prev_mid > 0 and mid > 0:
                return_history.append(math.log(mid / prev_mid))
        mid_history.append(mid)

        max_mid_points = 128
        max_return_points = 128
        if len(mid_history) > max_mid_points:
            del mid_history[:-max_mid_points]
        if len(return_history) > max_return_points:
            del return_history[:-max_return_points]

    def _rolling_mean(self, values: List[float], window: int) -> float:
        if not values:
            return 0.0
        sample = values[-window:]
        return statistics.fmean(sample)

    def _rolling_vol(self, values: List[float], window: int) -> float:
        if len(values) < 2:
            return 0.0
        sample = values[-window:]
        if len(sample) < 2:
            return 0.0
        return statistics.pstdev(sample)

    def _load_state(self, trader_data: str) -> Dict[str, Dict[str, List[float]]]:
        if not trader_data:
            return {}
        try:
            parsed = json.loads(trader_data)
        except json.JSONDecodeError:
            return {}

        if not isinstance(parsed, dict):
            return {}

        sanitized: Dict[str, Dict[str, List[float]]] = {}
        for product, product_state in parsed.items():
            if not isinstance(product_state, dict):
                continue
            sanitized[product] = {
                "mid_history": self._sanitize_series(product_state.get("mid_history", [])),
                "return_history": self._sanitize_series(product_state.get("return_history", [])),
            }
        return sanitized

    def _dump_state(self, state_cache: Dict[str, Dict[str, List[float]]]) -> str:
        return json.dumps(state_cache, separators=(",", ":"))

    def _sanitize_series(self, values) -> List[float]:
        if not isinstance(values, list):
            return []
        sanitized: List[float] = []
        for value in values[-128:]:
            if isinstance(value, (int, float)) and math.isfinite(value):
                sanitized.append(float(value))
        return sanitized