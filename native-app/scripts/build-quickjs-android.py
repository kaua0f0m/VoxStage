"""Build the pinned MIT QuickJS CLI as an Android executable in nativeLibraryDir."""
import argparse, hashlib, os, subprocess, tarfile, urllib.request
from pathlib import Path

VERSION = '2026-06-04'
DIGEST = 'b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a'
root = Path(__file__).resolve().parents[1]
cache = root / '.build-cache' / 'quickjs'
cache.mkdir(parents=True, exist_ok=True)
archive = cache / f'quickjs-{VERSION}.tar.xz'
if not archive.exists():
    urllib.request.urlretrieve(f'https://bellard.org/quickjs/quickjs-{VERSION}.tar.xz', archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != DIGEST:
    raise SystemExit('QuickJS source checksum mismatch.')
with tarfile.open(archive) as source:
    source.extractall(cache, filter='data')
directory = cache / f'quickjs-{VERSION}'
# yt-dlp only uses --help / --script; omit the interactive bytecode REPL.
qjs = (directory / 'qjs.c').read_text()
qjs = qjs.replace('js_std_eval_binary(ctx, qjsc_repl, qjsc_repl_size, 0);', 'fprintf(stderr, "Interactive mode is unavailable.\\n"); goto fail;')
(directory / 'qjs.c').write_text(qjs)
ndk = Path(os.environ.get('NDK_HOME') or Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/ndk/27.2.12479018')
toolchain = ndk / 'toolchains/llvm/prebuilt/windows-x86_64'
destination = root / 'src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libvoxstage_qjs.so'
destination.parent.mkdir(parents=True, exist_ok=True)
files = ['qjs.c', 'quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c', 'cutils.c', 'quickjs-libc.c']
command = [str(toolchain / 'bin/clang.exe'), '--target=aarch64-linux-android24', '-O2', '-fPIE', '-pie', '-Wl,-z,max-page-size=16384', '-D_GNU_SOURCE', f'-DCONFIG_VERSION="{VERSION}"', '-I', str(directory), *[str(directory / name) for name in files], '-lm', '-ldl', '-pthread', '-o', str(destination)]
subprocess.run(command, check=True)
subprocess.run([str(toolchain / 'bin/llvm-strip.exe'), str(destination)], check=True)
assets = root / 'src-tauri/gen/android/app/src/main/assets'
(assets / 'QuickJS-LICENSE.txt').write_bytes((directory / 'LICENSE').read_bytes())
print('QuickJS ARM64:', destination.stat().st_size, 'bytes')
