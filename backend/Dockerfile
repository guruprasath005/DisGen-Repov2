FROM python:3.11-slim

WORKDIR /app

# Ensure /app is on sys.path for every entrypoint (uvicorn, celery worker,
# celery beat) and — crucially — for prefork Celery worker processes.
# The `celery` console script does not add the cwd to sys.path, so without
# this, deferred imports inside tasks (e.g. `from compliance.retention ...`)
# fail with ModuleNotFoundError when executed inside a fork pool worker.
ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System dependencies for WeasyPrint, python-magic, psycopg, spaCy
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    libffi-dev \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-xlib-2.0-0 \
    libxml2 \
    libxslt1.1 \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model for NLP fallback
RUN python -m spacy download en_core_web_sm

# Non-root user for all services in this image (API + Celery workers)
RUN groupadd -r disgen && useradd -r -g disgen -d /app -s /sbin/nologin disgen

# Application code
COPY . .
RUN chown -R disgen:disgen /app

USER disgen

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
