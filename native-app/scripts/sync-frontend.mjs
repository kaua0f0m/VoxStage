import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRoot = resolve(nativeRoot, '..');
const webDist = resolve(nativeRoot, 'web-dist');

mkdirSync(webDist, { recursive: true });
cpSync(resolve(projectRoot, 'fonts'), resolve(webDist, 'fonts'), { recursive: true, force: true });
for (const name of ['index.html', 'app.js', 'mobile-stage.css', 'android-tv.js', 'android-tv.css', 'onboarding.js', 'qr-code.js', 'remote.html']) {
  copyFileSync(resolve(projectRoot, name), resolve(webDist, name));
}
const androidResources = resolve(nativeRoot, 'src-tauri/gen/android/app/src/main/res');
const androidIconSource = resolve(nativeRoot, 'assets/android-icons');
for (const directory of ['drawable-v24', 'drawable', 'mipmap-anydpi-v26']) {
  const target = resolve(androidResources, directory);
  mkdirSync(target, { recursive: true });
  cpSync(resolve(androidIconSource, directory), target, { recursive: true, force: true });
}
console.log(`VoxStage UI preparada em ${webDist}`);
