const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');
const titles=['No Eulogies','Machine Love','Little Anger','Square Up','Rap do Ovo','Bittersweet','BIRDBRAIN','Liaison'];
const library=titles.map((title,i)=>({id:`${String(i+1).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,title,artist:i===4?'Faustão':'Jamie Paige',inst:'silent.wav',lead:'silent.wav',back:'silent.wav',cover:`cover${i}.svg`,favorite:i%2===0,...(i%2===0?{syncedLyrics:'[00:01.00]A silent test phrase',plainLyrics:'A silent test phrase'}:{plainLyrics:'A silent test phrase'})}));
const wav=Buffer.alloc(44+48000*2*60);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname==='/api/library'?library:u.pathname==='/api/remote/requests'||u.pathname==='/api/remote/transfers'?[]:u.pathname==='/api/remote/host-info'?{url:'http://192.168.1.8:8000/remote#12345678901234567890123456789012'}:{}));return;}
 if(u.pathname.endsWith('.wav')){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 if(u.pathname.startsWith('/music/cover')){const i=Number(u.pathname.match(/cover(\d)/)[1]),colors=['#aa66b0','#72a99c','#e4a865','#8d8acb','#c9c668','#bd758e','#728db7','#bba1a0'];res.setHeader('Content-Type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${colors[i]}"/><circle cx="250" cy="150" r="180" fill="#191b30" opacity=".4"/><path d="m-60 400 260-300 260 300Z" fill="#182132" opacity=".7"/><circle cx="110" cy="100" r="42" fill="#ffffcc" opacity=".7"/></svg>`);return;}
 const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.ttf')?'font/ttf':'text/html'});res.end(err?'Not found':data);});
});
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});const errors=[];
 try{
 for(const [device,width,height]of[['pc',1440,900],['phone',390,844],['tv',1440,810]]){
 const context=await browser.newContext({viewport:{width,height},...(device!=='pc'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'}:{})});
 await context.addInitScript(({device,library})=>{
 localStorage.setItem('voxstage-onboarding-hidden','1');
 if(device!=='pc'){
 window.VoxStageMedia={isTelevision:()=>device==='tv',setOrientation:()=>{},update:()=>{},clear:()=>{}};
 window.__TAURI__={core:{convertFileSrc:name=>'/music/'+name.split('/').pop(),invoke:async(command,args)=>{
 if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library')return library;
 if(command==='mobile_mvsep_models')return [];if(command==='mobile_get_mvsep_key'||command==='mobile_mvsep_get_config')return {configured:false};
 if(command==='mobile_tv_host_api'){if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];if(args.path.endsWith('commands'))return {commands:[]};return {url:'http://127.0.0.1/remote#12345678901234567890123456789012'};}return {};
 }}};
 }
 },{device,library});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(device+': '+e.stack));await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.__voxstageMenuReady);await page.waitForFunction(()=>document.getElementById('grid').children.length===8);await page.waitForTimeout(500);
 assert.equal(await page.locator('body').getAttribute('data-menu-device'),device);
 assert.equal(await page.locator('#menuUploads').isVisible(),false,'No phantom upload activity');
 if(device==='tv')await page.evaluate(()=>closeRemotePanel());
 if(device==='phone'){assert.deepEqual(await page.locator('#menuNavigation').evaluate(n=>[...n.children].map(c=>c.id)),['menuLibrary','menuQueue','addTop','syncPcLibrary','settingsTop']);assert.equal(await page.locator('.menu-lyric-filters #menuFavorites').count(),1);assert.equal(await page.locator('.menu-lyric-filters #showHiddenSongs').count(),1);assert.equal(await page.locator('#addTop').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(212, 251, 105)');assert.notEqual(await page.locator('#addTop').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');}
 if(device==='pc'){const rail=await page.locator('#menuQueuePanel').boundingBox(),player=await page.locator('.player').boundingBox();assert.ok(rail.y+rail.height<=player.y,'Queue footer cannot sit behind the fixed player');}
 await page.screenshot({path:path.join(artifacts,'menu2-'+device+'.png')});
 if(device==='pc'){
  assert.deepEqual(await page.locator('#menuNavigation').evaluate(n=>[...n.children].map(c=>c.id)),['menuLibrary','menuFavorites','remoteOpen','addTop']);
  assert.equal(await page.locator('#menuQueue').count(),0);
  assert.ok(await page.locator('#remoteOpen svg').evaluate(n=>n.getBoundingClientRect().height)>=25);assert.ok(await page.locator('#remoteOpen').evaluate(n=>n.getBoundingClientRect().width)>=150);assert.equal(await page.locator('#remoteOpen span').evaluate(n=>{const r=n.getBoundingClientRect();return n.parentElement.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'The label is inside the clickable destination');
  await page.locator('#remoteOpen').click();await page.waitForFunction(()=>document.getElementById('remoteUrl').textContent.startsWith('http'));
  assert.equal(await page.locator('#menuConnectionPage').isVisible(),true);assert.equal(await page.locator('.menu-content-layout').isVisible(),false);
  assert.equal(await page.locator('#remotePanel').evaluate(n=>getComputedStyle(n).position),'static');assert.equal(await page.locator('.remote-card').getAttribute('role'),'region');assert.equal(await page.locator('.remote-card').getAttribute('aria-modal'),null);
  await page.evaluate(()=>render());assert.equal(await page.locator('#remoteOpen').getAttribute('aria-current'),'page');assert.notEqual(await page.locator('#menuLibrary').getAttribute('aria-current'),'page');
  await page.screenshot({path:path.join(artifacts,'menu2-pc-connect.png')});
  await page.setViewportSize({width:850,height:560});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width,height});
  await page.locator('#menuLibrary').click();assert.equal(await page.locator('#menuConnectionPage').isVisible(),false);assert.equal(await page.locator('.menu-content-layout').isVisible(),true);assert.equal(await page.locator('#remotePanel').isVisible(),false);
  await page.locator('#remoteOpen').click();await page.evaluate(()=>{$('display').classList.add('show');VoxStageScoreHost.connectPhone();});
  assert.equal(await page.locator('#remotePanel').evaluate(n=>getComputedStyle(n).position),'static');assert.equal(await page.locator('.remote-card').getAttribute('aria-modal'),null);assert.equal(await page.locator('#display').isVisible(),false);
  await page.locator('#menuLibrary').click();await page.evaluate(()=>$('display').classList.remove('show'));
 }

 const sizes=device==='pc'?[[850,560],[1280,820],[1920,1080]]:device==='phone'?[[360,800],[844,390],[390,844]]:[[1280,720],[1920,1080]];
 for(const [w,h]of sizes){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(60);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),device+' has no horizontal overflow at '+w);await page.locator('[data-menu-toggle]').first().click();const menu=await page.locator('.track-menu:not([hidden])').boundingBox();assert.ok(menu.x>=0&&menu.y>=0&&menu.x+menu.width<=w+1&&menu.y+menu.height<=h+1,'Options fit at '+device+' '+w+'x'+h);await page.locator('#search').click();}
 await page.setViewportSize({width,height});
 await page.locator('#search').fill('Little');assert.equal(await page.locator('#grid .track').count(),1);await page.locator('#search').fill('');
 await page.locator('#menuFilter-ready').click();assert.equal(await page.locator('#grid .track').count(),4);await page.locator('#menuFilter-missing').click();assert.equal(await page.locator('#grid .track').count(),4);await page.locator('#menuFilter-all').click();
 await page.locator('#menuFavorites').click();assert.equal(await page.locator('#grid .track').count(),4);if(device==='phone')assert.equal(await page.locator('#menuFavorites').getAttribute('aria-pressed'),'true');await page.locator('#menuLibrary').click();assert.equal(await page.locator('#grid .track').count(),8);
 for(const item of [library[0],library[1],library[5],library[3]]){
 await page.locator(`[data-menu-toggle="${item.id}"]`).click();const itemButton=page.locator(`[data-add-queue="${item.id}"]`);const r=await itemButton.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width+1&&r.y>=0&&r.y+r.height<=height,'Song options fit on '+device);await itemButton.click();}
 await page.evaluate(()=>{remoteSongQueue.splice(0,2);window.dispatchEvent(new Event('voxstage-queue-changed'));});
 assert.deepEqual(await page.evaluate(()=>remoteSongQueue),[library[5].id,library[3].id]);
 if(device!=='pc')await page.locator('#menuQueue').click();
 await page.locator(`[data-queue-up="${library[3].id}"]`).click();assert.deepEqual(await page.evaluate(()=>remoteSongQueue),[library[3].id,library[5].id]);
 await page.locator(`[data-queue-remove="${library[3].id}"]`).click();assert.deepEqual(await page.evaluate(()=>remoteSongQueue),[library[5].id]);
 await page.locator('#menuClearQueue').click();assert.match(await page.locator('#menuQueueLabel').textContent(),/biblioteca/);assert.equal(await page.locator('#menuQueueItems [data-queue-play]').count(),8);
 if(device!=='pc'){if(device==='tv'){await page.keyboard.press('Escape');assert.equal(await page.locator('#menuQueueDialog').evaluate(n=>n.open),false);}else await page.locator('#menuQueueClose').click();}
 await page.evaluate(id=>addToPlaybackQueue(id),library[1].id);await page.locator('#playBtn').click();await page.waitForFunction(id=>current?.id===id&&current.buffers?.Inst,library[1].id);await page.evaluate(()=>pausePlayback());
 assert.deepEqual(await page.evaluate(()=>followingLibrarySongs().map(s=>s.id)),library.slice(2).map(s=>s.id));
 if(device==='pc'){
  for(const count of [6,7,30]){
   await page.evaluate(count=>{window.__menuBaseSongs??=songs;songs=[...window.__menuBaseSongs.slice(0,2),...Array.from({length:count},(_,i)=>({...window.__menuBaseSongs[i%8],id:'queue-test-'+i}))];render();},count);
   for(const [w,h]of [[1440,900],[850,560]]){
    await page.setViewportSize({width:w,height:h});await page.waitForTimeout(80);
    const before=await page.locator('#menuQueuePanel>header').boundingBox();
    const scroll=await page.locator('#menuQueueItems').evaluate(n=>{n.scrollTop=n.scrollHeight;return {top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight};});assert.ok(scroll.height>0,'Queue keeps space for songs');assert.ok(scroll.top>0,'Long queue scrolls');
    assert.ok(await page.locator('#menuQueuePanel').evaluate(n=>n.scrollHeight<=n.clientHeight+1),'Only the list scrolls: no outer overflow');
    const after=await page.locator('#menuQueuePanel>header').boundingBox();assert.ok(Math.abs(after.y-before.y)<1,'Queue heading remains fixed');
   }
  }
  await page.setViewportSize({width,height});await page.evaluate(()=>{songs=window.__menuBaseSongs;render();});
  await page.screenshot({path:path.join(artifacts,'menu2-pc-queue-scroll.png')});
 }

 await page.evaluate(id=>addToPlaybackQueue(id),library[6].id);await page.evaluate(()=>navigateSong(1));await page.waitForFunction(id=>current?.id===id&&current.buffers?.Inst,library[6].id);await page.evaluate(()=>pausePlayback());
 assert.deepEqual(await page.evaluate(()=>remoteSongQueue),[]);
 await page.evaluate(()=>finishPlayback());await page.waitForFunction(id=>current?.id===id&&current.buffers?.Inst,library[7].id);await page.evaluate(()=>pausePlayback());assert.deepEqual(await page.evaluate(()=>followingLibrarySongs()),[],'No automatic wrapping');
 if(device==='tv')await page.evaluate(()=>document.getElementById('display').classList.remove('show'));
 await page.evaluate(()=>stopSong());
 await page.locator('#sortBtn').click();assert.deepEqual(await page.evaluate(()=>followingLibrarySongs().map(s=>s.id)),[...library].reverse().map(s=>s.id));await page.locator('#sortBtn').click();
 await page.locator('#settingsTop').click();assert.equal(await page.locator('#processingDialog').isVisible(),true);await page.locator('#closeProcessing').click();
 await page.locator('#openUsageGuide').click();assert.equal(await page.locator('#usageGuide').evaluate(n=>n.open),true);await page.locator('#closeUsageGuide').click();
 await page.locator('#addTop').click();assert.equal(await page.locator('#modal').isVisible(),true);await page.locator('#closeModal').click();
 assert.equal(await page.locator('#usageGuide-queue').count(),1);
 // Long imported names and empty libraries cannot break the shell.
 await page.evaluate(()=>{songs[0].title='Long title '.repeat(60);render();});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.evaluate(()=>{songs=[];render();});assert.equal(await page.locator('#grid .empty').isVisible(),true);assert.equal(await page.locator('#menuQueueItems [data-queue-play]').count(),0);
 console.log('PASS '+device+': layout, narrow/wide bounds, filters, options, queue/reorder/remove, priority/automatic next, sort, settings, guide, import and empty state');
 await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS menu initial layouts');
 }finally{await browser.close();server.close();}
}
module.exports={server,library,wav};
if(require.main===module)main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
