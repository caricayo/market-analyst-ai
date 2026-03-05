"""
dashboard/app.py — Streamlit trading dashboard.

Run: streamlit run dashboard/app.py

Pages:
  1. Live Status          — Mode banner, portfolio value, heartbeat monitor
  2. Open Positions       — Active trades with price charts
  3. Trade History        — All closed trades, filterable
  4. Performance          — Equity curve, drawdown, Sharpe, win rate
  5. Model Signals        — Latest predictions for all watchlist coins
  6. Walk-Forward Results — Simulation reports with per-coin/per-day breakdown
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timezone, timedelta

import config
from src.database.reader import (
    get_open_trades, get_trades, get_daily_stats, get_current_model,
    get_model_versions, get_last_heartbeat, get_rolling_win_rate,
    get_simulation_results, get_kill_switch_events,
)
from src.database.models import init_db

# Ensure DB exists
init_db()

# ─── Page config ──────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Crypto Trading Dashboard",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Mode banner ──────────────────────────────────────────────────────────────

def mode_banner():
    if config.PAPER_TRADING:
        st.success("PAPER TRADING MODE — No real money at risk", icon="📄")
    else:
        st.error("⚠️  LIVE TRADING — REAL MONEY AT RISK  ⚠️", icon="💰")

# ─── Sidebar navigation ───────────────────────────────────────────────────────

st.sidebar.title("📈 Crypto Bot")
mode_banner()

page = st.sidebar.radio(
    "Navigation",
    ["Live Status", "Open Positions", "Trade History", "Performance",
     "Model Signals", "Walk-Forward Results"],
)

st.sidebar.markdown("---")
st.sidebar.caption(f"Auto-refresh every 30s")
st.sidebar.caption(f"Mode: {'PAPER' if config.PAPER_TRADING else 'LIVE'}")

# Auto-refresh every 30 seconds
st.markdown(
    '<meta http-equiv="refresh" content="30">',
    unsafe_allow_html=True,
)


# ─── Helper functions ─────────────────────────────────────────────────────────

def fmt_pnl(v: float) -> str:
    color = "green" if v >= 0 else "red"
    return f'<span style="color:{color}">${v:+,.2f}</span>'

def fmt_pct(v: float) -> str:
    color = "green" if v >= 0 else "red"
    return f'<span style="color:{color}">{v:+.2%}</span>'

def heartbeat_status(job: str, warn_minutes: int = 10) -> tuple[str, str]:
    """Returns (status_text, color)."""
    hb = get_last_heartbeat(job)
    if hb is None:
        return "Never", "red"
    age = (datetime.now(timezone.utc) - hb.timestamp).total_seconds() / 60
    if age > warn_minutes:
        return f"{age:.0f} min ago ⚠️", "red"
    return f"{age:.1f} min ago ✓", "green"


# ─── Page: Live Status ────────────────────────────────────────────────────────

if page == "Live Status":
    st.title("Live Status")

    # Heartbeat monitor
    st.subheader("System Health")
    col1, col2, col3, col4 = st.columns(4)
    jobs = [
        ("morning_routine", "Morning Routine", 1440),  # warn after 24h
        ("intraday_monitor", "Intraday Monitor", 10),
        ("eod_exit", "EOD Exit", 1440),
        ("weekly_retrain", "Weekly Retrain", 10080),
    ]
    for col, (job, label, warn) in zip([col1, col2, col3, col4], jobs):
        txt, color = heartbeat_status(job, warn)
        col.metric(label, txt)

    st.markdown("---")

    # Portfolio summary
    st.subheader("Portfolio")
    open_trades = get_open_trades(paper=config.PAPER_TRADING)
    daily = get_daily_stats(days=1, paper=config.PAPER_TRADING)

    col1, col2, col3, col4 = st.columns(4)
    today = daily[0] if daily else None

    col1.metric("Open Positions", len(open_trades))
    if today:
        col2.metric("Daily P&L", f"${today.daily_pnl_usdt or 0:+,.2f}",
                    delta=f"{today.daily_pnl_pct or 0:+.2%}")
        col3.metric("Portfolio End Value",
                    f"${today.portfolio_value_end or today.portfolio_value_start:,.2f}")
    rolling_wr = get_rolling_win_rate(14, paper=config.PAPER_TRADING)
    col4.metric("14-Day Win Rate", f"{rolling_wr:.1%}" if rolling_wr else "N/A")

    # Kill switch events
    ks_events = get_kill_switch_events(limit=5)
    if ks_events:
        st.markdown("---")
        st.subheader("Recent Kill Switch Events")
        ks_data = [{
            "Time": e.triggered_at.strftime("%Y-%m-%d %H:%M UTC"),
            "Level": e.level.upper(),
            "Trigger": f"{e.trigger_pct:.2%}",
            "Portfolio": f"${e.portfolio_value:,.2f}",
        } for e in ks_events]
        st.dataframe(pd.DataFrame(ks_data), use_container_width=True)

    # Current model
    st.markdown("---")
    st.subheader("Current Model")
    model = get_current_model()
    if model:
        col1, col2, col3 = st.columns(3)
        col1.metric("Version", model.version_tag)
        col2.metric("Walk-Forward AUC", f"{model.wf_auc_mean:.4f}" if model.wf_auc_mean else "N/A")
        col3.metric("Trained", model.trained_at.strftime("%Y-%m-%d"))
    else:
        st.warning("No model trained yet. Run: python scripts/train_model.py")


# ─── Page: Open Positions ─────────────────────────────────────────────────────

elif page == "Open Positions":
    st.title("Open Positions")

    open_trades = get_open_trades(paper=config.PAPER_TRADING)

    if not open_trades:
        st.info("No open positions.")
    else:
        for trade in open_trades:
            with st.expander(f"{trade.symbol} — opened {trade.opened_at.strftime('%H:%M UTC')}"):
                col1, col2, col3, col4 = st.columns(4)
                col1.metric("Entry Price", f"${trade.entry_price:,.4f}")
                col2.metric("Stop Loss", f"${trade.stop_loss_price:,.4f}")
                col3.metric("Take Profit", f"${trade.take_profit_price:,.4f}")
                col4.metric("Confidence", f"{trade.model_confidence:.1%}" if trade.model_confidence else "N/A")

                col1.metric("Quantity", f"{trade.quantity:.6f}")
                col2.metric("Position Value", f"${trade.position_value:,.2f}")
                col3.metric("Entry Fee", f"${trade.entry_fee_usdt:.2f}" if trade.entry_fee_usdt else "N/A")

                from src.risk.stop_loss import risk_reward_ratio
                rr = risk_reward_ratio(trade.entry_price, trade.stop_loss_price, trade.take_profit_price)
                col4.metric("R:R Ratio", f"{rr:.1f}:1")


# ─── Page: Trade History ──────────────────────────────────────────────────────

elif page == "Trade History":
    st.title("Trade History")

    col1, col2, col3 = st.columns(3)
    with col1:
        symbol_filter = st.selectbox("Symbol", ["All"] + config.WATCHLIST)
    with col2:
        limit = st.number_input("Max rows", min_value=10, max_value=1000, value=100, step=10)

    symbol = None if symbol_filter == "All" else symbol_filter
    trades = get_trades(limit=int(limit), paper=config.PAPER_TRADING, symbol=symbol)

    if not trades:
        st.info("No closed trades yet.")
    else:
        data = []
        for t in trades:
            if t.closed_at is None:
                continue
            data.append({
                "Date":       t.opened_at.strftime("%Y-%m-%d"),
                "Symbol":     t.symbol,
                "Entry":      f"${t.entry_price:,.4f}",
                "Exit":       f"${t.exit_price:,.4f}" if t.exit_price else "—",
                "P&L":        f"${t.pnl_usdt:+.2f}" if t.pnl_usdt else "—",
                "P&L %":      f"{t.pnl_pct:+.2%}" if t.pnl_pct else "—",
                "Exit Reason": t.exit_reason or "—",
                "Confidence":  f"{t.model_confidence:.1%}" if t.model_confidence else "—",
            })

        df = pd.DataFrame(data)
        st.dataframe(df, use_container_width=True, height=500)

        # Quick stats
        closed = [t for t in trades if t.closed_at and t.pnl_usdt is not None]
        if closed:
            wins = sum(1 for t in closed if t.pnl_usdt > 0)
            total_pnl = sum(t.pnl_usdt for t in closed)
            st.markdown("---")
            col1, col2, col3, col4 = st.columns(4)
            col1.metric("Total Trades", len(closed))
            col2.metric("Win Rate", f"{wins/len(closed):.1%}")
            col3.metric("Total P&L", f"${total_pnl:+,.2f}")
            col4.metric("By Exit", "")


# ─── Page: Performance ────────────────────────────────────────────────────────

elif page == "Performance":
    st.title("Performance")

    daily = get_daily_stats(days=90, paper=config.PAPER_TRADING)

    if not daily:
        st.info("No performance data yet. Run the trading system for at least one day.")
    else:
        daily_rev = list(reversed(daily))
        dates = [d.date for d in daily_rev]
        pnl_pcts = [d.daily_pnl_pct or 0 for d in daily_rev]

        # Equity curve
        equity = [100.0]
        for p in pnl_pcts:
            equity.append(equity[-1] * (1 + p))

        st.subheader("Equity Curve")
        fig_eq = go.Figure()
        fig_eq.add_trace(go.Scatter(
            x=dates + [dates[-1]],
            y=equity[1:],
            mode="lines+markers",
            name="Portfolio Value (rebased to 100)",
            line=dict(color="cyan", width=2),
        ))
        fig_eq.update_layout(template="plotly_dark", height=300,
                             margin=dict(t=20, b=20))
        st.plotly_chart(fig_eq, use_container_width=True)

        # Drawdown curve
        peak = equity[0]
        drawdowns = []
        for v in equity[1:]:
            if v > peak:
                peak = v
            drawdowns.append((v - peak) / peak)

        st.subheader("Drawdown")
        fig_dd = go.Figure()
        fig_dd.add_trace(go.Scatter(
            x=dates, y=[d * 100 for d in drawdowns],
            fill="tozeroy", fillcolor="rgba(255,50,50,0.3)",
            line=dict(color="red"),
            name="Drawdown %",
        ))
        fig_dd.update_layout(template="plotly_dark", height=200,
                             yaxis_title="%", margin=dict(t=20, b=20))
        st.plotly_chart(fig_dd, use_container_width=True)

        # Summary metrics
        st.subheader("Summary")
        total_return = (equity[-1] / 100 - 1)
        max_dd = min(drawdowns)
        sharpe = (np.mean(pnl_pcts) / np.std(pnl_pcts) * np.sqrt(252)
                  if np.std(pnl_pcts) > 0 else 0)

        all_trades = get_trades(limit=9999, paper=config.PAPER_TRADING)
        closed = [t for t in all_trades if t.closed_at and t.pnl_usdt is not None]
        win_rate = sum(1 for t in closed if t.pnl_usdt > 0) / len(closed) if closed else 0

        col1, col2, col3, col4, col5 = st.columns(5)
        col1.metric("Total Return", f"{total_return:+.2%}")
        col2.metric("Max Drawdown", f"{max_dd:.2%}")
        col3.metric("Sharpe Ratio", f"{sharpe:.2f}")
        col4.metric("Win Rate", f"{win_rate:.1%}")
        col5.metric("14-Day Rolling WR",
                    f"{get_rolling_win_rate(14, paper=config.PAPER_TRADING):.1%}"
                    if get_rolling_win_rate(14, paper=config.PAPER_TRADING) else "N/A")


# ─── Page: Model Signals ──────────────────────────────────────────────────────

elif page == "Model Signals":
    st.title("Model Signals")
    st.caption("Scores are computed from the last saved data. Click 'Refresh Scores' to update.")

    if st.button("Refresh Scores"):
        with st.spinner("Scoring watchlist..."):
            try:
                from src.ml.predictor import score_watchlist
                signals = score_watchlist(update_data=False)
                st.session_state["signals"] = signals
            except Exception as e:
                st.error(f"Scoring failed: {e}")

    signals = st.session_state.get("signals", [])
    if signals:
        for sig in signals:
            symbol = sig["symbol"]
            conf = sig.get("confidence", 0)
            is_signal = sig.get("signal", False)

            col1, col2, col3, col4 = st.columns([2, 2, 2, 1])
            col1.write(f"**{symbol}**")
            col2.progress(conf, text=f"{conf:.1%}")
            col3.write(f"${sig.get('current_price', 0):,.4f}")
            col4.write("🟢 SIGNAL" if is_signal else "⚪ below threshold")
    else:
        st.info("Click 'Refresh Scores' to see current signals.")

    # Model version history
    st.markdown("---")
    st.subheader("Model Version History")
    versions = get_model_versions()
    if versions:
        vdata = [{
            "Version": v.version_tag,
            "AUC (WF)": f"{v.wf_auc_mean:.4f}" if v.wf_auc_mean else "N/A",
            "AUC (IS)": f"{v.auc_score:.4f}",
            "Train End": v.train_end,
            "Accepted": "✅" if v.accepted else "❌",
            "Current": "⭐" if v.is_current else "",
            "Trained": v.trained_at.strftime("%Y-%m-%d %H:%M"),
        } for v in versions]
        st.dataframe(pd.DataFrame(vdata), use_container_width=True)
    else:
        st.info("No models trained yet.")


# ─── Page: Walk-Forward Results ───────────────────────────────────────────────

elif page == "Walk-Forward Results":
    st.title("Walk-Forward Simulation Results")

    results = get_simulation_results(limit=10)

    if not results:
        st.info("No simulation results yet. Run: python scripts/run_simulation.py")
    else:
        # Simulation selector
        run_options = [f"{r.run_id} ({r.sim_start} → {r.sim_end})" for r in results]
        selected_run = st.selectbox("Select Simulation Run", run_options)
        run_idx = run_options.index(selected_run)
        sim = results[run_idx]

        # Summary metrics
        col1, col2, col3, col4, col5 = st.columns(5)
        col1.metric("Total Trades", sim.total_trades)
        col2.metric("Win Rate", f"{sim.win_rate:.1%}" if sim.win_rate else "N/A")
        col3.metric("Total Return", f"{sim.total_return_pct:+.2%}" if sim.total_return_pct else "N/A")
        col4.metric("Max Drawdown", f"{sim.max_drawdown_pct:.2%}" if sim.max_drawdown_pct else "N/A")
        col5.metric("Sharpe Ratio", f"{sim.sharpe_ratio:.2f}" if sim.sharpe_ratio else "N/A")

        col1, col2, col3 = st.columns(3)
        col1.metric("Profit Factor", f"{sim.profit_factor:.2f}" if sim.profit_factor else "N/A")
        col2.metric("Avg Win", f"{sim.avg_win_pct:.2%}" if sim.avg_win_pct else "N/A")
        col3.metric("Avg Loss", f"{sim.avg_loss_pct:.2%}" if sim.avg_loss_pct else "N/A")

        # Trade log from DB
        st.markdown("---")
        st.subheader("Trade Log")
        sim_trades = get_trades(
            limit=9999,
            paper=True,
            simulation_run_id=sim.run_id,
        )
        if sim_trades:
            date_filter = st.text_input("Filter by date (YYYY-MM-DD)", "")
            data = []
            for t in sim_trades:
                if t.closed_at is None:
                    continue
                row = {
                    "Date":       t.opened_at.strftime("%Y-%m-%d"),
                    "Symbol":     t.symbol,
                    "Confidence": f"{t.model_confidence:.1%}" if t.model_confidence else "—",
                    "Entry":      f"${t.entry_price:,.4f}",
                    "Exit":       f"${t.exit_price:,.4f}" if t.exit_price else "—",
                    "Actual":     f"{t.pnl_pct:+.2%}" if t.pnl_pct else "—",
                    "Correct":    "✅" if t.prediction_correct else "❌",
                    "Exit":       t.exit_reason or "—",
                    "P&L":        f"${t.pnl_usdt:+.2f}" if t.pnl_usdt else "—",
                }
                if date_filter and date_filter not in row["Date"]:
                    continue
                data.append(row)

            if data:
                st.dataframe(pd.DataFrame(data), use_container_width=True, height=400)
            else:
                st.info("No trades match the date filter.")
        else:
            st.info("Detailed trade log not available for this simulation run.")

        # Run info
        st.markdown("---")
        st.caption(f"Run ID: {sim.run_id} | Run date: {sim.run_date} | Model: {sim.model_version or 'N/A'}")
