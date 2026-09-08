"""Deterministic local BDH-CQ-inspired memory/workspace recurrence.

This is a small untrained educational substrate, not the published BDH-CQ
system. It accepts one JSON request on stdin and emits one JSON result on
stdout. Demonstrations sequentially update a memory state S; the final S
conditions an initial query workspace H0; a shared recurrent update then
runs H for the requested reasoning budget; the final H is decoded.
"""

import json
import math
import sys

import torch


STATE_SIZE = 8
INPUT_SIZE = 4
OUTPUT_SIZE = 5
ALLOWED_DEMONSTRATION_COUNTS = {1, 2, 3}
ALLOWED_BUDGETS = {1, 2, 4, 8}
REQUIRED_SEED = 20260909


class RunnerError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def error_result(code, message):
    return {"error": {"code": code, "message": message}}


def validate_request(request):
    if not isinstance(request, dict):
        raise RunnerError("INVALID_REQUEST", "Request must be a JSON object.")
    query = request.get("query")
    if not isinstance(query, list) or len(query) != INPUT_SIZE:
        raise RunnerError("INVALID_INPUT_VECTOR", "query must contain exactly four numbers.")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in query):
        raise RunnerError("INVALID_INPUT_VECTOR", "query must contain exactly four numbers.")
    if any(not math.isfinite(float(value)) for value in query):
        raise RunnerError("NON_FINITE_INPUT", "query must contain only finite numbers.")
    demonstration_count = request.get("demonstrationCount")
    if isinstance(demonstration_count, bool) or demonstration_count not in ALLOWED_DEMONSTRATION_COUNTS:
        raise RunnerError("INVALID_DEMONSTRATION_COUNT", "demonstrationCount must be 1, 2, or 3.")
    budget = request.get("reasoningBudget")
    if isinstance(budget, bool) or budget not in ALLOWED_BUDGETS:
        raise RunnerError("INVALID_REASONING_BUDGET", "reasoningBudget must be one of 1, 2, 4, or 8.")
    if request.get("seed") != REQUIRED_SEED:
        raise RunnerError("INVALID_SEED", "seed must be 20260909.")
    return query, demonstration_count, budget


def require_finite(tensor, code, message):
    if not torch.isfinite(tensor).all().item():
        raise RunnerError(code, message)


def build_parameters():
    """Create fixed local CPU parameters from the required deterministic seed.

    The draw order below (input_weight, input_bias, memory_weight,
    demonstration_weight, workspace_memory_weight, workspace_weight,
    workspace_bias, output_weight, output_bias) is intentionally preserved
    from the original implementation: each draw consumes the shared RNG
    stream in sequence, so reordering these calls would change every
    downstream value even with the same seed.
    """
    torch.manual_seed(REQUIRED_SEED)
    torch.set_num_threads(1)
    dtype = torch.float64

    def weight(rows, cols):
        return torch.randn((rows, cols), dtype=dtype) / math.sqrt(cols)

    def bias(size):
        return torch.randn(size, dtype=dtype) * 0.1

    input_weight = weight(STATE_SIZE, INPUT_SIZE)
    input_bias = bias(STATE_SIZE)
    memory_weight = weight(STATE_SIZE, STATE_SIZE)
    demonstration_weight = weight(STATE_SIZE, INPUT_SIZE)
    workspace_memory_weight = weight(STATE_SIZE, STATE_SIZE)
    workspace_weight = weight(STATE_SIZE, STATE_SIZE)
    workspace_bias = bias(STATE_SIZE)
    output_weight = weight(OUTPUT_SIZE, STATE_SIZE)
    output_bias = bias(OUTPUT_SIZE)
    return (input_weight, input_bias, memory_weight, demonstration_weight,
            workspace_memory_weight, workspace_weight, workspace_bias,
            output_weight, output_bias)


def vector(tensor):
    return [float(value) for value in tensor.tolist()]


