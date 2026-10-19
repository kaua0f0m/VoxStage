// Keyboard/D-pad integration tests. All audio is silent and the browser is muted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{server,library}=require('./menu-shell.cjs');
const out=path.resolve(__dirname,'../test-results/tv-navigation');fs.mkdirSync(out,{recursive:true});
async function graph(page,root='body'){
 const result=await page.evaluate(root=>{
  const scope=document.querySelector(root),selector='button,input:not([type="file"]):not([type="hidden"]),select,textarea,a[href],summary,[tabindex],[role="button"]';
  const visible=n=>!n.disabled&&n.tabIndex>=0&&!n.closest('[hidden],[inert],[aria-hidden="true"]')&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&(Number(getComputedStyle(n).opacity)!==0||n.matches('input[type="range"]'));
  const nodes=[...scope.querySelectorAll(selector)].filter(visible),edges=nodes.map(()=>[]);
  for(const [i,node]of nodes.entries())for(const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']){
   if(node.matches('input,select,textarea')&&['ArrowLeft','ArrowRight'].includes(key))continue;
   node.focus();window.voxstageTvKey(key);const j=nodes.indexOf(document.activeElement);if(j>=0)edges[i].push(j);
  }
  const reached=new Set([0]),queue=[0];while(queue.length){for(const next of edges[queue.shift()])if(!reached.has(next)){reached.add(next);queue.push(next);}}
  const reverse=edges.map(()=>[]);edges.forEach((next,i)=>next.forEach(j=>reverse[j].push(i)));const returned=new Set([0]),back=[0];while(back.length){for(const prior of reverse[back.shift()])if(!returned.has(prior)){returned.add(prior);back.push(prior);}}
  return {count:nodes.length,missing:nodes.filter((_,i)=>!reached.has(i)||!returned.has(i)).map(n=>n.id||n.textContent.trim().slice(0,60))};
 },root);
 assert.ok(result.count>2,root+' has navigation targets');assert.deepEqual(result.missing,[],root+' has unreachable targets');
}
async function fits(page,selector){const r=await page.locator(selector).boundingBox(),v=page.viewportSize();assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1,selector+' fits horizontally');return r;}
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
  for(const native of [false,true]){
   const context=await browser.newContext({viewport:{width:1280,height:720},...(native?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});
   await context.route('**/api/build-mode',r=>r.fulfill({json:{debug:true}}));
   await context.addInitScript(({native,library})=>{
    localStorage.setItem('voxstage-onboarding-hidden','1');localStorage.setItem('voxstage-debug-format','tv');
    if(native){window.VoxStageMedia={isTelevision:()=>true,setOrientation:()=>{},update:()=>{},clear:()=>{}};window.__TAURI__={core:{convertFileSrc:n=>'/music/'+n.split('/').pop(),invoke:async(command,args)=>{
     if(command==='is_debug_build')return true;if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library')return library;if(command==='mobile_mvsep_models')return [];
     if(command==='mobile_tv_host_api'){if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];if(args.path.endsWith('commands'))return {commands:[]};return {url:'http://192.168.1.5/remote#12345678901234567890123456789012'};}return {};
    }}};}
   },{native,library});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageStageReady&&VoxStageMenu.page==='connection');await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.locator(native?'#syncPcLibrary':'#remoteOpen').evaluate(n=>{const box=n.getBoundingClientRect(),text=n.querySelector('span').getBoundingClientRect();return text.left>=box.left&&text.right<=box.right;}),true,'Connect selection covers its entire label');
   for(const [w,h]of [[1280,720],[1920,1080]]){await page.setViewportSize({width:w,height:h});const card=await fits(page,'#remotePanel .remote-card');assert.ok(card.width>w*.85,'TV pairing fills the available page');await fits(page,'#remoteQr');}
   await page.setViewportSize({width:1280,height:720});await graph(page);await page.screenshot({path:path.join(out,(native?'native':'preview')+'-pairing.png')});
   await page.keyboard.press('Escape');await page.waitForFunction(()=>VoxStageMenu.page===null);await graph(page);
   await page.locator('#menuQueue').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>$('menuQueueDialog').open);await graph(page,'#menuQueueDialog');await page.keyboard.press('Escape');await page.waitForFunction(()=>!$('menuQueueDialog').open);
   await page.locator('#menuTvSing').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>playing&&$('display').classList.contains('show'));assert.equal(await page.evaluate(()=>document.activeElement.id),'dispPlay','Playback opens and focuses the stage');
   await page.keyboard.press('Enter');await page.waitForFunction(()=>!playing);await page.keyboard.press('Enter');await page.waitForFunction(()=>playing);await page.keyboard.press('Escape');assert.equal(await page.locator('#display').isVisible(),false);await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>document.activeElement.id),'menuTvSing','Back restores the launch control');
   await page.locator('#settingsTop').focus();await page.keyboard.press('Enter');await page.locator('#settingsTabAbout').focus();await page.keyboard.press('Enter');await graph(page);
   const credits=page.locator('.about-credits summary');await credits.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.about-credits').evaluate(n=>n.open),true,'Details are reachable and usable');await graph(page);await page.keyboard.press('Escape');assert.equal(await page.locator('#processingDialog').isVisible(),false);await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>document.activeElement.id),'settingsTop');
   const songMenu=page.locator('[data-menu-toggle]').first();await songMenu.focus();await page.keyboard.press('Enter');await page.waitForTimeout(70);const menu=page.locator('.track-menu:not([hidden])');assert.equal(await menu.count(),1);await graph(page,'.track-menu:not([hidden])');await page.keyboard.press('Escape');assert.equal(await menu.count(),0,'Back closes the song menu');await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-menu-toggle')),true,'Song menu restores its opener');
   await page.locator('#menuTvSing').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>$('display').classList.contains('show'));await page.evaluate(()=>pausePlayback());
   await page.locator('[data-speed-open]').focus();await page.keyboard.press('Enter');await page.waitForTimeout(70);await graph(page,'#playbackTransformPopup');const pitch=page.locator('#playbackTransformPopup [data-playback-pitch]');await pitch.focus();const old=await pitch.inputValue();await page.keyboard.press('ArrowRight');await page.waitForFunction(old=>document.querySelector('#playbackTransformPopup [data-playback-pitch]').value!==old,old);assert.notEqual(await pitch.inputValue(),old,'Select changes with the D-pad');await page.keyboard.press('ArrowLeft');await page.waitForFunction(old=>document.querySelector('#playbackTransformPopup [data-playback-pitch]').value===old,old);assert.equal(await pitch.inputValue(),old);await page.keyboard.press('Escape');await page.waitForTimeout(70);assert.equal(await page.locator('[data-speed-open]').evaluate(n=>n===document.activeElement),true,'Popup returns focus to its opener');
   await page.locator('#stageMoreOpen').focus();await page.keyboard.press('Enter');await page.waitForTimeout(60);await graph(page,'#stageMoreMenu');await page.keyboard.press('Escape');await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>document.activeElement.id),'stageMoreOpen');
   await page.locator('#dispPlay').focus();const shape=await page.locator('#dispPlay').evaluate(n=>({radius:parseFloat(getComputedStyle(n).borderRadius),outline:getComputedStyle(n).outlineStyle,shadow:getComputedStyle(n).boxShadow}));assert.ok(shape.radius>0);assert.equal(shape.outline,'none');assert.notEqual(shape.shadow,'none','Keyboard focus uses a rounded ring');await page.waitForTimeout(1500);await page.screenshot({path:path.join(out,(native?'native':'preview')+'-keyboard-focus.png')});await page.keyboard.press('Escape');
   assert.deepEqual(errors,[]);console.log('PASS TV '+(native?'native':'Debug preview')+': reachable focus graph, keyboard start/back, selects, details, popovers, rounded focus and large pairing');await context.close();
  }
  for(const native of [false,true]){
   const context=await browser.newContext({viewport:{width:390,height:844},...(native?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});await context.route('**/api/build-mode',r=>r.fulfill({json:{debug:true}}));
   await context.addInitScript(({native,library})=>{localStorage.setItem('voxstage-onboarding-hidden','1');localStorage.setItem('voxstage-debug-format','phone');if(native){window.VoxStageMedia={isTelevision:()=>false,setOrientation:()=>{},update:()=>{},clear:()=>{}};window.__TAURI__={core:{convertFileSrc:n=>'/music/'+n.split('/').pop(),invoke:async command=>command==='is_debug_build'?true:command==='mobile_get_music_dir'?'/music':command==='mobile_get_library'?library:{}}};}},{native,library});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageStageReady);await page.locator(native?'#syncPcLibrary':'#remoteOpen').click();
   for(const [w,h]of [[390,844],[844,390]]){await page.setViewportSize({width:w,height:h});const card=await fits(page,native?'#pcSyncDialog>.modal':'#remotePanel .remote-card');assert.ok(card.width>w-60,'Mobile pairing fills page width');assert.equal(await page.locator(native?'#pcSyncDialog':'#remotePanel').evaluate(n=>getComputedStyle(n).position),'static');}
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,(native?'native':'preview')+'-phone-pairing.png'),fullPage:true});await page.evaluate(()=>voxstageBack());await page.waitForFunction(()=>VoxStageMenu.page===null);assert.deepEqual(errors,[]);console.log('PASS Mobile '+(native?'native':'Debug preview')+': full-width pairing and Back');await context.close();
  }
 }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
