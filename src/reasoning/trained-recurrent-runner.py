"""Flagship backend: a REAL TRAINED recurrent model (not an untrained toy
initialization like recurrent-runner.py). Loads a checkpoint produced by
research/flagship/train.py and reuses that exact same RecurrentReasoner
class definition (imported, never redefined) for inference — the model
architecture the checkpoint's weights belong to and the model architecture
that runs live are guaranteed identical because they are the same Python
class, not a hand-ported copy of it.

Contract mirrors the other runners in this directory (recurrent-runner.py
et al.): one JSON request in, one JSON result out on stdin/stdout when run
standalone; `execute(payload, parameters)` when loaded by the persistent
worker (worker-server.py), which builds `parameters` (here: the loaded
model) once at startup via `build_parameters()`.

Task/budget bounds (MIN_TASK_LENGTH, MAX_TASK_LENGTH, MAX_REASONING_BUDGET)
intentionally mirror src/server/config.js's constants — kept in sync by
test/trained-recurrent-runner.test.js, the same pattern already used for
CHARACTERIZATION_SEEDS between recurrent-runner.py and
seed-characterization.js.
"""

import json
import platform
import sys
import time
from pathlib import Path

import torch

RUNNER_DIR = Path(__file__).resolve().parent
FLAGSHIP_DIR = RUNNER_DIR.parent.parent / "research" / "flagship"
CHECKPOINT_PATH = FLAGSHIP_DIR / "checkpoints" / "recurrent-seed7.pt"

sys.path.insert(0, str(FLAGSHIP_DIR))
from model import RecurrentReasoner  # noqa: E402

GRID_SIZE = 11
HIDDEN_SIZE = 64
MIN_TASK_LENGTH = 2
MAX_TASK_LENGTH = 24
MAX_REASONING_BUDGET = 24
THINKING_STEPS_TRAIN = 4  # the budget this checkpoint was actually trained with
REQUIRED_SEED = 7  # which training seed's checkpoint is served live; provenance only, not a request input


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

    moves = request.get("moves")
    if not isinstance(moves, list) or not (MIN_TASK_LENGTH <= len(moves) <= MAX_TASK_LENGTH):
        raise RunnerError("INVALID_TASK", f"moves must be a list of 0/1 with length {MIN_TASK_LENGTH}-{MAX_TASK_LENGTH}.")
    if any(isinstance(m, bool) or m not in (0, 1) for m in moves):
        raise RunnerError("INVALID_TASK", "moves must contain only 0 or 1.")

    budget = request.get("thinkingSteps")
    if isinstance(budget, bool) or not isinstance(budget, int) or not (0 <= budget <= MAX_REASONING_BUDGET):
        raise RunnerError("INVALID_REASONING_BUDGET", f"thinkingSteps must be an integer from 0 to {MAX_REASONING_BUDGET}.")

    return moves, budget


def build_parameters():
    """Load the trained checkpoint once. Returns the ready-to-run model
    (eval mode, gradients disabled) — the persistent worker calls this
    exactly once at startup, exactly like every other backend's
    `build_parameters()`.
    """
    model = RecurrentReasoner(hidden_size=HIDDEN_SIZE, grid_size=GRID_SIZE)
    state_dict = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=True)
    model.load_state_dict(state_dict)
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    return model


def solve(moves):
    """Independent reference solver — duplicated intentionally from
    research/flagship/task.py's `solve()` (not imported) so that ground
    truth is computed by code that never shares a bug with the model or
    its training data; test/trained-recurrent-runner.test.js checks the
    two stay in agreement across many random instances.
    """
    position = GRID_SIZE // 2
    for move in moves:
        position = max(0, min(GRID_SIZE - 1, position + (1 if move == 1 else -1)))
    return position


def execute(request, parameters=None):
    moves, thinking_steps = validate_request(request)
    started_at = time.perf_counter()
    model = parameters if parameters is not None else build_parameters()

    trajectory = model.trajectory(moves, thinking_steps)
    ground_truth = solve(moves)

    return {
        "steps": trajectory["steps"],
        "finalPrediction": trajectory["finalPrediction"],
        "groundTruth": ground_truth,
        "thinkingStepsTrain": THINKING_STEPS_TRAIN,
        "trainingSeed": REQUIRED_SEED,
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
        result = error_result("EXECUTION_ERROR", "The trained-recurrent runner could not complete execution.")
    sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
