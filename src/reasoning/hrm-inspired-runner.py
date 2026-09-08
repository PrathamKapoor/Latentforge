"""Deterministic local hierarchical recurrence inspired by HRM's update cadence.

This is a small untrained educational substrate, not the published HRM model.
It accepts one JSON request on stdin and emits one JSON result on stdout.
"""

import json
import math
import platform
import sys
import time

import torch


STATE_SIZE = 8
INPUT_SIZE = 4
OUTPUT_SIZE = 5
LOW_STEPS_PER_HIGH_CYCLE = 2
ALLOWED_BUDGETS = {1, 2, 4, 8}
REQUIRED_SEED = 20260908


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
    if request.get("seed") != REQUIRED_SEED:
        raise RunnerError("INVALID_SEED", "seed must be 20260908.")
    return vector, budget


def require_finite(tensor, code, message):
    if not torch.isfinite(tensor).all().item():
        raise RunnerError(code, message)


def build_parameters():
    torch.manual_seed(REQUIRED_SEED)
    torch.set_num_threads(1)
    dtype = torch.float64
    scale_input = math.sqrt(INPUT_SIZE)
    scale_state = math.sqrt(STATE_SIZE)
    # Parameter draws have one explicit, fixed order for reproducibility.
    input_weight = torch.randn((STATE_SIZE, INPUT_SIZE), dtype=dtype) / scale_input
    input_bias = torch.randn(STATE_SIZE, dtype=dtype) * 0.1
    low_low_weight = torch.randn((STATE_SIZE, STATE_SIZE), dtype=dtype) / scale_state
    low_high_weight = torch.randn((STATE_SIZE, STATE_SIZE), dtype=dtype) / scale_state
    low_input_weight = torch.randn((STATE_SIZE, STATE_SIZE), dtype=dtype) / scale_state
    low_bias = torch.randn(STATE_SIZE, dtype=dtype) * 0.1
    high_high_weight = torch.randn((STATE_SIZE, STATE_SIZE), dtype=dtype) / scale_state
    high_low_weight = torch.randn((STATE_SIZE, STATE_SIZE), dtype=dtype) / scale_state
    high_bias = torch.randn(STATE_SIZE, dtype=dtype) * 0.1
    output_weight = torch.randn((OUTPUT_SIZE, STATE_SIZE), dtype=dtype) / scale_state
    output_bias = torch.randn(OUTPUT_SIZE, dtype=dtype) * 0.1
    return (input_weight, input_bias, low_low_weight, low_high_weight,
            low_input_weight, low_bias, high_high_weight, high_low_weight,
            high_bias, output_weight, output_bias)


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
    """Run one hierarchical experiment.

    `parameters`, when supplied, must be a `build_parameters()` result built
    ahead of time (used by the persistent worker, which builds each backend's
    fixed parameters once at startup instead of on every request). When
    omitted, parameters are built fresh, exactly matching the original
    one-shot-process behavior used by this file's own `main()` and by tests
    that spawn this runner directly.
    """
    input_vector, budget = validate_request(request)
    started = time.perf_counter()
    if parameters is None:
        parameters = build_parameters()
    (input_weight, input_bias, low_low_weight, low_high_weight, low_input_weight,
     low_bias, high_high_weight, high_low_weight, high_bias, output_weight,
     output_bias) = parameters
    x = torch.tensor(input_vector, dtype=torch.float64)
    require_finite(x, "NON_FINITE_INPUT", "inputVector must contain only finite numbers.")

    with torch.no_grad():
        embedded_input = torch.tanh(input_weight @ x + input_bias)
        require_finite(embedded_input, "NON_FINITE_STATE", "Input representation contained a non-finite value.")
        low = torch.zeros(STATE_SIZE, dtype=torch.float64)
        high = torch.zeros(STATE_SIZE, dtype=torch.float64)
        initial_low = vector(low)
        initial_high = vector(high)
        observations = []
        for index in range(budget):
            previous_low = low
            previous_high = high
            low = torch.tanh(low_low_weight @ low + low_high_weight @ high + low_input_weight @ embedded_input + low_bias)
            require_finite(low, "NON_FINITE_STATE", "Low-level state contained a non-finite value.")
            high_updated = (index + 1) % LOW_STEPS_PER_HIGH_CYCLE == 0
            if high_updated:
                high = torch.tanh(high_high_weight @ high + high_low_weight @ low + high_bias)
                require_finite(high, "NON_FINITE_STATE", "High-level state contained a non-finite value.")
            logits = output_weight @ high + output_bias
            require_finite(logits, "NON_FINITE_LOGITS", "Output logits contained a non-finite value.")
            observations.append({
                "lowState": vector(low),
                "highState": vector(high),
                "lowMetrics": metrics(low, previous_low),
                "highMetrics": metrics(high, previous_high),
                "highUpdated": high_updated,
                "logits": vector(logits),
                "prediction": int(torch.argmax(logits).item()),
                "confidence": None,
            })

    final = observations[-1]
    return {
        "initialLowState": initial_low,
        "initialHighState": initial_high,
        "observations": observations,
        "finalLowState": final["lowState"],
        "finalHighState": final["highState"],
        "finalLogits": final["logits"],
        "finalPrediction": final["prediction"],
        "runtime": {"latencyMs": (time.perf_counter() - started) * 1000, "environment": {
            "pythonVersion": platform.python_version(), "torchVersion": torch.__version__,
            "cudaAvailable": torch.cuda.is_available(), "device": "cpu",
        }},
    }


def main():
    try:
        result = execute(json.loads(sys.stdin.read()))
    except json.JSONDecodeError:
        result = error_result("INVALID_JSON", "Request must be valid JSON.")
    except RunnerError as error:
        result = error_result(error.code, error.message)
    except Exception:
        result = error_result("EXECUTION_ERROR", "The local hierarchical runner could not complete execution.")
    sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
