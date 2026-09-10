"""Variable-length bounded 1D navigation task — the flagship experiment's
task family.

Generalizes the original fixed-length-4 line-navigation task
(src/reasoning/line-navigation-task.js) to variable move-sequence length,
which is what creates genuine variable computational complexity: a
2-move instance and a 24-move instance are not the same difficulty.

Task: starting at GRID_CENTER on a bounded integer line
[0, GRID_SIZE - 1], apply `len(moves)` clamped +/-1 steps (0 = left,
1 = right) and predict the final position. Deterministic, independently
verifiable by direct simulation (no learned component needed to compute
ground truth), and cheap to generate in bulk.

This module has NO PyTorch dependency and NO randomness of its own beyond
what a caller-supplied `random.Random` provides — it is the single source
of truth for "what is the correct answer," used identically by dataset
generation, training (for loss labels), and evaluation (for accuracy).
"""

from __future__ import annotations

import random
from dataclasses import dataclass

GRID_SIZE = 11
GRID_CENTER = GRID_SIZE // 2  # 5


def solve(moves: list[int]) -> int:
    """Independent reference solver — the ground truth. No model involved."""
    position = GRID_CENTER
    for move in moves:
        position = max(0, min(GRID_SIZE - 1, position + (1 if move == 1 else -1)))
    return position


@dataclass(frozen=True)
class Split:
    name: str
    moves: list[list[int]]
    labels: list[int]

    def __len__(self) -> int:
        return len(self.moves)


def _enumerate(length_range: tuple[int, int]) -> list[list[int]]:
    """All distinct move sequences with length in `length_range`. Only
    used for the short in-distribution range (2-8 moves => 2^2+...+2^8 =
    508 total) — small enough to enumerate exactly, which is what makes a
    zero-overlap TRAIN/VAL/TEST_SEEN partition possible *by construction*
    rather than by hoping independent random sampling doesn't collide (it
    provably can't avoid colliding here: 508 possible sequences is far
    fewer than the thousands of i.i.d. samples a real dataset needs).
    """
    min_len, max_len = length_range
    sequences: list[list[int]] = []
    for length in range(min_len, max_len + 1):
        for bits in range(2 ** length):
            sequences.append([(bits >> position) & 1 for position in range(length)])
    return sequences


def _split_from_moves(name: str, moves_list: list[list[int]]) -> Split:
    return Split(name=name, moves=moves_list, labels=[solve(m) for m in moves_list])


def generate_split(name: str, count: int, length_range: tuple[int, int], seed: int) -> Split:
    """i.i.d. sampling with replacement — only appropriate for a length
    range whose space is far larger than `count` (TEST_UNSEEN: lengths
    12-24 span roughly 2^25 possible sequences against 1000 samples, so
    collision with anything else is negligible and not specifically
    guarded against here).
    """
    rng = random.Random(seed)
    min_len, max_len = length_range
    moves_list = [[rng.randint(0, 1) for _ in range(rng.randint(min_len, max_len))] for _ in range(count)]
    return _split_from_moves(name, moves_list)


# TRAIN/VAL/TEST_SEEN all draw from the same short-length range and
# together exhaust its entire enumerable space (see _enumerate) via a
# disjoint partition — not independent sampling — so overlap between them
# is structurally impossible rather than merely checked for. TEST_UNSEEN
# uses a disjoint, much longer range, sampled i.i.d.: this is what makes it
# a genuine length-extrapolation held-out test, not just more of the same.
TRAIN_LENGTH_RANGE = (2, 8)
TEST_UNSEEN_LENGTH_RANGE = (12, 24)
IN_DISTRIBUTION_SPLIT_SEED = 1000
TRAIN_FRACTION = 0.70
VAL_FRACTION = 0.15
# TEST_SEEN gets the remainder (~0.15) of the enumerated short-length space.

SPLIT_SPECS = {
    "test_unseen": {"count": 1000, "length_range": TEST_UNSEEN_LENGTH_RANGE, "seed": 4000},
}


def generate_all_splits() -> dict[str, Split]:
    universe = _enumerate(TRAIN_LENGTH_RANGE)
    random.Random(IN_DISTRIBUTION_SPLIT_SEED).shuffle(universe)
    n = len(universe)
    train_end = int(n * TRAIN_FRACTION)
    val_end = train_end + int(n * VAL_FRACTION)
    splits = {
        "train": _split_from_moves("train", universe[:train_end]),
        "val": _split_from_moves("val", universe[train_end:val_end]),
        "test_seen": _split_from_moves("test_seen", universe[val_end:]),
        "test_unseen": generate_split(name="test_unseen", **SPLIT_SPECS["test_unseen"]),
    }
    return splits


def assert_no_leakage(splits: dict[str, Split]) -> None:
    """TEST DATA MUST NEVER APPEAR IN TRAIN. Verified, not assumed: even
    though train/val/test_seen are constructed as a disjoint partition
    (see generate_all_splits), this checks the actual generated instances
    directly rather than trusting the construction was correct.
    """
    train_set = {tuple(m) for m in splits["train"].moves}
    for name in ("val", "test_seen", "test_unseen"):
        overlap = train_set & {tuple(m) for m in splits[name].moves}
        if overlap:
            raise RuntimeError(f"Data leakage: {len(overlap)} instance(s) shared between train and {name}.")
