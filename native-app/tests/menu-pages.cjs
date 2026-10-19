const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{server,library,wav}=require('./menu-shell.cjs');
const results=path.resolve(__dirname,'../test-results/menu-pages');fs.mkdirSync(results,{recursive:true});
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{for(const [device,width,height]of [['pc',1440,900],['phone',390,844],['tv',1440,810]].filter(([device])=>!process.argv.includes('--tv')||device==='tv')){
  const context=await browser.newContext({viewport:{width,height},...(device!=='pc'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'}:{})});
  await context.addInitScript(({device,library})=>{
   localStorage.setItem('voxstage-onboarding-hidden','1');window.__nativeCalls=[];
   if(device!=='pc'){
    window.VoxStageMedia={isTelevision:()=>device==='tv',setOrientation:()=>{},update:()=>{},clear:()=>{}};
    window.__TAURI__={core:{convertFileSrc:name=>'/music/'+name.split('/').pop(),invoke:async(command,args)=>{
     window.__nativeCalls.push({command,args});
     if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library')return library;
     if(command==='mobile_mvsep_models')return [];if(command==='mobile_get_mvsep_key'||command==='mobile_mvsep_get_config')return {configured:false};
     if(command==='mobile_youtube_video_download')return {stage:'done',name:'video.mp4',title:'Video',hasAudio:false};
     if(command==='mobile_tv_host_api'){if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];if(args.path.endsWith('commands'))return {commands:[]};return {url:'http://127.0.0.1/remote#12345678901234567890123456789012'};}return {};
    }}};
   }
  },{device,library});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.error(device,e.stack);});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageMenuPagesReady);await page.waitForTimeout(700);
  assert.deepEqual(errors,[],'No startup exceptions');if(device==='tv')await page.evaluate(()=>closeRemotePanel());
  await page.evaluate(()=>{
   const oldApi=api;window.__calls=[];
   api=async function(url,options={}){
    window.__calls.push({url,method:options.method||'GET',body:typeof options.body==='string'?options.body:null});
    if(url.startsWith('/api/files/'))return {};
    if(url==='/api/library'&&options.method==='POST')return {};
    if(url==='/api/youtube/search')return {results:[{title:'New song',artist:'Test artist',url:'https://www.youtube.com/watch?v=abcdefghijk',id:'abcdefghijk'}]};
    if(url==='/api/youtube/download')return {filename:'download.wav'};
    if(url==='/api/youtube/video-downloads')return {id:'test-video'};
    if(url==='/api/youtube/video-downloads/test-video')return {stage:'done',name:'video.mp4',title:'Video',hasAudio:false};
    if(url==='/api/youtube/separations')return {id:'test-separation'};
    if(url==='/api/youtube/separations/test-separation')return {stage:'done',progress:100,files:[{name:'inst.wav',role:'inst'},{name:'lead.wav',role:'lead'}]};
    if(url.startsWith('/api/lyrics'))return {results:[]};
    return oldApi(url,options);
   };
  });
  await page.locator('#settingsTop').click();assert.equal(await page.locator('#processingDialog').evaluate(n=>n.classList.contains('menu-settings-inline')),true);
  const topic=key=>page.locator(device==='phone'?`[data-settings-topic="${key}"]`:`[data-settings-tab="${key}"]`);
  if(device==='phone'){
   assert.equal(await page.locator('#menuSettingsHome').isVisible(),true);assert.equal(await topic('local').count(),0);await page.screenshot({path:path.join(results,'phone-settings-home.png')});
  }
  await topic('playback').click();assert.equal(await page.locator('#settingsPanePlayback').isVisible(),true);
  await page.locator('#seekStepSeconds').selectOption('15');assert.equal(await page.evaluate(()=>processingSettings.seekStepSeconds),15);
  if(device!=='phone'){
   const heading=await page.locator('.menu-settings-pane-heading').boundingBox(),pane=await page.locator('#settingsPanePlayback').boundingBox();assert.ok(pane.y>=heading.y+heading.height,'Settings heading and pane do not overlap');
  }
  await page.screenshot({path:path.join(results,device+'-settings-playback.png')});
  if(device==='phone'){await page.locator('#menuSettingsBack').click();await topic('visual').click();}else await topic('visual').click();
  assert.equal(await page.locator('#voice2Color').isVisible(),true);assert.equal(await page.locator('#voicesOverlapGradient').isVisible(),true);
  if(device==='phone')await page.locator('#menuSettingsBack').click();await topic('language').click();assert.equal(await page.locator('#interfaceLanguage').isVisible(),true);
  if(device==='phone')await page.locator('#menuSettingsBack').click();await topic('data').click();assert.equal(await page.locator('#exportLibrary').isVisible(),true);
  if(device==='phone')await page.locator('#menuSettingsBack').click();await topic('about').click();assert.equal(await page.locator('#settingsPaneAbout').isVisible(),true);
  await page.locator('#saveProcessing').click();await page.waitForFunction(()=>VoxStageMenu.page===null);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('voxstage-processing-settings')).seekStepSeconds),15);
  await page.locator('#addTop').click();assert.equal(await page.locator('#modal').getAttribute('role'),'region');assert.equal(await page.locator('#menuImportSource').isVisible(),true);
  if(device==='tv'){
   await page.waitForFunction(()=>!$('menuTvImportQr').hidden);const phone=await page.locator('[data-import-source="phone"]').boundingBox(),youtube=await page.locator('[data-import-source="youtube"]').boundingBox();
   assert.ok(phone.width>=youtube.width*1.8&&phone.height>=youtube.height*1.8,'Phone import dominates TV sources');
   const before=await page.locator('#menuTvImportQr').evaluate(n=>n.toDataURL());
   await page.locator('[data-import-source="phone"]').click();assert.equal(await page.locator('#remotePanel').isVisible(),true);
   await page.evaluate(()=>{const original=api;api=async(url,options)=>url==='/api/remote/host-info'?{url:'http://192.168.1.8/remote#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}:original(url,options);});
   await page.locator('#remoteQrRefresh').click();await page.waitForFunction(()=>$('remoteUrl').textContent.includes('192.168.1.8'));await page.locator('#remotePanelClose').click();await page.locator('#addTop').click();await page.waitForFunction(before=>$('menuTvImportQr').toDataURL()!==before,before);
  }
  await page.screenshot({path:path.join(results,device+'-add-source.png')});
  await page.locator('[data-import-source="files"]').click();
  await page.locator('#allFiles').setInputFiles({name:'silent-song.wav',mimeType:'audio/wav',buffer:wav});
  assert.equal(await page.locator('#menuImportDetails').isVisible(),true);assert.equal(await page.evaluate(()=>chosenFiles[0].role),'source');
  await page.locator('#titleInput').fill('My imported song');await page.locator('#artistInput').fill('Test artist');
  await page.locator('#menuCoverFile').setInputFiles({name:'cover.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#7b779d"/></svg>')});
  await page.locator('#draftLyricsButton').click();if(await page.locator('#lyricsEntrymanual').isVisible())await page.locator('#lyricsEntrymanual').click();await page.locator('#lyricsPasteInput').fill('[00:01.00]A test phrase\n[00:04.00]Another phrase');await page.locator('#applyPastedLyrics').click();
  await page.waitForFunction(()=>!$('lyricsDialog').classList.contains('show'));assert.ok(await page.evaluate(()=>draftLyrics.syncedLyrics.includes('[00:01.00]')));
  assert.equal(await page.locator('#menuDraftCover img').isVisible(),true);
  for(const [w,h]of device==='pc'?[[850,560],[1440,900]]:device==='phone'?[[360,800],[844,390],[390,844]]:[[1280,720],[1440,810]]){
   await page.setViewportSize({width:w,height:h});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow on '+device+' '+w);
  }
  await page.screenshot({path:path.join(results,device+'-add-details.png'),fullPage:true});
  await page.locator('#menuImportNext').click();assert.equal(await page.locator('#menuImportReview').isVisible(),true);assert.equal(await page.locator('#saveSong').isEnabled(),true);
  await page.locator('#menuReviewLyric').click();assert.match(await page.locator('#lyricsPasteInput').inputValue(),/A test phrase/);await page.locator('#closeLyricsDialog').click();
  await page.locator('#menuLibrary').click();assert.equal(await page.locator('#modal').isVisible(),false);await page.locator('#addTop').click();
  assert.equal(await page.locator('#titleInput').inputValue(),'My imported song');assert.equal(await page.evaluate(()=>chosenFiles.length),2,'Draft attachments survive page navigation');
  await page.locator('#menuImportNext').click();await page.screenshot({path:path.join(results,device+'-add-review.png'),fullPage:true});
  await page.locator('#saveSong').click();await page.waitForFunction(()=>VoxStageMenu.page===null);
  const saved=await page.evaluate(()=>songs.find(s=>s.title==='My imported song'));assert.equal(saved.artist,'Test artist');assert.ok(saved.source);assert.ok(saved.cover);assert.match(saved.syncedLyrics,/A test phrase/);
  await page.evaluate(id=>editSong(id),saved.id);assert.equal(await page.locator('#menuImportDetails').isVisible(),true);
  await page.locator('#draftLyricsButton').click();assert.match(await page.locator('#lyricsPasteInput').inputValue(),/A test phrase/);await page.locator('#closeLyricsDialog').click();await page.locator('#closeModal').click();
  await page.locator('#addTop').click();await page.locator('[data-import-source="youtube"]').click();
  assert.equal(await page.locator('.youtube-video-download').isVisible(),false);assert.equal(await page.locator('#menuAlsoDownloadVideo').isVisible(),true);
  await page.locator('#menuAlsoDownloadVideo').check();await page.locator('#youtubeQuery').fill('New song');await page.locator('#youtubeSearch').click();
  await page.evaluate(()=>{mvsepConfigured=false;});
  if(device==='pc'){
   // The browser uses the configured MVSEP route, while native mobile can download a complete song.
   await page.evaluate(()=>{mvsepConfigured=true;});
  }
  await page.locator('.youtube-result').first().click();await page.locator('#menuLibrary').click();await page.locator('#settingsTop').click();
  await page.waitForFunction(()=>!videoDownloadBusy&&!youtubeProcessing,{},{timeout:20000});assert.equal(await page.evaluate(()=>VoxStageMenu.page),'settings','Background downloads keep their draft without reopening the form');
  await page.locator('#addTop').click();
  assert.equal(await page.locator('#menuImportDetails').isVisible(),true);assert.ok(await page.evaluate(()=>chosenFiles.some(f=>f.role==='video')),'Video is attached to the same draft');
  if(device!=='pc')assert.ok(await page.evaluate(()=>chosenFiles.some(f=>f.role==='source')));
  const calls=await page.evaluate(()=>window.__calls);assert.equal(calls.filter(c=>c.url==='/api/youtube/search').length,1);
  const videoCalls=await page.evaluate(()=>window.__nativeCalls.filter(c=>c.command==='mobile_youtube_video_download'));
  assert.equal(device==='pc'?calls.filter(c=>c.url==='/api/youtube/video-downloads').length:videoCalls.length,1,'One optional video request');
  await page.locator('#closeModal').click();await page.locator('#addTop').click();assert.equal(await page.locator('#menuAlsoDownloadVideo').isChecked(),true);
  if(device==='tv'){await page.keyboard.press('Escape');assert.equal(await page.locator('#menuImportSource').isVisible(),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>VoxStageMenu.page===null);}
  assert.deepEqual(errors,[]);console.log('PASS '+device+': guided import, artwork/lyrics, drafts, save/edit, optional video and settings navigation');await context.close();
 }}finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
