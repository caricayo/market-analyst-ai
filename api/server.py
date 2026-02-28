"""
arfour — FastAPI Server

Entry point: uvicorn api.server:app --reload --port 8000
"""

import os
import sys
from pathlib import Path

# Ensure project root is in path
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.analyze import router as analyze_router
from api.routes.tickers import router as tickers_router

app = FastAPI(
    title="arfour",
    description="Multi-perspective investment intelligence",
    version="0.1.0",
)

# CORS — allow frontend (dev + production)
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router)
app.include_router(tickers_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "arfour"}
