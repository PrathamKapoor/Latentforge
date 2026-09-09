# LatentForge — Node HTTP server + a persistent local Python/PyTorch worker,
# packaged together so a judge or deployer never needs to install Python,
# PyTorch, or Node themselves. CPU-only throughout (no CUDA/GPU dependency —
# see requirements.txt).

FROM node:24-bookworm-slim

# python3, pip, and venv for the persistent worker (src/reasoning/worker-server.py);
# installed without --no-install-recommends so ensurepip wheels (python3-pip-whl)
# are included for venv creation.
RUN apt-get update \
 && apt-get install -y python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies (CPU-only PyTorch wheel).
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/python -m pip install --upgrade pip \
 && /opt/venv/bin/python -m pip install --no-cache-dir \
    -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

ENV PATH="/opt/venv/bin:${PATH}"
ENV PYTHON="/opt/venv/bin/python3"

# Node dependencies (none declared beyond package metadata as of this phase,
# but `npm ci` still validates the lockfile).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
