import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {dirname,resolve,delimiter} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriRoot = resolve(nativeRoot, 'src-tauri');
const env = {...process.env, PATH:resolve(homedir(), '.cargo/bin')+delimiter+(process.env.PATH||'')};
const cargo = spawnSync('cargo', ['metadata','--locked','--format-version','1'], {cwd:tauriRoot,env,encoding:'utf8',maxBuffer:32*1024*1024});
if(cargo.status!==0) throw new Error(cargo.stderr || 'Install Rust/Cargo before preparing Android.');
const dependency = JSON.parse(cargo.stdout).packages.find(p=>p.name==='tauri');
if(!dependency) throw new Error('Tauri dependency not found in Cargo metadata.');
const android = resolve(dirname(dependency.manifest_path),'mobile/android').split(String.fromCharCode(92)).join('/');
writeFileSync(resolve(tauriRoot,'gen/android/tauri.settings.gradle'), [
  '// Generated from Cargo metadata; contains a local machine path.',
  "include ':tauri-android'",
  `project(':tauri-android').projectDir = new File(${JSON.stringify(android)})`,
  '',
].join(String.fromCharCode(10)));
const python = process.env.PYTHON || (process.platform==='win32'?'py':'python3');
const args = process.platform==='win32' && !process.env.PYTHON ? ['-3.13'] : [];
const bundle = spawnSync(python,[...args,resolve(nativeRoot,'scripts/bundle-yt-dlp.py')],{cwd:nativeRoot,stdio:'inherit'});
if(bundle.status!==0) throw new Error('Install requirements-build.txt with Python 3.13 first.');
