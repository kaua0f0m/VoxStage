const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright'),{server,library}=require('./menu-shell.cjs');
const out=path.resolve(__dirname,'../test-results/popup-shell');fs.mkdirSync(out,{recursive:true});
async function checkPopup(page,selector){
 const box=await page.locator(selector).boundingBox(),vp=page.viewportSize();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=vp.width+1&&box.y+box.height<=vp.height+1,selector+' fits viewport');
 assert.ok(await page.locator(selector).evaluate(n=>n.scrollHeight<=n.clientHeight+1),selector+' has no outer scroll');
 const body=page.locator(selector+' > .vox-popup-body');assert.ok(await body.evaluate(n=>n.clientHeight)>50,'Room for dialog content');
 const before=await page.locator(selector+' > .vox-popup-head').boundingBox();await body.evaluate(n=>n.scrollTop=n.scrollHeight);const after=await page.locator(selector+' > .vox-popup-head').boundingBox();assert.equal(after.y,before.y,'Header stays visible');await body.evaluate(n=>n.scrollTop=0);
}
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{for(const [device,width,height]of[['pc',1440,900],['portrait',390,844],['landscape',844,390],['tv',1280,720]]){
 const context=await browser.newContext({viewport:{width,height},...(device!=='pc'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});
 await context.addInitScript(({device,library})=>{
  localStorage.setItem('voxstage-onboarding-hidden','1');
  if(device!=='pc'){window.VoxStageMedia={isTelevision:()=>device==='tv',setOrientation:()=>{},update:()=>{},clear:()=>{}};window.__TAURI__={core:{convertFileSrc:n=>'/music/'+n.split('/').pop(),invoke:async(c,a)=>{if(c==='mobile_get_music_dir')return '/music';if(c==='mobile_get_library')return library;if(c==='mobile_mvsep_models')return [];if(c==='mobile_get_mvsep_key'||c==='mobile_mvsep_get_config')return {configured:false};if(c==='mobile_tv_host_api'){if(a.path.endsWith('requests')||a.path.endsWith('transfers'))return [];if(a.path.endsWith('commands'))return {commands:[]};return {url:'http://192.168.1.5/remote#12345678901234567890123456789012'};}return {};}}};}
 },{device,library});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
 await page.route('**/lrclib.net/**',route=>route.fulfill({json:Array.from({length:8},(_,i)=>({id:i,trackName:'Test song '+i,artistName:'Test artist',syncedLyrics:'[00:01.00]A test lyric',plainLyrics:'A test lyric',duration:60}))}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageMenuPagesReady);await page.waitForTimeout(700);if(device==='tv')await page.evaluate(()=>closeRemotePanel());
 await page.evaluate(()=>{const previous=api;api=async(url,opts)=>url==='/api/covers/search'?{results:Array.from({length:18},(_,i)=>({title:i===0?'An unusually long album title that must wrap and stay inside the card':'Album '+i,artist:'Test artist',track:'Song',provider:'iTunes',previewUrl:'/music/cover'+i%8+'.svg',imageUrl:'https://example.test/cover'+i+'.jpg'}))}:url==='/api/covers/download'?{name:'chosen-cover.svg'}:previous(url,opts);});
 await page.locator('#addTop').click();await page.locator('#menuImportStep1').click();await page.locator('#titleInput').fill('Test song');await page.locator('#artworkSearchOpen').click();await page.waitForFunction(()=>$('artworkResults').children.length===18);
 await checkPopup(page,'.artwork-card');assert.equal(await page.locator('#artworkResults').evaluate(n=>n.scrollHeight<=n.clientHeight+1),true,'One scroll instead of nested result scroll');
 await page.screenshot({path:path.join(out,device+'-artwork.png')});
 await page.locator('[data-art-role="both"]').first().click();await page.waitForFunction(()=>!$('artworkDialog').classList.contains('show'));assert.equal(await page.evaluate(()=>chosenFiles.filter(f=>['cover','background'].includes(f.role)).length),2,'Both artwork roles still attach');
 await page.locator('#draftLyricsButton').click();await page.waitForFunction(()=>$('lyricsResults').querySelectorAll('.lyrics-result').length===8);await checkPopup(page,'.lyrics-dialog-card');await page.screenshot({path:path.join(out,device+'-lyrics.png')});
 if(await page.locator('#lyricsEntrymanual').isVisible())await page.locator('#lyricsEntrymanual').click();
 await page.locator('#lyricsPasteInput').fill('First phrase\nSecond phrase');await page.locator('#applyPastedLyrics').click();await page.waitForFunction(()=>!$('lyricsDialog').classList.contains('show'));assert.equal(await page.evaluate(()=>draftLyrics.plainLyrics),'First phrase\nSecond phrase');await page.locator('#closeModal').click();
 await page.evaluate(async id=>{await playSong(id);pausePlayback();$('display').classList.add('show');},library[0].id);
 await page.locator('#scoreOpen').click();await checkPopup(page,'#scoreDialog');assert.equal(await page.locator('.score-popup-group').count(),3);
 await page.locator('#scoreReference').selectOption('Back');await page.locator('#scoreNoise').fill('-60');await page.locator('#scoreNoise').dispatchEvent('input');assert.match(await page.locator('#scoreNoiseValue').textContent(),/60/);
 await page.screenshot({path:path.join(out,device+'-score.png')});await page.locator('#scoreClose').click();assert.equal(await page.locator('#scoreDialog').evaluate(n=>n.open),false);
 await page.locator('[data-speed-open]').click();const popup=await page.locator('#playbackTransformPopup').boundingBox();assert.ok(popup.width<=270.1&&popup.x>=0&&popup.y>=0,'Speed and pitch stay compact and anchored');await page.screenshot({path:path.join(out,device+'-speed.png')});
 assert.deepEqual(errors,[]);console.log('PASS '+device+': popup bounds, single scroll, artwork roles, lyric paste, scoring controls and compact speed/pitch');await context.close();
 }}finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
