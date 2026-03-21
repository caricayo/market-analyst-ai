import WebSocket from "ws";
import { buildKalshiSignedHeaders, getKalshiWebSocketUrl } from "@/lib/server/kalshi-client";
import { processManagedTrades } from "@/lib/server/managed-trade-manager";
import { tradingConfig, hasKalshiTradingCredentials } from "@/lib/server/trading-config";

type RealtimeManagerState = {
  started?: boolean;
  socket?: WebSocket;
  reconnectTimeout?: NodeJS.Timeout;
  refreshTimeout?: NodeJS.Timeout;
  reconnectDelayMs?: number;
  nextMessageId?: number;
};

const realtimeState = globalThis as typeof globalThis & {
  __btcKalshiRealtimeManager?: RealtimeManagerState;
};

function getState() {
  if (!realtimeState.__btcKalshiRealtimeManager) {
    realtimeState.__btcKalshiRealtimeManager = {
      started: false,
      reconnectDelayMs: 1_000,
      nextMessageId: 1,
    };
  }

  return realtimeState.__btcKalshiRealtimeManager;
}

function scheduleReconnect() {
  const state = getState();
  if (state.reconnectTimeout) {
    clearTimeout(state.reconnectTimeout);
  }

  const delayMs = state.reconnectDelayMs ?? 1_000;
  state.reconnectTimeout = setTimeout(() => {
    void connectKalshiRealtime();
  }, delayMs);
  state.reconnectDelayMs = Math.min(delayMs * 2, 30_000);
}

function scheduleRefresh() {
  const state = getState();
  if (state.refreshTimeout) {
    clearTimeout(state.refreshTimeout);
  }

  state.refreshTimeout = setTimeout(() => {
    void processManagedTrades();
  }, 250);
}

function subscribe(socket: WebSocket) {
  const state = getState();
  const id = state.nextMessageId ?? 1;
  state.nextMessageId = id + 1;
  socket.send(
    JSON.stringify({
      id,
      cmd: "subscribe",
      params: {
        channels: ["fill", "market_positions"],
      },
    }),
  );
}

async function connectKalshiRealtime() {
  const state = getState();
  if (
    !state.started ||
    tradingConfig.signalMonitorMode ||
    !tradingConfig.autoTradeEnabled ||
    !hasKalshiTradingCredentials()
  ) {
    return;
  }

  if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socket = new WebSocket(getKalshiWebSocketUrl(), {
    headers: buildKalshiSignedHeaders("GET", "/trade-api/ws/v2"),
  });
  state.socket = socket;

  socket.on("open", () => {
    const current = getState();
    current.reconnectDelayMs = 1_000;
    subscribe(socket);
  });

  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(raw.toString()) as { type?: string };
      if (payload.type === "fill" || payload.type === "market_position") {
        scheduleRefresh();
      }
    } catch {
      // Ignore malformed websocket messages.
    }
  });

  socket.on("error", () => {
    socket.close();
  });

  socket.on("close", () => {
    const current = getState();
    if (current.socket === socket) {
      current.socket = undefined;
    }
    scheduleReconnect();
  });
}

export function ensureKalshiRealtimeManagerStarted() {
  const state = getState();
  if (
    state.started ||
    tradingConfig.signalMonitorMode ||
    !tradingConfig.autoTradeEnabled ||
    !hasKalshiTradingCredentials()
  ) {
    return;
  }

  state.started = true;
  void connectKalshiRealtime();
}
