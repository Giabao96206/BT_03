FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    FASTSD_PATH=/opt/fastsdcpu IMAGE_ROOT=/tmp/bt03-output \
    HF_HOME=/models/huggingface TORCH_DTYPE=float32 CPU_THREADS=4
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.8.0+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir diffusers==0.37.0 transformers==5.0.0 peft==0.19.1 accelerate==1.14.0 huggingface_hub==1.33.0 Pillow==9.4.0 safetensors
COPY services/remote-worker/vendor/lcm_lora.py /opt/fastsdcpu/src/backend/pipelines/lcm_lora.py
COPY services/remote-worker/vendor/hokusai_ukiyoe.safetensors /opt/fastsdcpu/lora_models/hokusai_ukiyoe.safetensors
COPY services/fastsd-adapter/generate.py /opt/bt03/generate.py
COPY services/remote-worker/bootstrap.py services/remote-worker/worker.py /opt/bt03/remote-worker/
RUN mkdir -p /models/huggingface /tmp/bt03-output && useradd -r -u 10001 -d /models worker && chown -R worker:worker /models /tmp/bt03-output
USER worker
CMD ["sh","-c","python /opt/bt03/remote-worker/bootstrap.py && exec python /opt/bt03/remote-worker/worker.py"]
