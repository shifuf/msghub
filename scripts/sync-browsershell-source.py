"""Copy the buildable Android sources into this repository without local secrets/artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve(strict=True)
destination = Path(__file__).resolve().parent.parent / 'clients' / 'browsershell'
android_config = (source / 'app/build.gradle.kts').read_text(encoding='utf-8-sig')
version_names = re.findall(r'^\s*versionName\s*=\s*"([^"\r\n]+)"', android_config, re.MULTILINE)
version_codes = re.findall(r'^\s*versionCode\s*=\s*([1-9]\d*)\s*(?://[^\r\n]*)?$', android_config, re.MULTILINE)
if len(version_names) != 1 or len(version_codes) != 1:
    raise ValueError('Expected one literal versionName and versionCode in app/build.gradle.kts')
version_name, version_code = version_names[0], int(version_codes[0])
files = ['.gitignore', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat', 'app/build.gradle.kts']
files += [
    'docs/browser-runtime-qa.md',
    'docs/continuous-development.md',
    'docs/superpowers/specs/2026-11-21-webpage-status-indicator-design.md',
    'tools/browser-qa-fixtures.py',
]
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
(destination / 'source-manifest.json').write_text(json.dumps({'version': version_name, 'versionCode': version_code, 'files': manifest}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Synchronized {len(manifest)} source/build/dependency files for {version_name} (code {version_code}); excluded signing secrets, local SDK paths, builds and logs.')
