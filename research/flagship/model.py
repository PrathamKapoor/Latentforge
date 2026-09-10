"""Models for the flagship experiment.

RecurrentReasoner is the trained recurrent model under test: a single
GRUCell consumes the move sequence one step at a time ("encoding" — this
is dictated by input length, not a free variable), then applies
`thinking_steps` additional self-transitions fed a fixed zero input
("thinking" — this is the independently controllable computation budget,
the same transition function reused, no new information injected). A
linear head reads a prediction from the hidden state after every step of
both phases, but only the FINAL step's logits are used for the loss and
for the reported prediction — the model is trained on end-task
correctness, not step-wise supervision.

OneShotBaseline is Baseline A: an order-blind MLP over a fixed-size
summary (count of left moves, count of right moves, sequence length) —
no recurrence, no access to move order. It is expected to do fine on
short sequences (order rarely matters before a clamp boundary is hit) and
to degrade as sequences lengthen and boundary-clamping interactions
compound, which is the point of including it: it is not a strawman, it
fails for a specific, explainable reason tied to what recurrence gives
the trained model that a one-shot summary cannot.
"""

from __future__ import annotations

import torch
from torch import nn


class RecurrentReasoner(nn.Module):
    def __init__(self, hidden_size: int, grid_size: int):
        super().__init__()
        self.hidden_size = hidden_size
        self.cell = nn.GRUCell(input_size=1, hidden_size=hidden_size)
        self.head = nn.Linear(hidden_size, grid_size)

    def forward(self, moves: torch.Tensor, lengths: torch.Tensor, thinking_steps: int) -> tuple[torch.Tensor, torch.Tensor]:
        """`moves`: (batch, max_len) float tensor of -1.0/+1.0, zero-padded
        past each example's own length. `lengths`: (batch,) int tensor of
        each example's real move count. Returns (final_logits, final_hidden).

        Padding is handled by only advancing the hidden state for real
        moves (`step < lengths`) at each encoding position — a padded
        example's hidden state simply stops updating for the rest of the
        encoding phase, which is equivalent to that example's own encoding
        having already finished, and is what makes one batched forward
        pass over variable-length examples exact rather than approximate.
        """
        batch_size, max_len = moves.shape
        h = torch.zeros(batch_size, self.hidden_size, dtype=moves.dtype, device=moves.device)
        for step in range(max_len):
            active = (step < lengths).unsqueeze(1).to(moves.dtype)
            step_input = moves[:, step].unsqueeze(1)
            h_next = self.cell(step_input, h)
            h = active * h_next + (1 - active) * h

        zero_input = torch.zeros(batch_size, 1, dtype=moves.dtype, device=moves.device)
        for _ in range(thinking_steps):
            h = self.cell(zero_input, h)

        logits = self.head(h)
        return logits, h

    def trajectory(self, moves: list[int], thinking_steps: int) -> dict:
        """Single-example (batch size 1), step-by-step trajectory with a
        prediction at every step — used by the live API/UI, not training.
        """
        self.eval()
        with torch.no_grad():
            h = torch.zeros(1, self.hidden_size, dtype=torch.float32)
            steps = []
            for move in moves:
                step_input = torch.tensor([[1.0 if move == 1 else -1.0]], dtype=torch.float32)
                h = self.cell(step_input, h)
                logits = self.head(h)
                steps.append({"phase": "encode", "hidden": h.squeeze(0).tolist(), "logits": logits.squeeze(0).tolist(), "prediction": int(torch.argmax(logits, dim=1).item())})
            zero_input = torch.zeros(1, 1, dtype=torch.float32)
            for _ in range(thinking_steps):
                h = self.cell(zero_input, h)
                logits = self.head(h)
                steps.append({"phase": "think", "hidden": h.squeeze(0).tolist(), "logits": logits.squeeze(0).tolist(), "prediction": int(torch.argmax(logits, dim=1).item())})
            return {"steps": steps, "finalPrediction": steps[-1]["prediction"] if steps else None}


class OneShotBaseline(nn.Module):
    """Baseline A: order-blind summary -> MLP -> position logits. No
    recurrence, no computation budget — always exactly one forward pass.
    """

    def __init__(self, grid_size: int, hidden_size: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(3, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, grid_size),
        )

    @staticmethod
    def featurize(moves_batch: list[list[int]]) -> torch.Tensor:
        features = []
        for moves in moves_batch:
            right = sum(1 for m in moves if m == 1)
            left = len(moves) - right
            features.append([float(left), float(right), float(len(moves))])
        return torch.tensor(features, dtype=torch.float32)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return self.net(features)
