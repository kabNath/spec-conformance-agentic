# Build from the repo root (the calibration table lives in eval/):
#   docker build -f vidimus-svc/Dockerfile .                  -> runtime image (last stage)
#   docker build -f vidimus-svc/Dockerfile --target test .    -> runs the test suite inside the image
FROM python:3.12-slim AS base
WORKDIR /svc
# git is needed by pip to install vidimus from its GitHub repo.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY vidimus-svc/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Build-time smoke test: fail the build if a primitive the sidecar needs is missing.
RUN python -c "import vidimus; from vidimus.audit.uncertainty import bootstrap_ci; from vidimus.audit.canonical import canonicalize; from vidimus.audit.signing import sign_hex; from vidimus.audit.keys import generate_keypair"

# --- test stage: same layout as the repo, dev deps, runs the suites. Not part of the runtime image.
FROM base AS test
WORKDIR /app
COPY vidimus-svc/ /app/vidimus-svc/
COPY eval/ /app/eval/
RUN pip install --no-cache-dir -r vidimus-svc/requirements-dev.txt
RUN python vidimus-svc/test_attest.py && python vidimus-svc/test_calibration.py && python vidimus-svc/test_keys.py

# --- runtime image (default target)
FROM base AS runtime
COPY vidimus-svc/main.py vidimus-svc/calibration.py vidimus-svc/trust.py vidimus-svc/trusted-keys.json ./
COPY eval/calibration.json /svc/calibration.json
ENV VIDIMUS_CALIBRATION_FILE=/svc/calibration.json \
    VIDIMUS_KEYS_DIR=/data/vidimus-keys
# Keys: mount a persistent volume on /data/vidimus-keys, or pass VIDIMUS_SIGNING_KEY_PEM.
# The service refuses to start with neither, unless VIDIMUS_ALLOW_EPHEMERAL=1 (local dev only).
VOLUME ["/data"]
EXPOSE 4319
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4319"]
