"""
scripts/train_model.py — Train the XGBoost model on historical data.

Run: python scripts/train_model.py

Enforces training/simulation data boundary automatically.
Model is saved only if walk-forward AUC >= 0.55.
"""

import sys
import io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from loguru import logger
import config
from src.ml.trainer import train_model


def main():
    print()
    print("=" * 60)
    print("  XGBoost + LightGBM Dual-Model Training")
    print(f"  Training data: {config.TRAIN_START_DATE} to {config.TRAIN_END_DATE}")
    print(f"  Walk-forward folds: {config.WF_N_SPLITS}")
    print(f"  Confidence threshold: {config.MIN_MODEL_CONFIDENCE:.0%}")
    print()
    print("  NOTE: Data after TRAIN_END_DATE is reserved for")
    print(f"        walk-forward simulation (starts {config.SIMULATION_START_DATE})")
    print("        The models will NEVER see this data during training.")
    print("=" * 60)
    print()

    result = train_model()

    print()
    print("=" * 60)
    print("  Training Result")
    print("=" * 60)
    print(f"  Version:              {result['version_tag']}")
    print(f"  XGB walk-forward AUC: {result['wf_auc_mean']:.4f}")
    print(f"  LGB walk-forward AUC: {result.get('lgb_wf_auc', 'N/A')}")
    print(f"  In-sample AUC (XGB):  {result['auc_score']:.4f}")
    print(f"  Accepted:             {'YES' if result['accepted'] else 'NO'}")

    if result["accepted"]:
        print(f"  XGB model saved to:   {result['file_path']}")
        print(f"  LGB model saved to:   {config.CURRENT_LGB_MODEL_PATH}")
        print()
        print("\033[92m  SUCCESS — Both models accepted. Ready for simulation gate.\033[0m")
        print()
        print("  Next steps:")
        print("    python -X utf8 scripts/run_simulation.py --start 2024-07-01")
        print()
        print(f"  Training/simulation boundary confirmed: {config.TRAIN_END_DATE}")
        print("  Gate: win_rate > 55.9%, PF > 1.13, max_dd < 2.5%")
        return 0
    else:
        print()
        print(f"\033[91m  REJECTED — {result.get('rejection_reason', 'AUC below 0.55')}\033[0m")
        print()
        print("  Suggestions:")
        print("  1. Ensure download_historical_data.py ran successfully (10,000+ rows/coin)")
        print("  2. Try adjusting XGB_PARAMS / LGB_PARAMS in config.py")
        print("  3. Review feature_engineering.py for any data quality issues")
        return 1


if __name__ == "__main__":
    sys.exit(main())
