"""Local deterministic PyTorch recurrent substrate runner.

This process accepts exactly one JSON request on stdin and emits exactly one JSON
result on stdout.  It has no task solver, training loop, network access, or
fallback execution path.
"""

import json
import math
import platform
import sys
import time

import torch


HIDDEN_SIZE = 8
INPUT_SIZE = 4
OUTPUT_SIZE = 5
ALLOWED_BUDGETS = {1, 2, 4, 8}
REQUIRED_SEED = 20260907

# A small, fixed, pre-declared set of additional seeds used ONLY by the
# local seed-characterization experiment (src/experiments/seed-characterization.js),
# never user-supplied. The canonical single-seed experiment (REQUIRED_SEED)
# is completely unaffected — this is strictly additive. Must stay in sync
# with CHARACTERIZATION_SEEDS in seed-characterization.js; a contract-drift
# test (test/seed-characterization.test.js) checks the two lists agree.
CHARACTERIZATION_SEEDS = (1, 42, 2024, 90210)
ALLOWED_SEEDS = frozenset({REQUIRED_SEED, *CHARACTERIZATION_SEEDS})


class RunnerError(Exception):
    """A controlled runner error that is safe to serialize to the caller."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def error_result(code, message):
    return {"error": {"code": code, "message": message}}


def validate_request(request):
    if not isinstance(request, dict):
        raise RunnerError("INVALID_REQUEST", "Request must be a JSON object.")

    vector = request.get("inputVector")
    if not isinstance(vector, list) or len(vector) != INPUT_SIZE:
        raise RunnerError("INVALID_INPUT_VECTOR", "inputVector must contain exactly four numbers.")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in vector):
        raise RunnerError("INVALID_INPUT_VECTOR", "inputVector must contain exactly four numbers.")
    if any(not math.isfinite(float(value)) for value in vector):
        raise RunnerError("NON_FINITE_INPUT", "inputVector must contain only finite numbers.")

    budget = request.get("reasoningBudget")
    if isinstance(budget, bool) or not isinstance(budget, int) or budget not in ALLOWED_BUDGETS:
        raise RunnerError("INVALID_REASONING_BUDGET", "reasoningBudget must be one of 1, 2, 4, or 8.")

    seed = request.get("seed")
    if isinstance(seed, bool) or seed not in ALLOWED_SEEDS:
        raise RunnerError("INVALID_SEED", "seed must be 20260907 or one of the declared characterization seeds.")

    return vector, budget, seed


def require_finite(tensor, code, message):
    if not torch.isfinite(tensor).all().item():
        raise RunnerError(code, message)


def build_parameters(seed):
    """Create fixed local CPU parameters from the supplied deterministic seed."""
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    device = torch.device("cpu")
    dtype = torch.float64

    encode_weight = torch.randn((HIDDEN_SIZE, INPUT_SIZE), device=device, dtype=dtype) / math.sqrt(INPUT_SIZE)
    encode_bias = torch.randn(HIDDEN_SIZE, device=device, dtype=dtype) * 0.1
    hidden_weight = torch.randn((HIDDEN_SIZE, HIDDEN_SIZE), device=device, dtype=dtype) / math.sqrt(HIDDEN_SIZE)
    input_weight = torch.randn((HIDDEN_SIZE, INPUT_SIZE), device=device, dtype=dtype) / math.sqrt(INPUT_SIZE)
    hidden_bias = torch.randn(HIDDEN_SIZE, device=device, dtype=dtype) * 0.1
    output_weight = torch.randn((OUTPUT_SIZE, HIDDEN_SIZE), device=device, dtype=dtype) / math.sqrt(HIDDEN_SIZE)
    output_bias = torch.randn(OUTPUT_SIZE, device=device, dtype=dtype) * 0.1
    return encode_weight, encode_bias, hidden_weight, input_weight, hidden_bias, output_weight, output_bias


def vector(tensor):
    return [float(value) for value in tensor.tolist()]


def observation_for(state, previous_state, output_weight, output_bias):
    logits = output_weight @ state + output_bias
    require_finite(logits, "NON_FINITE_LOGITS", "Output logits contained a non-finite value.")

    state_norm = torch.linalg.vector_norm(state)
    previous_norm = torch.linalg.vector_norm(previous_state)
    denominator = state_norm * previous_norm
    cosine_similarity = None if denominator.item() == 0 else torch.dot(state, previous_state).item() / denominator.item()
    return {
        "state": vector(state),
        "logits": vector(logits),
        "stateNorm": float(state_norm.item()),
        "mean": float(state.mean().item()),
        "standardDeviation": float(state.std(unbiased=False).item()),
        "deltaFromPrevious": float(torch.linalg.vector_norm(state - previous_state).item()),
        "cosineSimilarityToPrevious": None if cosine_similarity is None else float(cosine_similarity),
        "prediction": int(torch.argmax(logits).item()),
        "confidence": None,
    }


def execute(request, parameters=None):
    """Run one recurrent experiment.

    `parameters`, when supplied, must be a `build_parameters(seed)` result
    built ahead of time (used by the persistent worker, which builds each
    backend's fixed parameters once at startup instead of on every request).
    When omitted, parameters are built fresh from the request's seed, exactly
    matching the original one-shot-process behavior used by this file's own
    `main()` and by tests that spawn this runner directly.
    """
    input_vector, budget, seed = validate_request(request)
    started_at = time.perf_counter()
    (
        encode_weight,
        encode_bias,
        hidden_weight,
        input_weight,
        hidden_bias,
        output_weight,
        output_bias,
    ) = parameters if parameters is not None else build_parameters(seed)
    x = torch.tensor(input_vector, dtype=torch.float64, device="cpu")
    require_finite(x, "NON_FINITE_INPUT", "inputVector must contain only finite numbers.")

    with torch.no_grad():
        h = torch.tanh(encode_weight @ x + encode_bias)
        require_finite(h, "NON_FINITE_STATE", "Initial state contained a non-finite value.")
        initial_state = vector(h)
        observations = []

        # hidden_weight, input_weight, and hidden_bias are intentionally the
        # same tensor instances for every one of the exactly budget transitions.
        for _ in range(budget):
            previous_state = h
            h = torch.tanh(hidden_weight @ h + input_weight @ x + hidden_bias)
            require_finite(h, "NON_FINITE_STATE", "Recurrent state contained a non-finite value.")
            observations.append(observation_for(h, previous_state, output_weight, output_bias))

    final_observation = observations[-1]
    return {
        "initialState": initial_state,
        "observations": observations,
        "finalState": final_observation["state"],
        "finalLogits": final_observation["logits"],
        "finalPrediction": final_observation["prediction"],
        "runtime": {
            "latencyMs": (time.perf_counter() - started_at) * 1000,
            "environment": {
                "pythonVersion": platform.python_version(),
                "torchVersion": torch.__version__,
                "cudaAvailable": torch.cuda.is_available(),
                "device": "cpu",
            },
        },
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
        result = error_result("EXECUTION_ERROR", "The recurrent runner could not complete execution.")
    sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
