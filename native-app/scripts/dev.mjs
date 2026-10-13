import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { delimiter } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRoot = resolve(nativeRoot, '..');
const devData = resolve(nativeRoot, 'dev-data');
const port = 8000;
const endpoint = `http://127.0.0.1:${port}/api/library`;
const isWindows = process.platform === 'win32';
const isAndroid = process.argv.includes('android');

async function responds() {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function prepareDevLibrary() {
  const libraryCopy = resolve(devData, 'library.json');
  if (existsSync(libraryCopy)) return;
  const mediaCopy = resolve(devData, 'music');
  mkdirSync(mediaCopy, { recursive: true });

  try { copyFileSync(resolve(projectRoot, 'library.json'), libraryCopy); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ['mvsep-config.json']) {
    try { copyFileSync(resolve(projectRoot, name), resolve(devData, name)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const sourceMedia = resolve(projectRoot, 'music');
  if (!existsSync(sourceMedia)) return;
  for (const entry of readdirSync(sourceMedia, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const source = resolve(sourceMedia, entry.name), destination = resolve(mediaCopy, entry.name);
    try { linkSync(source, destination); } catch (error) {
      if (error.code === 'EEXIST') continue;
      if (error.code !== 'EXDEV' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
      copyFileSync(source, destination);
    }
  }
}

function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

if (await responds()) {
  throw new Error(`A porta ${port} já está em uso. Feche o servidor nativo anterior antes de iniciar outro.`);
}
prepareDevLibrary();

const backendArgs = isWindows ? ['-3.13', 'server.py'] : ['server.py'];
const backend = spawn(isWindows ? 'py' : (process.env.PYTHON || 'python3'), backendArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VOXSTAGE_HOST: '0.0.0.0',
    VOXSTAGE_PORT: String(port),
    VOXSTAGE_DEBUG_BUILD: '1',
    // Keep browser data untouched. Media starts as hard-linked copies where possible.
    VOXSTAGE_DATA_DIR: devData,
  },
});

let tauri;
try {
  backend.on('error', error => console.error(`Não foi possível iniciar o backend Python: ${error.message}`));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend.exitCode !== null) throw new Error('O backend Python encerrou antes de ficar pronto.');
    if (await responds()) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw new Error(`O backend não respondeu na porta ${port}.`);

  if (isAndroid) {
    const prepared = spawnSync(process.execPath, [resolve(nativeRoot, 'scripts/prepare-android.mjs')], {cwd:nativeRoot, stdio:'inherit'});
    if (prepared.status !== 0) throw new Error('Android preparation failed.');
    const sdkRoot = process.env.ANDROID_HOME || resolve(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
    const adb = resolve(sdkRoot, 'platform-tools', isWindows ? 'adb.exe' : 'adb');
    const reverse = spawnSync(adb, ['reverse', `tcp:${port}`, `tcp:${port}`], {stdio: 'inherit'});
    if (reverse.error || reverse.status !== 0) {
      throw new Error('Conecte um celular com depuração USB ativa ou inicie um emulador Android antes de rodar este comando.');
    }
  }

  const tauriCli = resolve(nativeRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const cargoBin = resolve(homedir(), '.cargo', 'bin');
  tauri = spawn(process.execPath, [tauriCli, ...(isAndroid ? ['android', 'dev'] : ['dev'])], {
    cwd: nativeRoot,
    stdio: 'inherit',
    env: {...process.env, PATH: `${cargoBin}${delimiter}${process.env.PATH || ''}`},
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    tauri.once('error', reject);
    tauri.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} finally {
  stopTree(tauri);
  stopTree(backend);
}
