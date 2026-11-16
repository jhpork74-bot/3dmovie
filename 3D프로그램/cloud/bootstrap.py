"""Install the user's own free-GPU worker. Run inside Google Colab, not Windows."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.request

BASE = pathlib.Path('/content/SihuCloud')
MODEL_COMMIT = '0a89dec45a0192b824e3cf4daf96c239440c5ed8'


def run(*args, cwd=None):
    subprocess.run(list(map(str, args)), cwd=cwd, check=True)


def prepare():
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('Colab 메뉴 런타임 → 런타임 유형 변경 → 무료 GPU를 선택하세요. 할당이 안 되면 나중에 다시 시도해야 합니다.')
    print('GPU:', torch.cuda.get_device_name(0))
    BASE.mkdir(exist_ok=True)
    run(sys.executable, '-m', 'pip', 'install', 'uv==0.9.17')
    run(sys.executable, '-m', 'uv', 'python', 'install', '3.10')
    env = BASE / 'runtime'
    if not env.exists():
        run(sys.executable, '-m', 'uv', 'venv', '--python', '3.10', env)
    python = env / 'bin/python'
    model = BASE / 'MuseTalk'
    if not model.exists():
        run('git', 'clone', 'https://github.com/TMElyralab/MuseTalk.git', model)
    run('git', 'checkout', '--detach', MODEL_COMMIT, cwd=model)
    uv = [sys.executable, '-m', 'uv', 'pip', 'install', '--python', str(python)]
    run(*uv, 'torch==2.0.1+cu118', 'torchvision==0.15.2+cu118', 'torchaudio==2.0.2+cu118',
        '--index-url', 'https://download.pytorch.org/whl/cu118')
    # Only runtime components; training/demo dependencies are not required by inference.
    run(*uv, 'diffusers==0.30.2', 'accelerate==0.28.0', 'numpy==1.23.5',
        'opencv-python==4.9.0.80', 'soundfile==0.12.1', 'transformers==4.39.2',
        'huggingface_hub==0.30.2', 'librosa==0.11.0', 'numba==0.60.0', 'einops==0.8.1',
        'omegaconf==2.3.0', 'ffmpeg-python==0.2.0', 'imageio[ffmpeg]', 'gdown==5.2.0',
        'fastapi==0.115.12', 'uvicorn==0.34.2', 'python-multipart==0.0.20', 'pillow', 'tqdm')
    run(*uv, 'mmengine==0.10.7', 'mmcv==2.0.1', '--only-binary', 'mmcv',
        '--find-links', 'https://download.openmmlab.com/mmcv/dist/cu118/torch2.0/index.html')
    run(*uv, 'mmdet==3.1.0', 'mmpose==1.1.0')
    download = r'''
from huggingface_hub import hf_hub_download
from pathlib import Path
import urllib.request
import gdown
items = [
 ('TMElyralab/MuseTalk','musetalkV15/musetalk.json','models'),
 ('TMElyralab/MuseTalk','musetalkV15/unet.pth','models'),
 ('stabilityai/sd-vae-ft-mse','config.json','models/sd-vae'),
 ('stabilityai/sd-vae-ft-mse','diffusion_pytorch_model.bin','models/sd-vae'),
 ('openai/whisper-tiny','config.json','models/whisper'),
 ('openai/whisper-tiny','pytorch_model.bin','models/whisper'),
 ('openai/whisper-tiny','preprocessor_config.json','models/whisper'),
 ('yzd-v/DWPose','dw-ll_ucoco_384.pth','models/dwpose'),
]
for repo,file,dest in items:
 hf_hub_download(repo_id=repo,filename=file,local_dir=dest)
face = Path('models/face-parse-bisent'); face.mkdir(parents=True,exist_ok=True)
if not (face/'79999_iter.pth').exists():
 gdown.download(id='154JgKpzCPW82qINcVieuPH3fZ2e0P812',output=str(face/'79999_iter.pth'),quiet=False)
if not (face/'79999_iter.pth').exists(): raise RuntimeError('Official face-parsing weights unavailable')
if not (face/'resnet18-5c106cde.pth').exists():
 urllib.request.urlretrieve('https://download.pytorch.org/models/resnet18-5c106cde.pth',face/'resnet18-5c106cde.pth')
'''
    run(python, '-c', download, cwd=model)
    run(python, '-c', 'import torch; assert torch.cuda.is_available(); import diffusers, mmpose, fastapi; print("Runtime imports OK")', cwd=model)
    print('설치 단계 완료. 아직 실제 립싱크 생성·품질 검증은 별도로 필요합니다.')
    return python, model


def cloudflared():
    """Download from the official release and verify its published SHA256 digest."""
    req = urllib.request.Request('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',
                                 headers={'User-Agent': 'Sihu-Cloud-Setup'})
    with urllib.request.urlopen(req) as response:
        release = json.load(response)
    asset = next(a for a in release['assets'] if a['name'] == 'cloudflared-linux-amd64')
    digest = asset.get('digest') or ''
    if not digest.startswith('sha256:'):
        raise RuntimeError('Official cloudflared release did not provide a SHA256 digest; stop rather than bypass verification')
    target = BASE / 'cloudflared'
    urllib.request.urlretrieve(asset['browser_download_url'], target)
    with target.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != digest.split(':', 1)[1]:
        target.unlink()
        raise RuntimeError('cloudflared checksum mismatch')
    target.chmod(0o755)
    return target


if __name__ == '__main__':
    prepare()
