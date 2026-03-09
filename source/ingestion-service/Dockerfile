# Lightweight Python runtime for ingestion API + poller.
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies first to leverage Docker layer cache.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source code.
COPY app ./app

EXPOSE 8000

# Start FastAPI app (background polling starts on startup event).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
