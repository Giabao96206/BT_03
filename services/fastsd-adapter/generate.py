"""One-shot native FastSD CPU adapter. The Redis semaphore is held by its parent."""
import json
import os
import pathlib
import sys
import time
import traceback

def local_snapshot(model_id, required_file):
    """Use existing cache files without requiring every optional Hub file."""
    candidate = pathlib.Path(model_id)
    if candidate.exists():
        result = candidate.resolve()
    else:
        hub = pathlib.Path(os.environ.get('HF_HOME', str(pathlib.Path.home() / '.cache/huggingface'))) / 'hub'
        repository = hub / ('models--' + model_id.replace('/', '--'))
        ref = repository / 'refs/main'
        if ref.is_file():
            result = repository / 'snapshots' / ref.read_text().strip()
        else:
            snapshots = list((repository / 'snapshots').glob('*'))
            if not snapshots:
                raise FileNotFoundError(f'Model is not cached: {model_id}')
            result = max(snapshots, key=lambda item: item.stat().st_mtime)
    if not (result / required_file).is_file():
        raise FileNotFoundError(f'Cached model lacks {required_file}: {model_id}')
    return str(result)

def main():
    data = json.load(sys.stdin)
    root = pathlib.Path(os.environ['FASTSD_PATH']).resolve()
    sys.path.insert(0, str(root / 'src'))
    import torch
    from backend.pipelines.lcm_lora import get_lcm_lora_pipeline
    from PIL import Image
    torch.set_num_threads(max(1, min(8, int(os.environ.get('CPU_THREADS', '4')))))
    torch.set_num_interop_threads(1)

    output = pathlib.Path(data['output']).resolve()
    image_root = pathlib.Path(os.environ['IMAGE_ROOT']).resolve()
    if image_root not in output.parents or output.suffix.lower() != '.png':
        raise ValueError('Output path is outside image storage')
    style = pathlib.Path(data['styleLora']).resolve()
    if not style.is_file():
        raise FileNotFoundError(f'Style LoRA unavailable: {style}')
    for dimension in ('width', 'height'):
        if data[dimension] < 256 or data[dimension] > 768 or data[dimension] % 8:
            raise ValueError(f'Invalid {dimension}')
    if not 1 <= data['steps'] <= 12:
        raise ValueError('Invalid step count')

    started = time.perf_counter()
    dtype = torch.float16 if os.environ.get('TORCH_DTYPE', 'float32') == 'float16' else torch.float32
    base_model = local_snapshot(data['checkpoint'], 'model_index.json')
    lcm_lora = local_snapshot(data['lcmLora'], 'pytorch_lora_weights.safetensors')
    pipeline = get_lcm_lora_pipeline(base_model,lcm_lora,True,dtype,pipeline_args={'safety_checker':None,'requires_safety_checker':False})
    pipeline.load_lora_weights(str(style.parent),weight_name=style.name,adapter_name='ukiyoe',local_files_only=True)
    pipeline.set_adapters(['lcm','ukiyoe'],adapter_weights=[1.0,float(data['styleWeight'])])
    pipeline.to('cpu')
    generator = torch.Generator(device='cpu').manual_seed(data['seed'])
    image = pipeline(prompt=data['prompt'],negative_prompt=data['negativePrompt'],width=data['width'],height=data['height'],num_inference_steps=data['steps'],guidance_scale=data['guidance'],generator=generator).images[0]
    if not isinstance(image,Image.Image):
        raise RuntimeError('FastSD returned no PIL image')
    output.parent.mkdir(parents=True,exist_ok=True)
    temp = output.with_name(output.name + f'.{os.getpid()}.tmp')
    try:
        image.save(temp,format='PNG')
        if output.exists():
            raise FileExistsError(str(output))
        os.link(temp,output)
    finally:
        temp.unlink(missing_ok=True)
    print('BT03_RESULT '+json.dumps({'latencyMs':round((time.perf_counter()-started)*1000),'width':image.width,'height':image.height,'path':str(output)}),flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        print('BT03_RESULT '+json.dumps({'error':str(error)}),flush=True)
        sys.exit(1)
