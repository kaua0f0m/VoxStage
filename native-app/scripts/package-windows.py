"""Create the Windows portable release without private libraries or API keys.

Run with the installed Python 3.13 whose runtime and yt-dlp are bundled.
The executable must already have been built with tauri.desktop-release.conf.json.
"""
from __future__ import annotations

import importlib.metadata
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = os.environ.get("VOXSTAGE_BUILD_VERSION") or json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', VERSION):
    raise SystemExit('Invalid package version.')
RELEASE = ROOT / "releases" / f"V{VERSION}"
PACKAGE = RELEASE / "VoxStage-Windows-x64"
APP = PACKAGE / "app"
RUNTIME = APP / "python"


def copy_tree(source: Path, target: Path, excluded=()) -> None:
    for directory, directories, files in os.walk(source):
        directories[:] = [name for name in directories if name not in excluded]
        for name in files:
            file = Path(directory) / name
            if file.suffix in {".pyc", ".pyo"}:
                continue
            destination = target / file.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_file() and destination.stat().st_size == file.stat().st_size and destination.stat().st_mtime_ns == file.stat().st_mtime_ns:
                continue
            shutil.copy2(file, destination)


def write_archive() -> None:
    archive = RELEASE / f"VoxStage-{VERSION}-Windows-x64.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for file in sorted(PACKAGE.rglob("*")):
            if file.is_file() and "__pycache__" not in file.parts:
                output.write(file, file.relative_to(RELEASE))
    print(f"Windows portable: {archive} ({archive.stat().st_size:,} bytes)")


