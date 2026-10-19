import { copyFileSync, cpSync, mkdirSync, readFileSync } from 'node:fs';
import {createBuildInfo} from './build-info.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRoot = resolve(nativeRoot, '..');
const webDist = resolve(nativeRoot, 'web-dist');
if(process.argv.includes('--deploy')) {
  const version=process.env.VOXSTAGE_BUILD_VERSION||JSON.parse(readFileSync(resolve(projectRoot,'package.json'),'utf8')).version;
  const info=createBuildInfo(projectRoot,version);
  console.log(`Build: ${info.label}`);
}

mkdirSync(webDist, { recursive: true });
cpSync(resolve(projectRoot, 'fonts'), resolve(webDist, 'fonts'), { recursive: true, force: true });
cpSync(resolve(projectRoot, 'audio'), resolve(webDist, 'audio'), { recursive: true, force: true });
mkdirSync(resolve(webDist,'branding'),{recursive:true});
copyFileSync(resolve(projectRoot,'branding/voxstage-animated.svg'),resolve(webDist,'branding/voxstage-animated.svg'));
for (const name of ['build-info.js','build-info.json','index.html', 'interface-bootstrap.js', 'menu-shell.js', 'menu-shell.css', 'menu-pages.js', 'menu-pages.css', 'stage-shell.js', 'stage-shell.css', 'lyrics-model.js', 'app.js', 'scoring.js', 'scoring.css', 'microphone-input.js','phone-microphone.js','mobile-stage.css', 'android-tv.js', 'android-tv.css', 'onboarding.js', 'onboarding.css', 'qr-code.js', 'remote.html']) {
  copyFileSync(resolve(projectRoot, name), resolve(webDist, name));
}
const androidResources = resolve(nativeRoot, 'src-tauri/gen/android/app/src/main/res');
copyFileSync(resolve(projectRoot,'youtube_support.py'),resolve(nativeRoot,'src-tauri/gen/android/app/src/main/assets/youtube_support.py'));
copyFileSync(resolve(projectRoot,'cover_art.py'),resolve(nativeRoot,'src-tauri/gen/android/app/src/main/assets/cover_art.py'));
copyFileSync(resolve(projectRoot,'library_archive.py'),resolve(nativeRoot,'src-tauri/gen/android/app/src/main/assets/library_archive.py'));
const androidIconSource = resolve(nativeRoot, 'assets/android-icons');
for (const directory of ['drawable-v24', 'drawable', 'mipmap-anydpi-v26']) {
  const target = resolve(androidResources, directory);
  mkdirSync(target, { recursive: true });
  cpSync(resolve(androidIconSource, directory), target, { recursive: true, force: true });
}
console.log(`VoxStage UI preparada em ${webDist}`);
