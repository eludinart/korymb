FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

ENV UVICORN_PORT=8020
EXPOSE 8020

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import os,urllib.request; p=os.getenv('UVICORN_PORT','8020'); urllib.request.urlopen(f'http://127.0.0.1:{p}/health/live')"

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${UVICORN_PORT:-8020}"]
