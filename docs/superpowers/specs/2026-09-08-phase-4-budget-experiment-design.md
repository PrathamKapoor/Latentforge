# Phase 4 Reasoning Budget Experiment

Phase 4 adds a client-visible controlled sweep, not a new model. For one fixed request base `{ task, backend }`, it invokes the existing API separately at budgets 1, 2, 4, and 8. The backend's seed, task encoding, parameters, transition, output head, truth solver, precision, and environment remain fixed by the existing recurrent backend; only `reasoningBudget` varies.

Each sweep result is the complete actual experiment record returned by the recurrent backend. The sweep stores no fabricated state, confidence, timing, prediction, or truth. A sweep has an ID derived from the invariant task/backend/seed/configuration and holds the individual `experimentId` values. Failure returns a structured failed row; it never substitutes synthetic output.

The laboratory view compares prediction/truth/correctness, final-state norm, final state movement, and trajectory samples. It states the controlled conditions and makes the known non-monotonic local observation visible without generalizing it beyond this untrained toy substrate. Reset reruns the same sweep; repeatability excludes measured latency.
