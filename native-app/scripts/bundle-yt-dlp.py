"""Bundle the installed pure-Python yt-dlp package for the Android bridge."""
from pathlib import Path
import sys
import zipfile

import yt_dlp
from yt_dlp.version import __version__


def main():
    if __version__ != "2026.08.19":
        raise SystemExit(f"Expected yt-dlp 2026.08.19; found {__version__}")
    source = Path(yt_dlp.__file__).parent
    target = Path(__file__).resolve().parents[1] / "src-tauri/gen/android/app/src/main/assets/yt-dlp-2026.08.19.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file() and path.suffix in {".py", ".js"}:
                archive.write(path, Path("yt_dlp") / path.relative_to(source))
    print(f"Bundled yt-dlp {__version__}: {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
