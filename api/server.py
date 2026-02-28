"""
arfour — FastAPI Server

Entry point: uvicorn api.server:app --reload --port 8000
"""

import os
import sys
import time
from collections import defaultdict
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
from api.routes.tickers import router as tickers_router
from api.routes.user import router as user_router

app = FastAPI(
    title="arfour",
    description="Multi-perspective investment intelligence",
    version="0.2.0",
)

# --- Rate Limiting Middleware ---
# 5 analysis starts per minute per user

_rate_buckets: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 5
_RATE_WINDOW = 60  # seconds


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only rate-limit POST /api/analyze
        if request.method == "POST" and request.url.path == "/api/analyze":
            user_id = getattr(request.state, "user_id", None)
            if user_id:
                now = time.time()
                bucket = _rate_buckets[user_id]
                # Remove entries outside the window
                _rate_buckets[user_id] = [t for t in bucket if now - t < _RATE_WINDOW]
                if len(_rate_buckets[user_id]) >= _RATE_LIMIT:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Rate limit exceeded. Maximum 5 analyses per minute."},
                    )
                _rate_buckets[user_id].append(now)

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
app.include_router(tickers_router)
app.include_router(user_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "arfour"}
