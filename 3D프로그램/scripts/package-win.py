"""Assemble an editor prototype; this does not validate Windows execution."""
import hashlib
import json
import pathlib
import shutil
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
runtime = pathlib.Path(sys.argv[1])
checksums = pathlib.Path(sys.argv[2])
expected = next(line.split()[0] for line in checksums.read_text().splitlines()
                if line.endswith('electron-v45.3.3-win32-x64.zip'))
actual = hashlib.file_digest(runtime.open('rb'), 'sha256').hexdigest()
if actual != expected:
    raise SystemExit('Electron checksum mismatch')
stage = root / 'dist' / 'Sihu-Emoji-Studio-Editor-Prototype'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True)
with zipfile.ZipFile(runtime) as z:
    z.extractall(stage)
(stage / 'electron.exe').rename(stage / 'Sihu Emoji Studio.exe')
app = stage / 'resources' / 'app'
app.mkdir(parents=True, exist_ok=True)
for name in ['package.json', 'main.js', 'preload.js', 'engine.js', 'worker.js', 'README.md', 'THIRD_PARTY.md', 'PROGRESS.md']:
    shutil.copy2(root / name, app / name)
for name in ['assets', 'vendor', 'ui']:
    shutil.copytree(root / name, app / name)
for name in ['pngjs', 'sherpa-onnx-node', 'sherpa-onnx-win-x64']:
    shutil.copytree(root / 'node_modules' / name, app / 'node_modules' / name)
shutil.copy2(root / 'Launch.cmd', stage / 'Launch.cmd')
(stage / 'scripts').mkdir()
shutil.copy2(root / 'scripts' / 'Launch.ps1', stage / 'scripts' / 'Launch.ps1')
for name in ['README.md', 'THIRD_PARTY.md', 'PROGRESS.md']:
    shutil.copy2(root / name, stage / name)
for relative in ['Sihu Emoji Studio.exe', 'resources/app/vendor/ffmpeg.exe',
                 'resources/app/vendor/korean/ko_KO-kss_low.onnx',
                 'resources/app/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node']:
    p = stage / relative
    if not p.is_file() or not p.stat().st_size:
        raise SystemExit(f'Missing Windows component: {relative}')
archive = shutil.make_archive(str(stage), 'zip', stage.parent, stage.name)
digest = hashlib.file_digest(open(archive, 'rb'), 'sha256').hexdigest()
pathlib.Path(archive + '.sha256').write_text(f'{digest}  {pathlib.Path(archive).name}\n')
print(json.dumps({'archive': archive, 'bytes': pathlib.Path(archive).stat().st_size,
                  'sha256': digest, 'windows_runtime_tested': False,
                  'precision_lipsync_included': False}, indent=2))
