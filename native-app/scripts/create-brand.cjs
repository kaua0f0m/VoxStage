// Vector identity shared by the interface, Windows, Android and Google TV.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const brand = path.join(root, 'branding');
fs.mkdirSync(brand, {recursive:true});
const v = 'M26 49L39 78L52 49';
const x = 'M66 49L84 78M84 49L66 78';
const letters = `<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="${v}"/><path d="${x}"/></g>`;
// Same static snapshot and optical center on every launcher, including monochrome.
const point = '<g fill="currentColor"><circle cx="54" cy="24" r="1.8" opacity=".2"/><circle cx="61" cy="24" r="2.3" opacity=".4"/><circle cx="68" cy="28" r="2.8" opacity=".65"/><circle cx="75" cy="35" r="4.5"/></g>';
const glyph = letters + point;
const motion = 'M39 35Q57 5 75 35Q57 5 39 35';
const jumpingDot = (radius, opacity, delay) => `<g fill="currentColor" opacity="${opacity}"><circle r="${radius}"/><animateMotion path="${motion}" dur="2.6s" begin="${delay}s" repeatCount="indefinite" calcMode="spline" keyPoints="0;.5;.5;1;1" keyTimes="0;.38;.5;.88;1" keySplines=".3 0 .4 1;0 0 1 1;.3 0 .4 1;0 0 1 1"/></g>`;
const animatedGlyph = `<style>.vx-static{display:none}@media(prefers-reduced-motion:reduce){.vx-motion{display:none}.vx-static{display:block}}</style>${letters}<g class="vx-static">${point}</g><g class="vx-motion">${jumpingDot(1.8,.16,-2.39)}${jumpingDot(2.3,.3,-2.46)}${jumpingDot(2.8,.5,-2.53)}${jumpingDot(4.5,1,0)}</g>`;
const svg = (w,h,body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// Optical centering: most of the ink is in VX, so the small dot/trail must not
// push the letters into the lower half of Android's themed icon mask.
const centered = body => `<g transform="translate(11 8.5) scale(.75)">${body}</g>`;
const icon = svg(108,108,`<rect width="108" height="108" rx="28" fill="#17191a"/><g color="#d4fb69">${centered(glyph)}</g>`);
fs.writeFileSync(path.join(brand,'voxstage-icon.svg'), icon);
fs.writeFileSync(path.join(brand,'voxstage-compact.svg'), svg(108,108,`<g color="#d4fb69">${animatedGlyph}</g>`));
const nunitoData = fs.readFileSync(path.join(root,'fonts/Nunito-Variable.ttf')).toString('base64');
const nunitoStyle = `<style>@font-face{font-family:VoxStageNunito;src:url(data:font/ttf;base64,${nunitoData}) format('truetype');font-weight:200 1000;font-style:normal}</style>`;
const wordGlyph = `<text x="3" y="54" fill="#f5f5f2" font-family="VoxStageNunito,sans-serif" font-size="56" font-weight="900" letter-spacing=".2">vox<tspan fill="#d4fb69">stage</tspan></text>`;
const wordmark = '<span class="vx-wordmark-text">vox<em>stage</em></span>';
fs.writeFileSync(path.join(brand,'voxstage-wordmark.svg'), svg(295,70,nunitoStyle+wordGlyph));
const longBody = `${nunitoStyle}<g color="#d4fb69">${animatedGlyph}</g><g transform="translate(118 21)">${wordGlyph}</g>`;
fs.writeFileSync(path.join(brand,'voxstage-long.svg'), svg(455,108,longBody));
const appMark = `<svg viewBox="10 3 90 86" aria-hidden="true" focusable="false"><g transform="translate(-3.5 -12)">${animatedGlyph}</g></svg>`;
const appSource = path.join(root,'app.js');
let appText = fs.readFileSync(appSource,'utf8').replace(/^const voxstageMark = .*;$/m,`const voxstageMark = ${JSON.stringify(appMark)};`);
const wordDeclaration = `const voxstageWordmark = ${JSON.stringify(wordmark)};`;
appText = /^const voxstageWordmark = .*;$/m.test(appText)
  ? appText.replace(/^const voxstageWordmark = .*;$/m,wordDeclaration)
  : appText.replace(/^(const voxstageMark = .*;)$/m,`$1\n${wordDeclaration}`);
fs.writeFileSync(appSource,appText);
const indexSource = path.join(root,'index.html');
fs.writeFileSync(indexSource,fs.readFileSync(indexSource,'utf8').replace(/(<div class="brand-mark vx-brand-mark" aria-hidden="true">).*?(<\/div>)/,`$1${appMark}$2`));
const assets = path.join(root,'native-app/assets/android-icons');
for (const [folder,name,color] of [['drawable-v24','ic_launcher_foreground.xml','#D4FB69'],['drawable','ic_launcher_monochrome.xml','#FFFFFF']]) {
  const dotPath = (cx,cy,r,alpha) => `<path android:fillColor="${color}" android:fillAlpha="${alpha}" android:pathData="M${cx},${cy-r}a${r},${r} 0,1 0,0 ${r*2}a${r},${r} 0,1 0,0 -${r*2}"/>`;
  fs.writeFileSync(path.join(assets,folder,name), `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><group android:scaleX="0.75" android:scaleY="0.75" android:translateX="11" android:translateY="8.5"><path android:fillColor="#00000000" android:strokeColor="${color}" android:strokeWidth="8" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${v}"/><path android:fillColor="#00000000" android:strokeColor="${color}" android:strokeWidth="8" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${x}"/>${dotPath(54,24,1.8,.2)}${dotPath(61,24,2.3,.4)}${dotPath(68,28,2.8,.65)}${dotPath(75,35,4.5,1)}</group></vector>`);
}
fs.writeFileSync(path.join(assets,'drawable','ic_launcher_background.xml'), '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#17191A"/></shape>');
const board = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VoxStage · identidade V1.0</title><style>body{background:#101012;color:#f5f5f2;font:16px Segoe UI,sans-serif;padding:45px}h1{font-weight:600}main{display:grid;grid-template-columns:1fr 2fr;gap:24px;max-width:950px}.card{background:#1b1d20;border:1px solid #34363a;border-radius:24px;padding:30px;min-width:0}.card img{max-width:100%;height:108px}.caption{color:#adb0b7;margin-top:20px}.themed{display:flex;gap:16px;margin-top:22px}.themed span{display:grid;place-items:center;width:74px;height:74px;border-radius:50%;background:#dae7c9;overflow:hidden}.themed svg{width:74px;height:74px;color:#324527}.themed span:nth-child(2){background:#ead7f7}.themed span:nth-child(2) svg{color:#533c65}.themed span:nth-child(3){background:#f9d7df}.themed span:nth-child(3) svg{color:#643846}@media(max-width:640px){body{padding:20px}main{grid-template-columns:1fr}}</style><h1>VoxStage</h1><p>Uma bolinha salta entre V e X, deixando um rastro durante o movimento.</p><main><div class="card"><img src="voxstage-icon.svg"><div class="caption">Ícone · VX mais suave e espaçado</div><div class="themed">${[1,2,3].map(()=>`<span>${svg(108,108,centered(glyph))}</span>`).join('')}</div><div class="caption">Material You · mesma centralização em qualquer cor</div></div><div class="card"><img src="voxstage-long.svg"><div class="caption">Logo longa · nome completo</div><img src="voxstage-compact.svg"><div class="caption">Logo curta · salto animado com rastro</div></div></main>`;
fs.writeFileSync(path.join(brand,'index.html'), board);

(async()=>{
  const {chromium} = require('playwright');
  const browser = await chromium.launch({headless:true, ...(process.env.VOXSTAGE_BROWSER_CHANNEL ? {channel:process.env.VOXSTAGE_BROWSER_CHANNEL} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1080,height:650}});
    await page.goto('file:///'+path.join(brand,'index.html').replace(/\\/g,'/'));
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(brand,'voxstage-v1-identidade.png')});
    const icons = path.join(root,'native-app/src-tauri/icons');
    const pngs=[];
    for(const size of [16,32,48,64,128,256,512]) {
      await page.setViewportSize({width:size,height:size});
      await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${icon}`);
      const png=await page.screenshot({path:size===512?path.join(icons,'icon.png'):undefined,omitBackground:true});
      if(size<=256)pngs.push({size,png});
      // Pre-adaptive launchers and leanback use these actual mipmaps.
      for(const [dpi,pixels] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]) {
        if(size!==512)continue;
        await page.setViewportSize({width:pixels,height:pixels});
        const dir=path.join(root,'native-app/src-tauri/gen/android/app/src/main/res','mipmap-'+dpi);
        fs.mkdirSync(dir,{recursive:true});
        await page.screenshot({path:path.join(dir,'ic_launcher.png'),omitBackground:true});
      }
    }
    let offset=6+16*pngs.length;
    const header=Buffer.alloc(offset);header.writeUInt16LE(1,2);header.writeUInt16LE(pngs.length,4);
    pngs.forEach(({size,png},i)=>{const p=6+16*i;header[p]=size===256?0:size;header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
    fs.writeFileSync(path.join(icons,'icon.ico'),Buffer.concat([header,...pngs.map(item=>item.png)]));
    fs.writeFileSync(path.join(icons,'voxstage.svg'),icon);
    await page.setViewportSize({width:320,height:180});
    await page.setContent(`<style>body{margin:0;display:grid;place-items:center;height:100vh;background:#17191a}svg{width:285px;height:auto}.vx-motion{display:none}.vx-static{display:block!important}</style>${fs.readFileSync(path.join(brand,'voxstage-long.svg'),'utf8')}`);
    await page.screenshot({path:path.join(assets,'drawable','voxstage_tv_banner.png')});
  } finally {await browser.close();}
  console.log('Identidade criada em '+brand);
})().catch(error=>{console.error(error);process.exitCode=1;});
