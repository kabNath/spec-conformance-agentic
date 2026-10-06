# Build from the repo root (the calibration table lives in eval/):
#   docker build -f vidimus-svc/Dockerfile .
FROM python:3.12-slim
WORKDIR /svc
COPY vidimus-svc/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY vidimus-svc/main.py vidimus-svc/calibration.py ./
COPY eval/calibration.json /svc/calibration.json
ENV VIDIMUS_CALIBRATION_FILE=/svc/calibration.json
VOLUME ["/data"]
EXPOSE 4319
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4319"]
