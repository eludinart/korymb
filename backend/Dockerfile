FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

# Coolify injecte PORT selon le mapping du service — uvicorn doit l'écouter.
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import os,urllib.request; p=os.getenv('PORT','3000'); urllib.request.urlopen(f'http://127.0.0.1:{p}/health/live')"

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
