# Lightweight Python runtime for rule engine + API service.
FROM python:3.11-slim

WORKDIR /app

# Install dependencies before app copy to maximize build cache hits.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy engine source code.
COPY app ./app

EXPOSE 8000

# Start FastAPI app (RabbitMQ consumer starts on startup event).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
