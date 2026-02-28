"""
arfour — Auth Middleware

Validates Supabase JWT tokens on protected routes.
Injects user_id into request state for downstream handlers.
Supports both HS256 (legacy) and ES256 (JWKS) token verification.
"""

import json
import logging
import os
import re
import time
import urllib.request
from jose import jwt, jwk, JWTError
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger(__name__)

# ── JWKS cache ──────────────────────────────────────────────────────────────
_jwks_cache: dict | None = None
_jwks_cache_time: float = 0
_JWKS_TTL = 3600  # refresh JWKS every hour


def _get_jwks() -> dict:
    """Fetch and cache JWKS from Supabase."""
    global _jwks_cache, _jwks_cache_time
    if _jwks_cache and (time.time() - _jwks_cache_time) < _JWKS_TTL:
        return _jwks_cache
    supabase_url = os.environ.get("SUPABASE_URL", "")
    url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            _jwks_cache = json.loads(resp.read())
            _jwks_cache_time = time.time()
            log.info("Fetched JWKS from %s (%d keys)", url, len(_jwks_cache.get("keys", [])))
    except Exception as e:
        log.warning("Failed to fetch JWKS: %s", e)
        if _jwks_cache:
            return _jwks_cache
        raise
    return _jwks_cache


def _get_signing_key(token: str) -> tuple:
    """Return (key, algorithms) for the token. Tries ES256 JWKS first, falls back to HS256."""
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "HS256")

    if alg == "ES256":
        kid = header.get("kid")
        jwks_data = _get_jwks()
        for key_data in jwks_data.get("keys", []):
            if key_data.get("kid") == kid:
                key = jwk.construct(key_data, algorithm="ES256")
                return key, ["ES256"]
        raise JWTError(f"No JWKS key found for kid={kid}")

    # Fallback: HS256 with JWT secret
    return os.environ["SUPABASE_JWT_SECRET"], ["HS256"]

# Routes that don't require authentication
PUBLIC_PATHS = {
    "/api/health",
    "/api/tickers",
    "/api/analyze/status",
    "/docs",
    "/openapi.json",
}

# Prefixes that are public
PUBLIC_PREFIXES = ("/api/auth/",)

# SSE stream and cancel endpoints are secured by unguessable session IDs.
# EventSource API cannot send Authorization headers, so these must be public.
_ANALYZE_SESSION_RE = re.compile(r"^/api/analyze/[a-f0-9]+/(stream|cancel)$")


def _is_public(path: str, method: str) -> bool:
    if method == "OPTIONS":
        return True
    if path in PUBLIC_PATHS:
        return True
    for prefix in PUBLIC_PREFIXES:
        if path.startswith(prefix):
            return True
    if _ANALYZE_SESSION_RE.match(path):
        return True
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if _is_public(request.url.path, request.method):
            return await call_next(request)

        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing or invalid authorization header"},
            )

        token = auth_header[7:]  # Strip "Bearer "

        try:
            key, algorithms = _get_signing_key(token)
            payload = jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience="authenticated",
            )
            request.state.user_id = payload["sub"]
        except JWTError as e:
            log.warning("Auth failed for %s %s: %s", request.method, request.url.path, e)
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
            )
        except KeyError:
            log.warning("Auth token missing claims for %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=401,
                content={"detail": "Token missing required claims"},
            )

        return await call_next(request)
