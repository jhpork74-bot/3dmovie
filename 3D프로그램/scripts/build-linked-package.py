"""Create a coherent source+UI ZIP. Excludes private files and large runtime dependencies."""
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
repository = root.parent
listed = subprocess.check_output(['git', 'ls-files', '-z', '--', root.name], cwd=repository).decode().split('\0')
files = {repository / name for name in listed if name}
files.update(root / name for name in ['index.html', 'preview.html', 'EmojiStudio-Free-Cloud.ipynb',
                                      'cloud/colab_launch.py', 'scripts/build-linked-package.py'])
for name in ['avatar-closed.png', 'avatar-open.png']:
    file = root / 'assets' / name
    if file.is_file():
        files.add(file)
destination = root / 'EmojiStudio-Linked.zip'
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        if not file.is_file() or file.suffix in {'.zip', '.pyc'}:
            continue
        relative = file.relative_to(root)
        if any(part in {'node_modules', 'vendor', 'output', '__pycache__', '.git'} for part in relative.parts):
            continue
        archive.write(file, Path('EmojiStudio') / relative)
print(destination.name, destination.stat().st_size)
