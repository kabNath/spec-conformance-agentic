# Build from the repo root (the calibration table lives in eval/):
#   docker build -f vidimus-svc/Dockerfile .
FROM python:3.12-slim
WORKDIR /svc
# git is needed by pip to install vidimus from its GitHub repo.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY vidimus-svc/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Build-time smoke test: fail the build if a primitive the sidecar needs is missing.
RUN python -c "import vidimus; from vidimus.audit.uncertainty import bootstrap_ci; from vidimus.audit.canonical import canonicalize; from vidimus.audit.signing import sign_hex; from vidimus.audit.keys import generate_keypair"
COPY vidimus-svc/main.py vidimus-svc/calibration.py ./
COPY eval/calibration.json /svc/calibration.json
ENV VIDIMUS_CALIBRATION_FILE=/svc/calibration.json
VOLUME ["/data"]
EXPOSE 4319
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4319"]
