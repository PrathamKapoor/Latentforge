# Phase 3 State Is the Lesson Design

## Goal

Make the actual Phase 2 recurrent state the center of a guided educational experience while preserving the live backend, synthetic backend, contract, and scientific limitations.

## Core learning claim

A model can perform repeated computation by refining a hidden state instead of verbalizing every intermediate step. This is an educational claim about the mechanism, not a claim of universal accuracy, speed, cost, interpretability, or superiority.

## Architecture

`Preset live run → Guided lesson controller → Live state timeline/scrubber → Budget manipulation → Truth comparison → Sandbox`

The controller is client-side and consumes only the existing contract. It does not recompute states, create visualization-only vectors, or interpret latent dimensions semantically. The Phase 2 API remains the source of live results.

## Preset execution

On page load, the client must execute `POST /api/experiment` against the live recurrent backend for task `1,0,1,1` and budget `4`. The visible result is therefore a current live execution, labelled `LIVE`; it must not be hardcoded. If a future cache is introduced, it must be labelled `PRECOMPUTED` and never presented as live.

## Guided mode

Guided mode is the default and has five concise stages:

1. Question: what changes when another recurrent update is allowed?
2. State: inspect h₀ through h₄ and the actual eight values.
3. Shared rule: show the fixed recurrence equation and identify the selected current state without implying the equation changes.
4. Manipulation: the learner changes budget among 1, 2, 4, and 8, waits for a real live run, then inspects the newly returned trajectory and prediction before continuing.
5. Limitation/takeaway: compare predictions with ground truth, preserve the observed failure pattern, answer the knowledge check, and submit a one-sentence explanation.

The lesson is not a passive slideshow. Progression is gated on the live budget manipulation and on the knowledge check. Completion unlocks the sandbox.

## State observability

The UI displays h₀ and every returned h₁…hₙ. A scrubber selects an already-returned state without recomputation. Selection updates the actual vector, raw values, L2 norm, mean, standard deviation, delta, cosine similarity where valid, and the prediction associated with that post-update state. h₀ has no invented prediction; it is labelled initial state.

A signed heatmap uses the actual values with one shared scale for the selected trajectory. Raw numeric values remain visible in the inspector. The heatmap is a visualization of numerical values, not a semantic map of thoughts or dimensions.

## Equation panel

The fixed mathematical rule is always shown as an `ILLUSTRATIVE` explanation:

`h₀ = tanh(W_encode x + b_encode)`

`hₜ₊₁ = tanh(W_h hₜ + W_x x + b_h)`

`prediction = argmax(W_out hₙ + b_out)`

Selecting h₃ may highlight the current state reference in the diagram, but does not alter the equation. The panel separately labels the selected state value and the invariant rule.

## Failure and comparison

Budget comparison runs use the same task, backend, seed, and configuration and vary only budget. The known local observation remains visible when reproduced: budget 1 → prediction 2 (incorrect), budget 2 → 4 (correct), budget 4 → 4 (correct), budget 8 → 2 (incorrect). The UI explains that this is an observation from this small untrained local substrate, not a universal property of recurrent latent reasoning.

## Sandbox and completion

Sandbox exposes only task, backend, budget, and Run. It is unavailable until the guided manipulation, knowledge check, and explanation submission are complete. The final lesson state explicitly tells the learner how to reproduce the claim in under a minute: change budget, observe additional state updates, inspect prediction, compare with ground truth.

## Evidence and integrity

Live backend results remain `LIVE`; synthetic contract results remain `SYNTHETIC`; equations and instructional diagrams are `ILLUSTRATIVE`. No chain-of-thought, semantic dimension labels, named research architecture implementation, token-saving claim, efficiency claim, or universal improvement claim is introduced.

## Testing

Add tests for live preset execution, guided progression gating, real budget manipulation, scrubber/state selection, exact numeric preservation and metrics, equation invariance, failure messaging, quiz/explanation completion, sandbox unlock, comparison row selection, malformed result handling, and all existing regressions. Browser automation is attempted if available and reported honestly if unavailable.
