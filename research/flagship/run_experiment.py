"""Reproduce the flagship experiment end to end: train, then evaluate.

    python research/flagship/run_experiment.py

Deterministic given the fixed seeds in train.py/evaluate.py (7, 13, 21).
Takes well under a minute on a single CPU core. This is the one command a
reviewer needs to regenerate every number this project reports for the
flagship experiment — see results/flagship-experiment.json for the output
and docs/flagship-experiment.md for what it means. Runs train.py and
evaluate.py as real subprocesses (rather than importing them) so this
script's own working directory and import path never interfere with
theirs — it does exactly what running each script by hand would do.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(script_name: str) -> None:
    result = subprocess.run([sys.executable, str(HERE / script_name)], cwd=str(HERE))
    if result.returncode != 0:
        sys.exit(result.returncode)


def main():
    started = time.perf_counter()
    print("=== [1/2] training ===", flush=True)
    run("train.py")
    print("\n=== [2/2] evaluating ===", flush=True)
    run("evaluate.py")
    print(f"\nDone in {time.perf_counter() - started:.1f}s.")


if __name__ == "__main__":
    main()
