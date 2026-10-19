// Real stage controls. Fixtures contain only silence; Edge is also muted.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright'),model=require('../../lyrics-model.js'),{server,library}=require('./menu-shell.cjs');
const out=path.resolve(__dirname,'../test-results/stage-shell');fs.mkdirSync(out,{recursive:true});
const row=(id,text,time,end)=>({id,text,time,end,words:model.words(text).map((word,i)=>({word,start:time/1000+i*.7,end:time/1000+(i+1)*.7}))});
Object.assign(library[0],model.storage(model.normalize({lead:[row('l0','Look through my eyes',1000,4500),row('l1','Lead sings again',6000,9500)],parallel:[row('p0','Look through my eyes',1000,4500),row('p1','A separate second voice',6000,9500)],backing:[row('b0','An echo',1600,4000)]})));
async function bounds(page,selector){
 const r=await page.locator(selector).boundingBox(),v=page.viewportSize();
 assert.ok(r&&r.width>0&&r.height>0,selector+' is visible');assert.ok(r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,selector+' fits '+JSON.stringify({r,v}));return r;
}
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{for(const [device,width,height]of[['pc',1440,900],['portrait',390,844],['landscape',844,390],['tv',1280,720]].filter(([d])=>!process.argv[2]||d===process.argv[2])){
  const context=await browser.newContext({viewport:{width,height},...(device!=='pc'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});
  await context.addInitScript(({device,library})=>{
   localStorage.setItem('voxstage-onboarding-hidden','1');
   if(device!=='pc'){
    window.VoxStageMedia={isTelevision:()=>device==='tv',setOrientation:()=>{},update:()=>{},clear:()=>{},exitToLauncher:()=>{window.__launcherExited=true;}};
    window.__TAURI__={core:{convertFileSrc:n=>'/music/'+n.split('/').pop(),invoke:async(command,args)=>{
     if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library')return library;if(command==='mobile_mvsep_models')return [];
     if(command==='mobile_tv_host_api'){if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];if(args.path.endsWith('commands'))return {commands:[]};return {};}
     return {};
    }}};
   }
  },{device,library});
  context.setDefaultTimeout(10000);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));await page.route('**/lrclib.net/**',r=>r.fulfill({json:[]}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageStageReady);await page.evaluate(()=>document.fonts.ready);await page.addStyleTag({content:'#display *{transition:none!important;animation:none!important}'});
  if(device==='pc'){await page.locator('#settingsTop').click();await page.locator('#settingsTabVisual').click();assert.equal(await page.locator('#lyricsFont').inputValue(),'nunito');await page.locator('#lyricsFont').selectOption('nunito');assert.equal(await page.evaluate(()=>processingSettings.lyricsFont),'nunito');await page.locator('#lyricsFont').selectOption('manrope');await page.locator('#menuLibrary').click();}
  await page.evaluate(async id=>{closeRemotePanel();await playSong(id);pausePlayback();$('display').classList.add('show');setStageControlsHidden(false);seek(30);},library[0].id);await page.waitForTimeout(200);
  assert.match(await page.locator('#lyrics').evaluate(n=>getComputedStyle(n).fontFamily),device==='pc'?/Manrope/:/Nunito/);const original=await page.evaluate(()=>JSON.stringify(current.lyricVoices));assert.equal(await page.locator('#stageSongTitle').textContent(),library[0].title);
  for(const id of ['dispPlay','displayBack10','displayForward10','previousDisplay','nextDisplay','openLyrics','lyricSync','mobileControlsToggle','quickExitDisplay','scoreOpen'])assert.equal(await page.locator('#'+id).count(),1,'One instance of '+id);
  const sizes=device==='pc'?[[1440,900],[850,560],[1920,1080]]:device==='portrait'?[[390,844],[360,640]]:device==='tv'?[[1280,720],[1920,1080]]:[[844,390],[740,360]];
  for(const [w,h]of sizes){
   await page.setViewportSize({width:w,height:h});await page.waitForTimeout(70);const panel=await bounds(page,'.palco-panel'),play=await bounds(page,'#dispPlay');await bounds(page,'.palco-header-actions');
   assert.ok(Math.abs(play.x+play.width/2-w/2)<2,'Playback remains centered');assert.ok(panel.height<(device==='pc'?180:device==='portrait'?220:160),'Compact controls');
   for(const selector of ['#previousDisplay','#displayBack10','#displayForward10','#nextDisplay','#scoreOpen','[data-speed-open]'])await bounds(page,selector);
   const overlap=await page.locator('.palco-controls').evaluate(n=>{const nodes=[...n.querySelectorAll('button')].filter(b=>b.getClientRects().length&&!b.closest('.playback-transform-popup'));return nodes.flatMap((a,i)=>nodes.slice(i+1).filter(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1;}).map(b=>a.id+':'+b.id));});assert.deepEqual(overlap,[],'Controls do not overlap at '+w);
  }
  await page.setViewportSize({width,height});await page.evaluate(()=>seek(30));await page.locator('#displayForward10').click();assert.ok(await page.evaluate(()=>playbackPosition())>11);await page.locator('#displayBack10').click();assert.ok(await page.evaluate(()=>playbackPosition())<2);
  await page.locator('#dispPlay').click();assert.equal(await page.evaluate(()=>playing),true);await page.locator('#dispPlay').click();assert.equal(await page.evaluate(()=>playing),false);
  await page.locator('#nextDisplay').click();await page.waitForFunction(id=>current?.id===id&&current.buffers?.Inst,library[1].id);await page.evaluate(()=>pausePlayback());await page.locator('#previousDisplay').click();await page.waitForFunction(id=>current?.id===id&&current.buffers?.Inst,library[0].id);await page.evaluate(()=>{pausePlayback();seek(30);});
  if(device!=='pc'){
   await page.locator('#stageMoreOpen').click();assert.equal(await page.evaluate(()=>VoxStageStage.moreOpen()),true);if(device==='tv'){await page.evaluate(()=>voxstageTvKey('ArrowDown'));assert.equal(await page.evaluate(()=>document.activeElement.closest('#stageMoreMenu')!==null),true);}
   await page.evaluate(()=>voxstageBack());assert.equal(await page.evaluate(()=>VoxStageStage.moreOpen()),false);assert.equal(await page.locator('#display').isVisible(),true);
   await page.locator('#mobileMixToggle').click();assert.equal(await page.locator('.palco-mix').isVisible(),true);await bounds(page,'.palco-mix');await page.evaluate(()=>voxstageBack());assert.equal(await page.locator('.palco-mix').isVisible(),false);
  }else{
   assert.equal(await page.locator('#stageMoreOpen').count(),0);assert.equal(await page.locator('#mobileControlsToggle .palco-control-label').count(),0);assert.equal(await page.locator('#quickExitDisplay .palco-control-label').count(),0);
   await page.locator('#mobileControlsToggle').click();assert.equal(await page.locator('.palco-panel').isVisible(),false);await page.mouse.move(3,3);assert.equal(await page.locator('.palco-panel').isVisible(),false,'Mouse cannot undo manual hide');await page.locator('#mobileControlsToggle').click();assert.equal(await page.locator('.palco-panel').isVisible(),true);
  }
  await page.locator('[data-speed-open]').click();const popup=await bounds(page,'#playbackTransformPopup'),panel=await page.locator('.palco-panel').boundingBox();assert.ok(popup.y+popup.height<=panel.y+1,'Pitch popup above transport');
  await page.locator('#playbackTransformPopup [data-playback-speed]').evaluate(n=>{n.value='0.9';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>playbackSpeed===.9&&document.querySelector('[data-speed-open]').textContent.includes('0.90'));assert.match(await page.locator('[data-speed-open]').textContent(),/0.90/);
  await page.locator('#playbackTransformPopup [data-playback-pitch]').selectOption('-2');await page.waitForFunction(()=>playbackSemitones===-2);await page.locator('#playbackTransformPopup button').click();await page.waitForFunction(()=>playbackSpeed===1&&playbackSemitones===0);await page.evaluate(()=>voxstageBack());
  if(device!=='pc')await page.locator('#stageMoreOpen').click();await page.locator('#lyricSync').click();assert.equal(await page.locator('#manualSyncDialog').isVisible(),true);assert.equal(await page.locator('[data-sync-mode="line"]').isVisible(),true);assert.equal(await page.locator('[data-sync-mode="word"]').isVisible(),true);await page.locator('[data-sync-mode="word"]').click();await page.locator('#closeManualSync').click();assert.equal(await page.evaluate(()=>JSON.stringify(current.lyricVoices)),original,'Cancel keeps all voice timings');
  if(device==='portrait'||device==='landscape')await page.locator('#stageMoreOpen').click();await page.locator('#openLyrics').click();assert.equal(await page.locator('#lyricsDialog').isVisible(),true);await page.evaluate(()=>voxstageBack());assert.equal(await page.locator('#lyricsDialog').isVisible(),false,JSON.stringify(await page.locator('[role=dialog],dialog[open]').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({id:n.id,cls:n.className,z:getComputedStyle(n).zIndex,parent:n.parentElement.id,close:n.querySelector('.x,.lyrics-close,#closeManualSync')?.id})))));
  for(const time of [1.8,6.8]){await page.evaluate(t=>seek(t/60*1000),time);await page.waitForTimeout(100);await page.screenshot({path:path.join(out,device+(time<2?'-duet':'-voices')+'.png')});fs.writeFileSync(path.join(out,device+'-markers.json'),JSON.stringify(await page.locator('.display-content > *').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.id,hidden:n.hidden,rect:[r.x,r.y,r.width,r.height],css:{position:getComputedStyle(n).position,display:getComputedStyle(n).display},text:n.textContent.slice(0,100),before:getComputedStyle(n,'::before').content,active:[...n.querySelectorAll('.active')].map(w=>({text:w.textContent,cls:w.className,before:getComputedStyle(w,'::before').content,after:getComputedStyle(w,'::after').content,rect:w.getBoundingClientRect().toJSON()}))};})),null,2));const main=await bounds(page,'#lyrics');assert.ok(main.height>30,'Lyrics keep useful space');}
  await page.evaluate(()=>{$('scoreOverlay').hidden=false;$('display').classList.add('score-lane-active');});await page.waitForTimeout(150);const lane=await bounds(page,'#scoreOverlay'),main=await bounds(page,'#lyrics');assert.ok(main.y>=lane.y+lane.height-1,'Lyrics below score lane '+JSON.stringify({lane,main}));await page.screenshot({path:path.join(out,device+'-score.png')});
  await page.locator('#scoreOpen').click();assert.equal(await page.locator('#scoreDialog').evaluate(n=>n.open),true);await page.evaluate(()=>voxstageBack());assert.equal(await page.locator('#scoreDialog').evaluate(n=>n.open),false);
  await page.evaluate(()=>{$('scoreOverlay').hidden=true;$('display').classList.remove('score-lane-active');setStageControlsHidden(true);});await bounds(page,'#quickExitDisplay');await page.locator('#quickExitDisplay').click();assert.equal(await page.locator('#display').isVisible(),false);
  await page.evaluate(()=>{$('display').classList.add('show');setStageControlsHidden(false);});await page.evaluate(()=>voxstageBack());assert.equal(await page.locator('#display').isVisible(),false);if(device==='pc'){await page.locator('#settingsTop').click();await page.locator('#settingsTabVisual').click();await page.locator('#lyricsFont').selectOption('nunito');assert.match(await page.locator('#lyrics').evaluate(n=>getComputedStyle(n).fontFamily),/Nunito/);await page.reload();await page.waitForFunction(()=>window.__voxstageStageReady);assert.equal(await page.locator('#lyricsFont').inputValue(),'nunito');}
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+device+': responsive layout, playback, speed/pitch, single Sync, three voices, score lane, More/Mix/Back and visible exit');
 }}finally{await browser.close();server.close();}
}
if(require.main===module)main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
module.exports={main};
