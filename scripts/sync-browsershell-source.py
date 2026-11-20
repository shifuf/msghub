"""Copy the buildable Android sources into this repository without local secrets/artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve(strict=True)
destination = Path(__file__).resolve().parent.parent / 'clients' / 'browsershell'
files = ['.gitignore', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat', 'app/build.gradle.kts']
directories = ['app/src', 'app/libs', 'gradle/wrapper', 'third_party/jpush/jiguang_sdk/jiguang/src/main/res']
for relative in directories:
    files.extend(str(path.relative_to(source)).replace('\\', '/') for path in (source / relative).rglob('*') if path.is_file())
manifest = []
for relative in sorted(set(files)):
    src = source / relative
    if src.is_symlink() or source not in src.resolve(strict=True).parents:
        raise ValueError('Source must be an ordinary project file')
    if src.suffix.lower() in {'.jks', '.keystore', '.p12', '.log', '.apk'} or src.name in {'keystore.properties', 'jpush.properties', 'local.properties'}:
        raise ValueError('Local credentials and generated files must not be synchronized')
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, target)
    manifest.append({'path': relative, 'sha256': hashlib.sha256(src.read_bytes()).hexdigest()})
(destination / 'source-manifest.json').write_text(json.dumps({'version': '2.2.3', 'versionCode': 36, 'files': manifest}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Synchronized {len(manifest)} source/build/dependency files; excluded signing secrets, local SDK paths, builds and logs.')
