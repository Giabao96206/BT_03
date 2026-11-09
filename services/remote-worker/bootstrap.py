"""Download only the files required by the FastSD Diffusers pipeline."""
import hashlib
import os
from pathlib import Path

from huggingface_hub import snapshot_download

BASE_MODEL_FILES = [
    "model_index.json",
    "feature_extractor/preprocessor_config.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "text_encoder/model.safetensors",
    "tokenizer/merges.txt",
    "tokenizer/special_tokens_map.json",
    "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json",
    "unet/config.json",
    "unet/diffusion_pytorch_model.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
]
LCM_MODEL_FILES = ["pytorch_lora_weights.safetensors"]


def main():
    models = [
        (
            os.environ.get(
                "MODEL_CHECKPOINT",
                "stable-diffusion-v1-5/stable-diffusion-v1-5",
            ),
            BASE_MODEL_FILES,
        ),
        (
            os.environ.get("LCM_LORA", "latent-consistency/lcm-lora-sdv1-5"),
            LCM_MODEL_FILES,
        ),
    ]
    cache = Path(os.environ.get("HF_HOME", "/models/huggingface"))
    for model, required_files in models:
        if os.path.exists(model):
            continue
        marker = cache / (
            ".bt03-v2-" + hashlib.sha256(model.encode()).hexdigest()[:16] + ".ready"
        )
        print(f"Downloading/checking required files for {model}", flush=True)
        snapshot = Path(
            snapshot_download(repo_id=model, allow_patterns=required_files)
        )
        missing = [name for name in required_files if not (snapshot / name).is_file()]
        if missing:
            raise RuntimeError(f"Model cache is incomplete for {model}: {missing}")
        marker.touch()
    print("Model cache ready", flush=True)


if __name__ == "__main__":
    main()