def metrics(state, previous):
    state_norm = torch.linalg.vector_norm(state)
    previous_norm = torch.linalg.vector_norm(previous)
    denominator = state_norm * previous_norm
    cosine = None if denominator.item() == 0 else torch.dot(state, previous).item() / denominator.item()
    return {
        "stateNorm": float(state_norm.item()),
        "mean": float(state.mean().item()),
        "standardDeviation": float(state.std(unbiased=False).item()),
        "deltaFromPrevious": float(torch.linalg.vector_norm(state - previous).item()),
        "cosineSimilarityToPrevious": None if cosine is None else float(cosine),
    }


def execute(request, parameters=None):
    """Run one BDH-CQ-inspired experiment.

    `parameters`, when supplied, must be a `build_parameters()` result built
    ahead of time (used by the persistent worker, which builds each backend's
    fixed parameters once at startup instead of on every request). When
    omitted, parameters are built fresh, exactly matching the original
    one-shot-process behavior used by this file's own `main()` and by tests
    that spawn this runner directly.
    """
    query, demonstration_count, budget = validate_request(request)
    if parameters is None:
        parameters = build_parameters()
    (input_weight, input_bias, memory_weight, demonstration_weight,
     workspace_memory_weight, workspace_weight, workspace_bias,
     output_weight, output_bias) = parameters
    x = torch.tensor(query, dtype=torch.float64)
    require_finite(x, "NON_FINITE_INPUT", "query must contain only finite numbers.")

    with torch.no_grad():
        # Demonstrations sequentially update memory S; each demonstration is
        # a rolled view of the query, matching the original local design.
        memory = torch.zeros(STATE_SIZE, dtype=torch.float64)
        memory_trajectory = []
        for step in range(demonstration_count):
            previous_memory = memory
            demonstration = torch.roll(x, step)
            memory = torch.tanh(memory_weight @ memory + demonstration_weight @ demonstration)
            require_finite(memory, "NON_FINITE_STATE", "Memory state contained a non-finite value.")
            memory_trajectory.append({
                "step": step + 1,
                "state": vector(memory),
                "metrics": metrics(memory, previous_memory),
            })

        # Final memory conditions the initial query workspace H0.
        workspace = torch.tanh(input_weight @ x + input_bias + workspace_memory_weight @ memory)
        require_finite(workspace, "NON_FINITE_STATE", "Initial workspace state contained a non-finite value.")
        initial_workspace = vector(workspace)

        # Shared recurrent workspace update runs for the requested budget;
        # the final workspace state is decoded into logits/prediction.
        workspace_trajectory = []
        for step in range(budget):
            previous_workspace = workspace
            workspace = torch.tanh(workspace_weight @ workspace + workspace_memory_weight @ memory + workspace_bias)
            require_finite(workspace, "NON_FINITE_STATE", "Workspace state contained a non-finite value.")
            logits = output_weight @ workspace + output_bias
            require_finite(logits, "NON_FINITE_LOGITS", "Output logits contained a non-finite value.")
            workspace_trajectory.append({
                "step": step + 1,
                "state": vector(workspace),
                "metrics": metrics(workspace, previous_workspace),
                "logits": vector(logits),
                "prediction": int(torch.argmax(logits).item()),
            })

    final = workspace_trajectory[-1]
    return {
        "memoryTrajectory": memory_trajectory,
        "initialWorkspace": initial_workspace,
        "workspaceTrajectory": workspace_trajectory,
        "effectiveReasoningBudget": budget,
        "finalState": final["state"],
        "finalLogits": final["logits"],
        "finalPrediction": final["prediction"],
    }


def main():
    try:
        request = json.loads(sys.stdin.read())
        result = execute(request)
    except json.JSONDecodeError:
        result = error_result("INVALID_JSON", "Request must be valid JSON.")
    except RunnerError as error:
        result = error_result(error.code, error.message)
    except Exception:
        result = error_result("EXECUTION_ERROR", "The local BDH-CQ-inspired runner could not complete execution.")
    sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
