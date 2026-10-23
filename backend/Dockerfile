FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

# Production command (4 uvicorn workers). docker-compose.yml overrides it with `uvicorn --reload` for development.
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
