"""Bundle the installed pure-Python yt-dlp package for the Android bridge."""
from pathlib import Path
import sys
import zipfile
from importlib.metadata import distribution

import yt_dlp
import yt_dlp_ejs
from yt_dlp.version import __version__


def main():
    if __version__ != "2026.10.10.233141":
        raise SystemExit(f"Expected yt-dlp 2026.10.10.233141; found {__version__}")
    source = Path(yt_dlp.__file__).parent
    target = Path(__file__).resolve().parents[1] / "src-tauri/gen/android/app/src/main/assets/yt-dlp-runtime.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for module in (yt_dlp, yt_dlp_ejs):
            source = Path(module.__file__).parent
            for path in sorted(source.rglob("*")):
                if path.is_file() and path.suffix in {".py", ".js", ".json"}:
                    archive.write(path, Path(module.__name__) / path.relative_to(source))
    print(f"Bundled yt-dlp {__version__}: {target} ({target.stat().st_size} bytes)")
    ejs = distribution('yt-dlp-ejs')
    license_file = next(path for path in ejs.files if str(path).endswith('licenses/LICENSE'))
    (target.parent / 'yt-dlp-ejs-LICENSE.txt').write_bytes(Path(ejs.locate_file(license_file)).read_bytes())


if __name__ == "__main__":
    sys.exit(main())
