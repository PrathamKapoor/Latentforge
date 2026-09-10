# LatentForge

**An Interactive Laboratory for Recurrent Latent Reasoning**

LatentForge is a lightweight, fully local web application and research laboratory designed to study recurrent latent reasoning. Instead of verbalizing every intermediate step into tokens (as in explicit chain-of-thought), recurrent latent reasoning systems allocate test-time computation by repeatedly updating an internal numerical hidden state before decoding an answer.

The project provides a transparent, deterministic environment where learners and researchers can inspect latent trajectories step-by-step, manipulate computation budgets, and compare predictions against independently verified ground truth.

## Try It

```bash
git clone https://github.com/PrathamKapoor/Latentforge.git && cd Latentforge
npm install
python3.10 -m venv .venv && . .venv/bin/activate   # or py -3.10 -m venv .venv on Windows
python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
npm run dev
```

Open `http://127.0.0.1:4173` for the overview, or go straight to the interactive laboratory at `http://127.0.0.1:4173/lab` — the flagship result is its first section.

No API keys, accounts, or external model providers are needed: every experiment runs locally on CPU.

## Flagship Result: A Trained Model, a Held-Out Length Test

> **Does giving a *trained* recurrent model more latent computation help it reach problem lengths it never saw during training?**

Every other section of this README describes an **untrained**, fixed-seed
toy substrate — useful for inspecting mechanism, but not evidence that
latent computation is *useful*. This section is different: a real GRU-based
recurrent model is **trained** (not randomly initialized) on short
move-sequences (length 2–8), then evaluated on much longer sequences
(length 12–24) it never saw during training. The trained weights never
change in what follows — only the number of extra "thinking" steps
applied at inference time does.

