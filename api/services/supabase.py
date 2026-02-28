"""
arfour — Supabase Client

Lightweight Supabase REST API client using postgrest-py.
Uses service role key to bypass RLS for backend operations.
"""

import os
from functools import lru_cache

from postgrest import SyncPostgrestClient


@lru_cache()
def get_supabase_admin() -> SyncPostgrestClient:
    """Get a PostgREST client with service role key (bypasses RLS)."""
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return SyncPostgrestClient(
        base_url=f"{url}/rest/v1",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
    )


def get_jwt_secret() -> str:
    return os.environ["SUPABASE_JWT_SECRET"]
