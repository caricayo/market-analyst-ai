"""
scripts/manual_retrain.py — Trigger a manual model retrain outside the weekly schedule.

Run: python scripts/manual_retrain.py

Useful after downloading significant new historical data or after a model
has been performing poorly on live data.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from loguru import logger
from src.ml.retrainer import run_weekly_retrain


def main():
    print()
    print("=" * 60)
    print("  Manual Model Retrain")
    print("  Same logic as weekly retrain — AUC gate enforced")
    print("=" * 60)
    print()

    result = run_weekly_retrain()
    if result:
        print()
        print("=" * 60)
        print(f"  Done: {result['version_tag']}")
        print(f"  Walk-forward AUC: {result['wf_auc_mean']:.4f}")
        print(f"  Accepted: {'YES' if result['accepted'] else 'NO'}")
        print("=" * 60)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
