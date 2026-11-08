"""Download model weights into a persistent cache before accepting jobs."""
import hashlib
import os
from pathlib import Path
from huggingface_hub import snapshot_download

models=[
    os.environ.get('MODEL_CHECKPOINT','stable-diffusion-v1-5/stable-diffusion-v1-5'),
    os.environ.get('LCM_LORA','latent-consistency/lcm-lora-sdv1-5'),
]
for model in models:
    if os.path.exists(model): continue
    marker=Path(os.environ.get('HF_HOME','/models/huggingface')) / ('.bt03-'+hashlib.sha256(model.encode()).hexdigest()[:16]+'.ready')
    if marker.is_file(): continue
    print(f'Downloading/cache checking {model}',flush=True)
    snapshot_download(repo_id=model)
    marker.touch()
print('Model cache ready',flush=True)
