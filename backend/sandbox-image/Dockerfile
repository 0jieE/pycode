# Build once on the server:  docker build -t lab-python-runner:1 sandbox-image/
FROM python:3.12-slim

# No pip packages, no compilers, no network tools: plain Python only.
RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin runner \
 && rm -rf /usr/local/lib/python3.12/ensurepip /root/.cache

COPY boot.py /opt/runner/boot.py
RUN chmod 555 /opt/runner/boot.py

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["python", "-u", "/opt/runner/boot.py"]
