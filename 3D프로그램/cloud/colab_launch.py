"""Start the authenticated web editor and GPU worker in a user's free Colab session.

Google sign-in, Drive consent and free GPU allocation must be done by the user.
This helper neither purchases resources nor attempts to bypass free-session limits.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tarfile
import time
import urllib.request


MODEL_SHA256 = 'f015d1d15a52ed00d6fe22757c5ef4a74283c53daf829c838fa5c22616ed789c'


def sha256(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def read_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'EmojiStudio-Free-Setup'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def official_asset(repository, name, directory):
    release = read_json(f'https://api.github.com/repos/{repository}/releases/latest')
    asset = next(a for a in release['assets'] if a['name'] == name)
    digest = asset.get('digest', '')
    if not digest.startswith('sha256:'):
        raise RuntimeError('Official asset checksum is unavailable; verification will not be bypassed')
    target = directory / name
    urllib.request.urlretrieve(asset['browser_download_url'], target)
    if sha256(target) != digest.split(':', 1)[1]:
        target.unlink()
        raise RuntimeError('Official asset checksum mismatch')
    return target


def unpack(archive, destination):
    with tarfile.open(archive) as tar:
        # Supported by current Colab Python. Reject traversals and unsafe links.
        tar.extractall(destination, filter='data')


def node_runtime(directory):
    releases = read_json('https://nodejs.org/dist/index.json')
    release = next(r for r in releases if r.get('lts') and int(r['version'][1:].split('.')[0]) >= 22
                   and 'linux-x64' in r.get('files', []))
    version = release['version']
    name = f'node-{version}-linux-x64.tar.xz'
    archive = directory / name
    base = f'https://nodejs.org/dist/{version}/'
    with urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=60) as response:
        checksums = response.read().decode()
    expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == name)
    urllib.request.urlretrieve(base + name, archive)
    if sha256(archive) != expected:
        raise RuntimeError('Node.js checksum mismatch')
    unpack(archive, directory)
    return directory / f'node-{version}-linux-x64' / 'bin'


def wait_port(process, url, log, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Server exited. Inspect {log}')
        try:
            with urllib.request.urlopen(url, timeout=3):
                return
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                return  # Authentication is expected; not a model-readiness claim.
        except (OSError, TimeoutError):
            pass
        time.sleep(1)
    raise TimeoutError(f'Server did not start. Inspect {log}')


def launch(app_root, data_dir, runtime_root='/content/SihuCloud'):
    import bootstrap
    app_root = Path(app_root).resolve()
    runtime = Path(runtime_root)
    runtime.mkdir(parents=True, exist_ok=True)
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    if not data_dir.is_dir():
        raise RuntimeError('The private project data directory is unavailable')

    python, muse_root = bootstrap.prepare()
    run = bootstrap.run
    run('apt-get', 'update', '-qq')
    run('apt-get', 'install', '-y', '-qq', 'fonts-noto-cjk')
    binaries = runtime / 'binaries'
    binaries.mkdir(exist_ok=True)
    node_bin = node_runtime(binaries)
    ffmpeg_archive = official_asset('FFmpeg-Builds/FFmpeg-Builds',
                                   'ffmpeg-master-latest-linux64-gpl.tar.xz', binaries)
    unpack(ffmpeg_archive, binaries)
    ffmpeg_bin = binaries / 'ffmpeg-master-latest-linux64-gpl' / 'bin'
    ffmpeg = ffmpeg_bin / 'ffmpeg'
    if not ffmpeg.is_file():
        raise RuntimeError('The verified FFmpeg archive has an unexpected layout')
    tunnel = bootstrap.cloudflared()

    model_dir = app_root / 'vendor' / 'korean'
    if not (model_dir / 'ko_KO-kss_low.onnx').exists():
        archive = runtime / 'korean-model.tar.bz2'
        urllib.request.urlretrieve(
            'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/'
            'vits-mimic3-ko_KO-kss_low.tar.bz2', archive)
        if sha256(archive) != MODEL_SHA256:
            raise RuntimeError('Korean voice model checksum mismatch')
        voice_root = runtime / 'voice-download'
        voice_root.mkdir(exist_ok=True)
        unpack(archive, voice_root)
        model_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(voice_root / 'vits-mimic3-ko_KO-kss_low', model_dir, dirs_exist_ok=True)

    env = os.environ.copy()
    env['PATH'] = os.pathsep.join([str(node_bin), str(ffmpeg_bin), env.get('PATH', '')])
    subprocess.run([str(node_bin / 'npm'), 'ci', '--ignore-scripts', '--omit=dev'],
                   cwd=app_root, env=env, check=True)
    subprocess.run([str(node_bin / 'node'), 'scripts/ensure-assets.js'],
                   cwd=app_root, env=env, check=True)
    library = app_root / 'node_modules' / 'sherpa-onnx-linux-x64'
    env['LD_LIBRARY_PATH'] = str(library) + os.pathsep + env.get('LD_LIBRARY_PATH', '')
    env['EMOJI_FFMPEG'] = str(ffmpeg)
    env['SIHU_MUSETALK_ROOT'] = str(muse_root)
    env['SIHU_DATA_DIR'] = str(data_dir)
    env['SIHU_SESSION_TOKEN'] = secrets.token_urlsafe(32)
    env['SIHU_CLOUD_TOKEN'] = env['SIHU_SESSION_TOKEN']
    env['SIHU_CLOUD_ENDPOINT'] = 'http://127.0.0.1:7860'
    logs = runtime / 'logs'
    logs.mkdir(exist_ok=True)
    processes = []
    try:
        gpu_log = logs / 'gpu.log'
        with gpu_log.open('w') as stream:
            gpu = subprocess.Popen([str(python), str(app_root / 'cloud/server.py')], env=env,
                                   cwd=muse_root, stdout=stream, stderr=subprocess.STDOUT)
        processes.append(gpu)
        wait_port(gpu, 'http://127.0.0.1:7860/v1/health', gpu_log)
        web_log = logs / 'web.log'
        with web_log.open('w') as stream:
            web = subprocess.Popen([str(node_bin / 'node'), str(app_root / 'web-server.js')],
                                   cwd=app_root, env=env, stdout=stream, stderr=subprocess.STDOUT)
        processes.append(web)
        wait_port(web, 'http://127.0.0.1:3000/', web_log)
        tunnel_log = logs / 'tunnel.log'
        with tunnel_log.open('w') as stream:
            proxy = subprocess.Popen([str(tunnel), 'tunnel', '--url', 'http://127.0.0.1:3000',
                                      '--no-autoupdate'], stdout=stream, stderr=subprocess.STDOUT)
        processes.append(proxy)
        deadline = time.monotonic() + 90
        public_url = None
        while time.monotonic() < deadline:
            if proxy.poll() is not None:
                raise RuntimeError(f'Connection tunnel exited. Inspect {tunnel_log}')
            matches = re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com',
                                 tunnel_log.read_text(errors='replace'))
            if matches:
                public_url = matches[-1]
                break
            time.sleep(1)
        if not public_url:
            raise RuntimeError('No connection address was returned. Do not assume a working connection')
        return {'url': public_url, 'code': env['SIHU_SESSION_TOKEN'], 'processes': processes,
                'data_dir': str(data_dir), 'logs': str(logs)}
    except Exception:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        raise
