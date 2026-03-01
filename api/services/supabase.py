"""
arfour — Supabase Client

Async Supabase REST API client using postgrest-py AsyncPostgrestClient.
Uses service role key to bypass RLS for backend operations.
"""

import os

from postgrest import AsyncPostgrestClient

_client: AsyncPostgrestClient | None = None


def get_supabase_admin() -> AsyncPostgrestClient:
    """Get an async PostgREST client with service role key (bypasses RLS)."""
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = AsyncPostgrestClient(
            base_url=f"{url}/rest/v1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
        )
    return _client


def get_jwt_secret() -> str:
    return os.environ["SUPABASE_JWT_SECRET"]
