"""
arfour — Auth Middleware

Validates Supabase JWT tokens on protected routes.
Injects user_id into request state for downstream handlers.
"""

import os
import re
from jose import jwt, JWTError
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

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
            jwt_secret = os.environ["SUPABASE_JWT_SECRET"]
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
            request.state.user_id = payload["sub"]
        except JWTError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
            )
        except KeyError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Token missing required claims"},
            )

        return await call_next(request)
