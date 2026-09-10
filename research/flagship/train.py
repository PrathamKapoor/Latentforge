"""Train the flagship recurrent model and the one-shot baseline.

Usage: python research/flagship/train.py [--out-dir DIR]

Deterministic given a seed: same seed -> same data order -> same weights.
Trains `SEEDS` independent models of each kind (statistical discipline —
see LATENTFORGE report for why one seed is not enough) and keeps, per
seed, whichever epoch had the best validation accuracy (validation is
used ONLY for this early-stopping-style checkpoint choice — never for
picking the test-time computation budget, and test splits are never
touched here at all).

Fast by design: small model, small dataset, CPU, a couple thousand
optimizer steps total per seed — target is low tens of seconds, not
minutes, per seed (see the timing recorded in training_log.json).
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch
from torch import nn

from model import OneShotBaseline, RecurrentReasoner
from task import GRID_SIZE, TRAIN_LENGTH_RANGE, assert_no_leakage, generate_all_splits

SEEDS = (7, 13, 21)
THINKING_STEPS_TRAIN = 4
HIDDEN_SIZE = 64
EPOCHS = 120
BATCH_SIZE = 128
LEARNING_RATE = 1e-3
MAX_TRAIN_LEN = TRAIN_LENGTH_RANGE[1]


def encode_moves(moves_batch: list[list[int]], max_len: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Pad to `max_len` with zeros (a real move is always +/-1.0, so 0.0
    padding is unambiguous) and return the real per-example length.
    """
    padded = torch.zeros(len(moves_batch), max_len, dtype=torch.float32)
    lengths = torch.zeros(len(moves_batch), dtype=torch.long)
    for i, moves in enumerate(moves_batch):
        lengths[i] = len(moves)
        for j, move in enumerate(moves):
            padded[i, j] = 1.0 if move == 1 else -1.0
    return padded, lengths


def batches(n: int, batch_size: int, rng: random.Random):
    indices = list(range(n))
    rng.shuffle(indices)
    for start in range(0, n, batch_size):
        yield indices[start:start + batch_size]


def train_recurrent(seed: int, train_split, val_split) -> dict:
    torch.manual_seed(seed)
    model = RecurrentReasoner(hidden_size=HIDDEN_SIZE, grid_size=GRID_SIZE)
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    loss_fn = nn.CrossEntropyLoss()
    order_rng = random.Random(seed + 500000)

    train_moves, train_lengths = encode_moves(train_split.moves, MAX_TRAIN_LEN)
    train_labels = torch.tensor(train_split.labels, dtype=torch.long)
    val_moves, val_lengths = encode_moves(val_split.moves, MAX_TRAIN_LEN)
    val_labels = torch.tensor(val_split.labels, dtype=torch.long)

    best_state = None
    best_val_acc = -1.0
    epoch_log = []
    started = time.perf_counter()
    for epoch in range(EPOCHS):
        model.train()
        epoch_loss = 0.0
        n_batches = 0
        for batch_idx in batches(len(train_split), BATCH_SIZE, order_rng):
            idx = torch.tensor(batch_idx, dtype=torch.long)
            logits, _ = model(train_moves[idx], train_lengths[idx], THINKING_STEPS_TRAIN)
            loss = loss_fn(logits, train_labels[idx])
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.item())
            n_batches += 1

        model.eval()
        with torch.no_grad():
            val_logits, _ = model(val_moves, val_lengths, THINKING_STEPS_TRAIN)
            val_acc = float((val_logits.argmax(dim=1) == val_labels).float().mean().item())
        epoch_log.append({"epoch": epoch, "trainLoss": epoch_loss / max(n_batches, 1), "valAccuracy": val_acc})
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    elapsed = time.perf_counter() - started
    return {"model": model, "bestValAccuracy": best_val_acc, "epochLog": epoch_log, "trainSeconds": elapsed, "seed": seed}


def train_baseline(seed: int, train_split, val_split) -> dict:
    torch.manual_seed(seed)
    model = OneShotBaseline(grid_size=GRID_SIZE)
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    loss_fn = nn.CrossEntropyLoss()
    order_rng = random.Random(seed + 600000)

    train_features = OneShotBaseline.featurize(train_split.moves)
    train_labels = torch.tensor(train_split.labels, dtype=torch.long)
    val_features = OneShotBaseline.featurize(val_split.moves)
    val_labels = torch.tensor(val_split.labels, dtype=torch.long)

    best_state = None
    best_val_acc = -1.0
    started = time.perf_counter()
    for _epoch in range(EPOCHS):
        model.train()
        for batch_idx in batches(len(train_split), BATCH_SIZE, order_rng):
            idx = torch.tensor(batch_idx, dtype=torch.long)
            logits = model(train_features[idx])
            loss = loss_fn(logits, train_labels[idx])
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            val_acc = float((model(val_features).argmax(dim=1) == val_labels).float().mean().item())
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    elapsed = time.perf_counter() - started
    return {"model": model, "bestValAccuracy": best_val_acc, "trainSeconds": elapsed, "seed": seed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parent / "checkpoints"))
    args = parser.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    splits = generate_all_splits()
    assert_no_leakage(splits)
    train_split, val_split = splits["train"], splits["val"]
    print(f"[data] train={len(train_split)} val={len(val_split)} test_seen={len(splits['test_seen'])} test_unseen={len(splits['test_unseen'])}", flush=True)

    log = {"thinkingStepsTrain": THINKING_STEPS_TRAIN, "hiddenSize": HIDDEN_SIZE, "epochs": EPOCHS, "batchSize": BATCH_SIZE, "learningRate": LEARNING_RATE, "seeds": list(SEEDS), "recurrent": [], "baseline": []}

    for seed in SEEDS:
        print(f"[train] recurrent seed={seed}", flush=True)
        result = train_recurrent(seed, train_split, val_split)
        torch.save(result["model"].state_dict(), out_dir / f"recurrent-seed{seed}.pt")
        log["recurrent"].append({"seed": seed, "bestValAccuracy": result["bestValAccuracy"], "trainSeconds": result["trainSeconds"], "epochLog": result["epochLog"]})
        print(f"  best val accuracy: {result['bestValAccuracy']:.4f} ({result['trainSeconds']:.1f}s)", flush=True)

        print(f"[train] baseline seed={seed}", flush=True)
        baseline_result = train_baseline(seed, train_split, val_split)
        torch.save(baseline_result["model"].state_dict(), out_dir / f"baseline-seed{seed}.pt")
        log["baseline"].append({"seed": seed, "bestValAccuracy": baseline_result["bestValAccuracy"], "trainSeconds": baseline_result["trainSeconds"]})
        print(f"  best val accuracy: {baseline_result['bestValAccuracy']:.4f} ({baseline_result['trainSeconds']:.1f}s)", flush=True)

    (out_dir / "training_log.json").write_text(json.dumps(log, indent=2))
    print(f"Wrote checkpoints and training_log.json to {out_dir}")


if __name__ == "__main__":
    main()
