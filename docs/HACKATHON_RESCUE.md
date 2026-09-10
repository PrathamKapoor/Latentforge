# Hackathon Rescue — Priority Board

This document tracks the specific weakness identified going into this
pass — *"the flagship experiment demonstrates that repeated application
of an untrained recurrence changes a hidden state, but not a convincing
useful latent-reasoning phenomenon"* — and everything done in response.
Severity order: **P0** blocks submission, **P1** is a competitive
weakness, **P2** is polish. Work proceeded strictly P0 → P1 → P2.

## Re-auditing the prior audit (verified against source, not assumed)

Before any new code, every claim from the prior pass was re-checked
directly against the files it named:

| Claim | Verified? | Evidence |
|---|---|---|
| `LATENTFORGE_MAX_REASONING_BUDGET`/`MAX_TASK_LENGTH` are defined but unused | **Confirmed real** | `grep` for both names outside `config.js` returned nothing — the env vars were pure decoration. Fixed (see P0 below). |
| HTTP timeout doesn't cancel the worker job | **Confirmed real** | `server.js`'s timeout just abandoned the `enqueue()` promise; `worker-client.js` had no cancellation path. Fixed (see P0 below). |
| Body-size cap uses string length, not bytes | **Confirmed real** | `readJsonBody` did `raw += chunk; if (raw.length > MAX_BODY_BYTES)` on a decoded string. Fixed (see P0 below). |
| Queue/timeout/worker-lifecycle mechanics otherwise sound | **Confirmed** | Direct attack testing (concurrent requests, hard-killing the worker mid-request, SIGTERM shutdown) in the prior pass's own session, reproduced again this pass via the new `worker-client.test.js` abort tests. |
| CI/Docker were "created, not runtime-verified" | **Outdated — since fixed** | A real CI failure (cross-platform path-join bug, see `HACKATHON_BLOCKERS.md` B11) was found and fixed after the prior pass wrote that line; CI is now green with both `test` and `docker` jobs passing on GitHub Actions. |

## P0 — fixed this pass

1. **Timed-out jobs stranded the worker slot.** `server.js`'s request
   timeout now threads an `AbortSignal` into `pythonWorker.enqueue()`. A
   still-queued job is dropped immediately; an already-active job is
   treated like a hung worker (killed and restarted), freeing the slot
   right away instead of waiting out `WORKER_EXECUTION_TIMEOUT_MS`.
   Verified by two new `worker-client.test.js` cases and a manual restart
   race under real load.
2. **Body-size cap counted UTF-16 code units, not bytes.** Fixed to
   accumulate real `Buffer` byte lengths before decoding. Verified by a
   test payload built from `€` (3 UTF-8 bytes, 1 UTF-16 code unit) that is
   over the byte cap while under the code-unit cap — it now correctly
   rejects.
3. **`MAX_REASONING_BUDGET` was decorative.** Every backend now filters
   its allowed-budget set through it (a no-op at the default). Verified
   by a test that spawns a child process with the env var lowered and
   confirms a previously-valid budget is rejected.
4. **The flagship experiment itself was scientifically thin.** This is
   the big one — see "The new flagship experiment" below.

## P1 — competitive weaknesses addressed

- **No trained model.** Added `research/flagship/`: a real GRU-based
  recurrent model, trained (not randomly initialized) on a
  variable-length task family.
- **No held-out evaluation.** `TEST_UNSEEN` (lengths 12–24) is a
  length-extrapolation split the training loop never touches — see
  `research/flagship/task.py` for the leakage-proof split construction
  (the short-length space is small enough to enumerate and partition
  exactly, rather than hoping independent sampling doesn't collide —
  it provably would have).
- **No baseline.** `OneShotBaseline` (order-blind MLP over a move-count
  summary) is trained and evaluated identically, on the same splits.
- **Weak first-minute story.** New flagship section at the top of the
  page renders the actual measured budget→accuracy curves (fetched from
  `GET /api/flagship-results`, never hand-typed) before any lesson,
  quiz, or citation.
- **The old experiment risked looking abandoned.** It is unchanged and
  still fully live (`recurrent`/`hrm-inspired`/`bdh-cq-inspired`),
  reframed in the README/UI as the mechanistic demonstration that
  motivated building real state inspection in the first place — not
  deleted, not hidden.

## The new flagship experiment

**Task:** variable-length bounded 1D navigation (2–24 moves; the
existing 4-move task generalized — see
`src/reasoning/variable-length-navigation-task.js` and
`research/flagship/task.py`, which must agree and are cross-checked by
`test/trained-recurrent-runner.test.js`).

**Model:** one `torch.nn.GRUCell` (hidden size 64) consumes the move
sequence step by step (the "encoding" phase — dictated by task length,
not a free variable), then applies `reasoningBudget` additional
self-transitions on a zero input (the "thinking" phase — the actual
controlled variable, no new information injected). A linear head reads
the prediction from the final hidden state. Trained with a fixed
thinking budget of 4.

**Splits:** `TRAIN`/`VAL`/`TEST_SEEN` partition the entire enumerable
short-length (2–8 move) space with zero overlap by construction;
`TEST_UNSEEN` (12–24 moves) is sampled from a space large enough that
collision is negligible. 3 training seeds (7, 13, 21) — not one.

**Measured result** (from `results/flagship-experiment.json`, reproduced
by `npm run experiment`, no numbers hand-typed):

| Split | Budget 0 | 1 | 2 | **4 (trained)** | 8 | 16 | 24 | Baseline |
|---|---|---|---|---|---|---|---|---|
| Seen (2–8) | 42.9% | 53.2% | 71.9% | **91.8%** | 82.7% | 42.9% | 29.0% | 59.3% |
| Unseen (12–24) | 29.4% | 36.9% | 50.0% | **67.4%** | 63.3% | 39.9% | 26.4% | 21.5% |

This was **not tuned to look this way** — see "What was not done" below.
The result is exactly the "useful regime, then unstable regime" pattern
described as the ideal outcome: accuracy rises with computation budget
up to the trained budget, then degrades beyond it. On unseen lengths,
the trained recurrent model beats the one-shot baseline at every nonzero
budget — a real, measured length-extrapolation result, not an assertion.

## What was not done (scope discipline, not oversight)

- **No adaptive halting (Baseline C).** Explicitly optional per this
  pass's own instructions; a stable fixed-budget result was reached well
  inside the time budget, and an adaptive controller was judged not worth
  the implementation risk this close to the deadline.
- **No second task family.** One well-controlled task with a real
  held-out axis was prioritized over two shallow ones.
- **No forcing of the accuracy curve.** Budget was never selected by
  looking at test results (see `evaluate.py`'s comment on why the
  length-breakdown chart uses the fixed training budget, not a
  test-tuned "best" one).
- **CSP / rate limiting** remain documented gaps (`HACKATHON_BLOCKERS.md`
  B6), not revisited this pass — no exploitable path was found, and time
  went to the scientific rescue instead.

## P2 — polish

- CI's Docker smoke test now also exercises `trained-recurrent` and
  `GET /api/flagship-results`, not just the original backend.
- `docs/CLAIM-AUDIT.md` updated with the new flagship claims and their
  evidence level.