**Measured result** (3 training seeds; reproduce with `npm run experiment` — see [Reproduce the Flagship Result](#reproduce-the-flagship-result)):

| Split | Budget 0 | 1 | 2 | **4 (trained)** | 8 | 16 | 24 | One-shot baseline |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Seen lengths (2–8) | 42.9% | 53.2% | 71.9% | **91.8%** | 82.7% | 42.9% | 29.0% | 59.3% |
| **Held-out lengths (12–24)** | 29.4% | 36.9% | 50.0% | **67.4%** | 63.3% | 39.9% | 26.4% | 21.5% |

Accuracy rises with computation budget up to the trained budget, then
degrades — a useful regime and an unstable regime, not "more compute is
always better." On held-out lengths the trained model beats the
order-blind one-shot baseline at every nonzero budget. This was not
tuned to look this way: the training budget was fixed before any test
result existed, and the length-breakdown chart in the app uses that same
fixed budget, not one selected because it scored best on test data (see
`research/flagship/evaluate.py`).

**What this does and does not show:** a small (hidden size 64), CPU,
single-task-family result across 3 seeds — real and reproducible, not a
benchmark claim, not evidence about production-scale reasoning models.
See [Limitations](#known-limitations).

Everything below this section describes the **original, untrained**
substrate this project started with — kept because it is still the
clearest place to see raw latent-state mechanics, and because the
question it raised ("is this changing-hidden-state thing actually
useful?") is exactly what the flagship result above answers.

## The Original Architecture

```
User / Learner
      │
      ▼
LatentForge UI (Guided Lesson · State Inspector · Budget Sweeps · Sandbox)
      │  (HTTP / JSON)
      ▼
Node API (Validation · Bounded FIFO Queue · Resource Limits · Health/Ready)
      │  (stdin / stdout IPC)
      ▼
Persistent Python Worker (PyTorch CPU · Single Active Slot)
      │
      ├── Recurrent Substrate (Single seeded tanh recurrence)
      ├── HRM-Inspired Substrate (Two-level cadence: L step-wise, H cycle-wise)
      └── BDH-CQ-Inspired Substrate (Demonstration memory S + workspace H)
      │
      ▼
State Trajectories + Output-Head Logits + Final Prediction
      │
      ▼
Independent Ground Truth Reference Solver
      │
      ▼
Telemetry & Comparative Analysis (Live Heatmaps · L2 Norms · Cosine Sim)
```

---

## The Central Question & Claim

### Research Question
> **What happens when we give a model more time to think — without giving it more tokens to think with?**

### Central Falsifiable Claim
> **A model can perform repeated computation by refining a hidden state instead of verbalizing every intermediate step.**

### What LatentForge Does Not Claim
To maintain strict scientific integrity, LatentForge explicitly delineates what this project does and does not demonstrate:
- **Not universally superior:** It does not claim latent reasoning is universally superior to chain-of-thought prompting.
- **Not monotonically better:** It does not claim that additional computation always improves accuracy. The local substrate explicitly demonstrates cases where additional compute degrades performance.
- **Not human-readable thoughts:** It does not claim internal latent vectors represent human-interpretable thoughts. Displayed vectors are purely numerical state representations.
- **Not production scale:** The tiny local substrate (hidden dimension 8) is an educational and exploratory tool, not a production reasoning engine.
- **Not paper reproductions:** The `hrm-inspired` and `bdh-cq-inspired` backends are simplified local implementations inspired by published mechanisms, not reproductions of the full published architectures or their training pipelines.
- **No token/cost efficiency claims:** LatentForge does not measure token savings, execution cost, wall-clock speed advantages, or resource efficiency relative to external large language models.

---

## Core Laboratory Capabilities

0. **Flagship Trained Model + Held-Out Evaluation:**
   A real trained GRU-based recurrent model, a variable-length task family (2-24 moves), a length-based held-out test split, a one-shot baseline, and a measured budget-sweep result — see [Flagship Result](#flagship-result-a-trained-model-a-held-out-length-test) above.
1. **Interactive Guided Experience:**
   A progressive learning path that runs an initial live preset (`1,0,1,1` with budget 4), requires the user to inspect latent state vectors ($h_0 \dots h_4$), and prompts a live computation budget modification before unlocking the full sandbox.
2. **State Trajectory Inspection:**
   Inspect the exact numerical vectors ($h_0 \dots h_N \in \mathbb{R}^8$) across recurrent update steps, visualized via signed heatmaps, coordinate drill-downs, and trajectory metrics (L2 norm $\|h_t\|$, step delta $\|h_t - h_{t-1}\|$, and cosine similarity to initial state $h_0$).
3. **Reasoning-Budget Experiments:**
   Manipulate the test-time computation budget ($N \in \{1, 2, 4, 8\}$). Observe how the latent trajectory evolves and how the resulting output-head logits change.
4. **Local Seed Characterization:**
   Run the canonical task across multiple deterministic seeds to evaluate whether behavior generalizes beyond the canonical seed.
5. **Architectural Comparison:**
   Evaluate differences between single-state recurrence, hierarchical recurrence (HRM-inspired), and memory-conditioned latent workspace updates (BDH-CQ-inspired).

> [!NOTE]
> **Computation budget is not "thinking depth."**
> In this substrate, the budget represents the discrete number of recurrent mathematical transformations applied to the hidden vector. It does not measure human-like reasoning depth or qualitative understanding.

---

## Mechanistic Demonstration (Original, Untrained Substrate)

Everything from here down describes the project's original experiment:
an **untrained**, deterministically-initialized recurrent substrate,
fixed at exactly 4 moves. It does not by itself demonstrate that latent
computation is *useful* — that is what the [Flagship
Result](#flagship-result-a-trained-model-a-held-out-length-test) above
answers. It remains the clearest place to inspect raw latent-state
mechanics without a training process in the way, and it is the reason
this project built real state inspection in the first place.

### The Canonical Experiment & Non-Monotonic Behavior

In the canonical experiment, the recurrent backend executes a bounded 1D line-navigation task:
- **Input Task:** `1,0,1,1` (discrete moves on a clamped 5-element grid $[0..4]$ starting at position 2: $2 \xrightarrow{+1} 3 \xrightarrow{-1} 2 \xrightarrow{+1} 3 \xrightarrow{+1} 4$).
- **Independent Ground Truth:** `4`.
- **Model Parameters:** Fixed seed `20260907`, hidden size 8, float64 CPU precision, deterministically initialized.

### Empirical Results Across Budgets

| Reasoning Budget | State Updates | Predicted Output | Ground Truth | Correct? |
|:---:|:---:|:---:|:---:|:---:|
| **1** | $h_0 \to h_1$ | 2 | 4 | Incorrect |
| **2** | $h_0 \to h_2$ | 4 | 4 | **Correct** |
| **4** | $h_0 \to h_4$ | 4 | 4 | **Correct** |
| **8** | $h_0 \to h_8$ | 2 | 4 | Incorrect |

### Why Budget 8 Fails
The failure at budget 8 is not hidden or treated as a bug—it is the central pedagogical finding.

In an untrained, deterministic recurrent substrate, each update step transforms the state through a non-linear transition $h_{t} = \tanh(W_{hh} h_{t-1} + W_{xh} x + b_h)$. While budgets 2 and 4 steer the hidden state into a region where the linear output head maps to the correct class (position 4), additional recurrent steps (budget 8) push the latent state further along the trajectory, drifting out of the correct decision basin back to position 2.

**Key Lesson:** More computation changes the latent state trajectory, but without trained attractor dynamics or learned adaptive halting mechanisms, **more compute does not guarantee a better or more accurate prediction.**

---

## Local Seed Characterization

To verify whether the canonical non-monotonic behavior is an isolated anomaly or representative of the architecture, LatentForge includes a multi-seed evaluation.

**Setup:** 5 pre-declared deterministic seeds $\times$ 4 reasoning budgets = 20 total runs on task `1,0,1,1` (ground truth = 4):

| Seed | Budget 1 | Budget 2 | Budget 4 | Budget 8 | Total Correct |
|:---|:---:|:---:|:---:|:---:|:---:|
| **20260907** (Canonical) | 2 | **4** | **4** | 2 | 2 / 4 |
| **1** | **4** | 2 | 2 | 2 | 1 / 4 |
| **42** | 1 | 1 | 2 | 2 | 0 / 4 |
| **2024** | 3 | 3 | 3 | 3 | 0 / 4 |
| **90210** | 0 | 1 | 0 | 0 | 0 / 4 |
| **Summary** | 1 / 5 | 1 / 5 | 1 / 5 | 0 / 5 | **3 / 20 (15%)** |

> [!IMPORTANT]
> **Local characterization, not a benchmark.**
> This 20-run sweep is an internal characterization designed to illustrate that the canonical seed's 50% accuracy is not representative of typical untrained performance (3/20 overall is near 5-way chance). It does not establish a statistical benchmark or broad empirical law.

---

## Research Mechanisms & Lineage

LatentForge draws inspiration from several published research papers while maintaining clear boundaries regarding what is locally executed.

| Concept / Reference | Published Research Claim | LatentForge Live Implementation | Scientific Boundary |
|:---|:---|:---|:---|
| **Recurrent Latent Reasoning**<br>*(e.g. Coconut, test-time compute)* | Explores continuous latent thoughts and compute scaling without verbalization. | Single-layer seeded PyTorch recurrence with budgets $\{1, 2, 4, 8\}$. | Local substrate is a minimal toy system (8D); does not train on language corpora. |
| **Hierarchical Reasoning Model (HRM)**<br>[Wang et al., 2025](https://arxiv.org/abs/2506.21734) | Two coupled recurrent modules: low-level $L$ updates every step; high-level $H$ updates at multi-step cycle boundaries. Readout from $H$. | `hrm-inspired` mode: $L$ updates at each step; $H$ updates every 2 steps; output head decodes from $H$. | Untrained local simplification. Omits deep supervision, 1-step gradient approximation, learned modules, and benchmarks. |
| **BDH-CQ**<br>[Engdahl et al., 2026](https://arxiv.org/abs/2608.09888) | In-context reasoning separating demonstration memory ($S$) from query workspace ($H$). | `bdh-cq-inspired` mode: sequential demonstration updates memory $S$; final $S$ initializes $H_0$; budget updates $H$. | Local educational simplification. Uses fixed float64 CPU parameters; omits proprietary update formulations and 150M model. |

### Research Bibliography
- **Coconut:** Hao et al., *Training Large Language Models for Reasoning through Reverse Curriculum* ([arXiv:2412.06769](https://arxiv.org/abs/2412.06769)).
- **Hierarchical Reasoning Model (HRM):** Guan Wang, Jin Li, Yuhao Sun, Xing Chen, Changling Liu, Yue Wu, Meng Lu, Sen Song, Yasin Abbasi-Yadkori, *Hierarchical Reasoning Model* ([arXiv:2506.21734](https://arxiv.org/abs/2506.21734)).
- **BDH-CQ:** Björn Engdahl, Adrian Kosowski, Jan Chorowski, Zuzanna Stamirowska, Przemysław Uznański, Junlin Jiang, Rohan Phadke, Remigiusz Kinas, Richard Zhong, *BDH-CQ: In-Context Learning with Recurrent Latent Reasoning* ([arXiv:2608.09888](https://arxiv.org/abs/2608.09888)).

---

## Implementation Status

| Component | Status | Evidence / Location |
|:---|:---:|:---|
| **Flagship: Trained Recurrent Model** | Implemented | `LIVE`, `research/flagship/`, `src/reasoning/trained-recurrent-runner.py`, `test/trained-recurrent-runner.test.js` |
| **Flagship: Variable-Length Task + Held-Out Split** | Implemented | `research/flagship/task.py`, `src/reasoning/variable-length-navigation-task.js`, `test/variable-length-navigation-task.test.js` |
| **Flagship: One-Shot Baseline** | Implemented | `research/flagship/model.py` (`OneShotBaseline`), `results/flagship-experiment.json` |
| **Flagship: Results UI (budget/length charts)** | Implemented | `public/flagship.js`, `GET /api/flagship-results` |
| **Landing Page (`/`)** | Implemented | `public/index.html`, `public/landing.js`, `public/css/landing.css`, `test/landing-shell.test.js` |
| **Browser Application Shell & UI (`/lab`)** | Implemented | `public/lab.html`, `public/app.js`, `public/site.js`, `public/css/`, `test/frontend-shell.test.js` |
| **Guided Learning Experience** | Implemented | `public/guided-experience.js`, `test/phase3-experience.test.js` |
| **Node.js HTTP Server & API** | Implemented | `src/server/server.js`, `test/api.test.js` |
| **Persistent Python Worker** | Implemented | `src/reasoning/worker-server.py`, `src/reasoning/worker-client.js` |
| **Recurrent Latent Backend** | Implemented | `LIVE`, `src/reasoning/recurrent-runner.py`, `test/recurrent-runner.test.js` |
| **HRM-Inspired Hierarchical Backend** | Implemented (Simplified) | `LIVE`, `src/reasoning/hrm-inspired-runner.py`, `test/hrm-inspired-runner.test.js` |
| **BDH-CQ-Inspired Memory Backend** | Implemented (Simplified) | `LIVE`, `src/reasoning/bdh-cq-inspired-runner.py`, `test/bdh-cq-inspired-runner.test.js` |
| **Synthetic Arithmetic Demo** | Implemented | `SYNTHETIC`, `src/reasoning/synthetic-demo-backend.js` |
| **Reasoning-Budget Sweep** | Implemented | `src/experiments/reasoning-budget-sweep.js`, `test/reasoning-budget-sweep.test.js` |
| **Seed Characterization Sweep** | Implemented | `src/experiments/seed-characterization.js`, `test/seed-characterization.test.js` |
| **Independent Reference Solver** | Implemented | `src/reasoning/line-navigation-task.js`, `test/line-navigation-task.test.js` |
| **Health & Readiness Endpoints** | Implemented | `GET /health`, `GET /ready`, `test/health.test.js` |
| **Container Definition** | Created | `Dockerfile`, `.dockerignore` |
| **CI Workflow** | Created | `.github/workflows/ci.yml` |
| **Variable-length Task Families** | Implemented (flagship only) | The original `recurrent`/`hrm-inspired`/`bdh-cq-inspired` backends remain fixed at exactly 4 moves by design; `trained-recurrent` supports length 2-24 |
| **OmniRoute Routing Infrastructure** | Planned / Not Implemented | Conceptual roadmap only (`docs/ARCHITECTURE.md`) |
| **URM / CODI Frameworks** | Not Implemented | Phase 0 research lineage references only |

---

## Evidence Taxonomy

Every piece of data rendered in the UI or documented in this repository carries an explicit evidence classification:

- `LIVE`: Fresh computation executed locally on the PyTorch CPU substrate for the active request.
- `PRECOMPUTED`: Verified historical or deterministic run outputs stored for baseline reference.
- `SYNTHETIC`: Rule-based deterministic mock data (e.g. Phase 1 arithmetic demo, non-neural).
- `PUBLISHED`: Academic claims and equations originating from peer-reviewed or preprint research papers.
- `ILLUSTRATIVE`: Pedagogical diagrams, structural schemas, or explanatory mathematical formulas.

There are no silent fallbacks between evidence categories. If a live runner fails, the application returns a structured error rather than substituting synthetic data.

---

## Reproducibility & Local Setup

### Prerequisites
- **Node.js**: `v24.0.0` or higher
- **Python**: `3.10` or `3.11` (required by the pinned CPU-only PyTorch wheel)
- **PyTorch**: `2.13.0+cpu` (CPU-only wheel; no GPU or CUDA required)

### Step-by-Step Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/PrathamKapoor/Latentforge.git
   cd Latentforge
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Create an isolated Python environment and install dependencies:**
    ```bash
    # macOS / Linux
    python3.11 -m venv .venv
    . .venv/bin/activate

    # Windows PowerShell (if `python` is not on PATH)
    # py -3.10 -m venv .venv
    # .\.venv\Scripts\Activate.ps1

    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
    ```
    `npm test`, `npm run build`, and `npm run dev` automatically prefer `.venv`.
    Set `PYTHON` to an absolute interpreter path if the environment lives elsewhere.

4. **Verify the installation:**
    Run the complete automated test suite:
   ```bash
   npm test
   ```
   Validate code and syntax integrity across JavaScript and Python:
   ```bash
   npm run build
   ```

5. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open your browser at `http://127.0.0.1:4173` (overview) or `http://127.0.0.1:4173/lab` (interactive laboratory).

---

## Container Deployment

A self-contained `Dockerfile` bundles Node 24 and Python with the CPU PyTorch environment into an isolated Debian container:

```bash
# Build the container image
docker build -t latentforge .

# Run the container exposing port 4173
docker run -p 4173:4173 latentforge
```

Check service status:
```bash
curl -f http://127.0.0.1:4173/health
curl -f http://127.0.0.1:4173/ready
```

---

## Configuration & Resource Limits

Runtime parameters and queue limits can be adjusted via environment variables. All of them are optional, and none are secrets — LatentForge needs no API keys. [`.env.example`](.env.example) lists every variable with its default; the server reads the process environment and does not load `.env` files itself, so export the variables in your shell or pass the file to Docker with `docker run --env-file .env ...`.

| Variable | Default | Purpose |
|:---|:---:|:---|
| `PORT` | `4173` | Local HTTP server port |
| `HOST` | `0.0.0.0` | Interface the HTTP server binds to (use `127.0.0.1` to keep it local-only) |
| `PYTHON` | `python` | Python executable used to spawn the persistent worker |
| `LATENTFORGE_REQUEST_TIMEOUT_MS` | `20000` | Upper bound for an HTTP request; a timed-out request returns `504 REQUEST_TIMEOUT` |
| `LATENTFORGE_MAX_QUEUE` | `8` | Maximum queued experiment jobs before returning `503 OVERLOADED` |
| `LATENTFORGE_MAX_ACTIVE` | `1` | Concurrently active jobs (kept at 1 for CPU-bound PyTorch consistency) |
| `LATENTFORGE_WORKER_START_TIMEOUT_MS` | `30000` | Allowed worker startup window before timing out |
| `LATENTFORGE_WORKER_EXECUTION_TIMEOUT_MS` | `20000` | Maximum execution time per Python IPC invocation |
| `LATENTFORGE_MAX_WORKER_RESTART_ATTEMPTS` | `3` | Worker crash restarts allowed before failing safe |
| `LATENTFORGE_MAX_TASK_LENGTH` | `24` | Maximum move-sequence length for the `trained-recurrent` backend only — the three original backends are architecturally fixed at exactly 4 moves regardless of this value |
| `LATENTFORGE_MAX_REASONING_BUDGET` | `24` | Ceiling on reasoning budget; the three original backends can only narrow their own fixed `{1,2,4,8}` set toward this value, never exceed it |
| `LATENTFORGE_MAX_BODY_BYTES` | `65536` | Maximum HTTP request payload size in real bytes (correctly accounts multibyte UTF-8, not decoded string length) |

---

## Reproduce the Flagship Result

```bash
npm run experiment
```

Runs `research/flagship/train.py` (trains the recurrent model and the
one-shot baseline across 3 fixed seeds) then `research/flagship/evaluate.py`
(runs the full budget sweep on both held-out splits), and writes
`results/flagship-experiment.json` — the exact file the app's flagship
section reads via `GET /api/flagship-results`. Deterministic given the
fixed seeds; takes well under a minute on a single CPU core. Nothing in
the table above or in the app is typed by hand — regenerate it and
compare.

---

## Known Limitations

- **Flagship model scale:** Hidden size 64, a single synthetic task family, CPU float32, 3 training seeds. A real, reproducible result — not a benchmark claim, not a production-scale reasoning system.
- **Original-substrate scale:** The untrained models operate on an 8-dimensional hidden state with fixed weight matrices. They are designed for transparent mechanistic demonstration, not benchmark competition.
- **Untrained original substrate:** The `recurrent`/`hrm-inspired`/`bdh-cq-inspired` backends' parameters are deterministically initialized from fixed seeds rather than optimized via backpropagation — only the flagship `trained-recurrent` backend is actually trained.
- **Task family:** The original three backends are restricted to 4-step discrete 1D navigation on a 5-cell bounded grid; the flagship backend generalizes this to 2-24 steps on an 11-cell grid, but it is still one task family, not a benchmark suite.
- **Container & CI verification:** Docker containerization and the GitHub Actions workflow are verified via CI itself (both the `test` and `docker` jobs are green on `main`), not inside this local development sandbox, which has no `docker` binary — see `HACKATHON_BLOCKERS.md`.
- **Visual browser verification:** All API endpoints, DOM mutations, and UI state progressions are covered by unit and contract tests, but automated end-to-end visual rendering tests were not executed.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