def main() -> None:
    runtime_only = "--runtime-only" in sys.argv
    refresh_only = "--refresh-only" in sys.argv
    executable = ROOT / "native-app/src-tauri/target/release/voxstage-native.exe"
    if not runtime_only and not executable.is_file():
        raise SystemExit("Build the Windows executable before packaging.")
    if sys.version_info[:2] != (3, 13):
        raise SystemExit("Use Python 3.13 to package its matching DLLs and stdlib.")
    if not runtime_only:
        metadata_args = [shutil.which('node') or 'node', str(ROOT / 'native-app/scripts/build-info.mjs'), VERSION]
        if '--reuse-build-info' in sys.argv:
            metadata_args.append('--reuse')
        build_info = json.loads(subprocess.check_output(metadata_args, cwd=ROOT, text=True))
        print(f"Build: {build_info['label']}", flush=True)
    APP.mkdir(parents=True, exist_ok=True)
    if not runtime_only:
        destination_executable = PACKAGE / "VoxStage.exe"
        def executable_hash(file):
            with file.open('rb') as source:
                return hashlib.file_digest(source, 'sha256').digest()
        if not destination_executable.is_file() or executable_hash(executable) != executable_hash(destination_executable):
            shutil.copy2(executable, destination_executable)
    config = json.loads((ROOT / "native-app/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    for source, destination in config["bundle"]["resources"].items():
        source_file = (ROOT / "native-app/src-tauri" / source).resolve()
        target_file = PACKAGE / destination
        target_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_file)

    if refresh_only:
        if not (RUNTIME / "python.exe").is_file() or not (APP / "bin/ffmpeg.exe").is_file():
            raise SystemExit('Prepare the complete package before refreshing frontend assets.')
        for name in ['THIRD_PARTY_NOTICES.md', 'README.md', 'CHANGELOG.md']:
            shutil.copy2(ROOT / name, PACKAGE / name)
        if "-" in VERSION:
            shutil.copy2(ROOT / 'TESTE-1.1.md', PACKAGE / 'TESTE-1.1.md')
        write_archive()
        return

    python_home = Path(sys.base_prefix)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for name in ["python.exe", "python313.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt"]:
        shutil.copy2(python_home / name, RUNTIME / name)
    copy_tree(python_home / "DLLs", RUNTIME / "DLLs", {"__pycache__"})
    copy_tree(python_home / "Lib", RUNTIME / "Lib", {"site-packages", "__pycache__", "test", "tests", "idlelib", "tkinter"})
    # Only distribution-owned files: no personal/global site-packages copied.
    packages = ["yt-dlp", "yt-dlp-ejs", "certifi", "brotli", "mutagen", "pycryptodomex",
                "requests", "urllib3", "charset-normalizer", "idna", "websockets", "pip", "setuptools"]
    versions = {}
    for name in packages:
        distribution = importlib.metadata.distribution(name)
        versions[name] = distribution.version
        for relative in distribution.files or []:
            relative = Path(str(relative))
            if ".." in relative.parts or "__pycache__" in relative.parts or relative.suffix == ".pyc":
                continue
            source = Path(distribution.locate_file(relative))
            if not source.is_file():
                continue
            destination = RUNTIME / "Lib/site-packages" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_file() and destination.stat().st_size == source.stat().st_size and destination.stat().st_mtime_ns == source.stat().st_mtime_ns:
                continue
            shutil.copy2(source, destination)

    bin_dir = APP / "bin"
    bin_dir.mkdir(exist_ok=True)
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node runtime not found for yt-dlp JS challenges.")
    shutil.copy2(node, bin_dir / "node.exe")
    ffmpeg_location = os.environ.get("VOXSTAGE_FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg_location:
        import imageio_ffmpeg
        ffmpeg_location = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg = Path(ffmpeg_location)
    if not ffmpeg.is_file():
        raise SystemExit("The FFmpeg runtime is missing.")
    shutil.copy2(ffmpeg, bin_dir / "ffmpeg.exe")
    licenses = PACKAGE / "licenses"
    licenses.mkdir(exist_ok=True)
    node_license = Path(os.environ["VOXSTAGE_NODE_LICENSE"]) if os.environ.get("VOXSTAGE_NODE_LICENSE") else next((Path(node).parent / name for name in ["LICENSE", "LICENSE.txt", "LICENSE.md"]
                         if (Path(node).parent / name).is_file()), None)
    if not node_license:
        raise SystemExit("The Node distribution license was not found next to node.exe.")
    shutil.copy2(node_license, licenses / "Node.txt")
    ffmpeg_license = subprocess.run([str(bin_dir / "ffmpeg.exe"), "-L"], capture_output=True, check=True)
    (licenses / "FFmpeg.txt").write_bytes(ffmpeg_license.stdout + ffmpeg_license.stderr)
    shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", PACKAGE / "THIRD_PARTY_NOTICES.md")
    shutil.copy2(ROOT / "README.md", PACKAGE / "README.md")
    (PACKAGE / "branding").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "branding/voxstage-animated.svg", PACKAGE / "branding/voxstage-animated.svg")
    shutil.copy2(ROOT / "CHANGELOG.md", PACKAGE / "CHANGELOG.md")
    if "-" in VERSION:
        shutil.copy2(ROOT / "TESTE-1.1.md", PACKAGE / "TESTE-1.1.md")
    (PACKAGE / "RUNTIMES.json").write_text(json.dumps({"python":sys.version, "packages":versions}, indent=2), encoding="utf-8")
    # WScript launches the GUI executable without opening a command window.
    (PACKAGE / "Abrir VoxStage.vbs").write_text(
        'Option Explicit\r\n'
        'Dim shell, files, folder, executable\r\n'
        'Set shell = CreateObject("WScript.Shell")\r\n'
        'Set files = CreateObject("Scripting.FileSystemObject")\r\n'
        'folder = files.GetParentFolderName(WScript.ScriptFullName)\r\n'
        'executable = files.BuildPath(folder, "VoxStage.exe")\r\n'
        'If Not files.FileExists(executable) Then\r\n'
        '  MsgBox "Extraia a pasta inteira do VoxStage antes de abrir.", 16, "VoxStage"\r\n'
        '  WScript.Quit 1\r\n'
        'End If\r\n'
        'shell.CurrentDirectory = folder\r\n'
        'shell.Run Chr(34) & executable & Chr(34), 1, False\r\n', encoding="ascii")
    (PACKAGE / "Abrir VoxStage.bat").unlink(missing_ok=True)
    (PACKAGE / "LEIA-ME.txt").write_text(
        f"VoxStage {VERSION} - Windows x64\n\n"
        "Extraia a pasta inteira e abra VoxStage.exe (ou Abrir VoxStage.vbs).\n"
        "Somente a janela do app aparece; o servidor roda em segundo plano.\n"
        "Python, yt-dlp, o runtime JS e FFmpeg estao incluidos. Node.js instalado nao e necessario.\n"
        "WebView2 e necessario; normalmente ja esta presente no Windows 10/11.\n\n"
        "Novas bibliotecas ficam em %APPDATA%/app.voxstage.player.\n"
        "Ao abrir perto do projeto antigo, o app reconhece native-app/dev-data automaticamente.\n"
        "O ambiente VOXSTAGE_DATA_DIR permite indicar outra pasta de biblioteca.\n"
        "Logs: voxstage-server.log na pasta da biblioteca.\n"
        "Feche a outra instancia do VoxStage antes de abrir esta versao: ambas usam a porta 8000.\n"
        "Instalacoes opcionais de modelos de IA precisam de internet e espaco adicional.\n",
        encoding="utf-8")
    # Runtime import is a packaging check; no external service or user data is used.
    subprocess.run([str(RUNTIME / "python.exe"), "-E", "-s", "-c",
                    "import ssl, ctypes, sqlite3, yt_dlp, yt_dlp_ejs; print('Runtime Python/yt-dlp pronto')"],
                   cwd=APP, check=True)
    if runtime_only:
        print(f"Windows runtime prepared: {RUNTIME}")
        return
    write_archive()


if __name__ == "__main__":
    main()
