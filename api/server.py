"""
arfour — FastAPI Server

Entry point: uvicorn api.server:app --reload --port 8000
"""

import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

# Ensure project root is in path
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api.middleware.auth import AuthMiddleware
from api.routes.analyze import router as analyze_router
from api.routes.checkout import router as checkout_router
from api.routes.tickers import router as tickers_router
from api.routes.user import router as user_router
from api.services.ticker_data import load_ticker_data

log = logging.getLogger(__name__)

# --- Validate required environment variables on import ---
_REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "OPENAI_API_KEY"]
_missing = [k for k in _REQUIRED_ENV if not os.environ.get(k)]
if _missing:
    log.critical("Missing required environment variables: %s", ", ".join(_missing))
    # Don't crash on import (allows health check), but log loudly
    print(f"WARNING: Missing required env vars: {', '.join(_missing)}", file=sys.stderr)

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    load_ticker_data()
    yield


app = FastAPI(
    title="arfour",
    description="Multi-perspective investment intelligence",
    version="0.2.0",
    lifespan=lifespan,
)

# --- Rate Limiting Middleware ---
# 5 analysis starts per minute per user, with TTL-based cleanup

_rate_buckets: dict[str, list[float]] = {}
_rate_last_cleanup: float = 0.0
_RATE_LIMIT = 5
_RATE_WINDOW = 60  # seconds
_RATE_CLEANUP_INTERVAL = 300  # prune stale buckets every 5 min


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        global _rate_last_cleanup

        # Only rate-limit POST /api/analyze
        if request.method == "POST" and request.url.path == "/api/analyze":
            user_id = getattr(request.state, "user_id", None)
            if user_id:
                now = time.time()

                # Periodic cleanup of stale buckets to prevent memory leak
                if now - _rate_last_cleanup > _RATE_CLEANUP_INTERVAL:
                    stale_keys = [
                        k for k, v in _rate_buckets.items()
                        if not v or (now - v[-1]) > _RATE_WINDOW
                    ]
                    for k in stale_keys:
                        del _rate_buckets[k]
                    _rate_last_cleanup = now

                bucket = _rate_buckets.get(user_id, [])
                # Remove entries outside the window
                bucket = [t for t in bucket if now - t < _RATE_WINDOW]
                if len(bucket) >= _RATE_LIMIT:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Rate limit exceeded. Maximum 5 analyses per minute."},
                    )
                bucket.append(now)
                _rate_buckets[user_id] = bucket

        return await call_next(request)


# --- Middleware Stack ---
# Starlette add_middleware is LIFO: last added = outermost (runs first).
# Desired order (outside-in): CORS → Auth → RateLimit → Route handler
# So we add in reverse: RateLimit first, Auth second, CORS last.

# Rate limiting (innermost — user_id is set by auth before this runs)
app.add_middleware(RateLimitMiddleware)

# Auth — validates JWT, injects user_id into request.state
app.add_middleware(AuthMiddleware)

# CORS (outermost — handles preflight before anything else)
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Routes ---
app.include_router(analyze_router)
app.include_router(checkout_router)
app.include_router(tickers_router)
app.include_router(user_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "arfour"}
