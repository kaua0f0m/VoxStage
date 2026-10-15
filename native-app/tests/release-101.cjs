const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
const artifacts = path.resolve(root, 'native-app/test-results');
fs.mkdirSync(artifacts,{recursive:true});
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const source = `${id}.wav`;
const complete = {id, title:'Faixa completa', artist:'Artista', source, separationStatus:'pending', plainLyrics:'Uma letra', favorite:true, wordTimings:[[100,200]]};
const stems = {id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title:'Stems', inst:'inst.wav', lead:'lead.wav', back:'back.wav', plainLyrics:'Uma letra'};
const wav = Buffer.alloc(44 + 48000 * 2 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(48000,24); wav.writeUInt32LE(96000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
let library = [complete,stems];
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')) {
    if(url.pathname.startsWith('/api/remote/') && req.headers.authorization!=='Bearer 12345678901234567890123456789012') { res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Sessão remota expirada'}));return; }
    const data = url.pathname === '/api/library' ? library : url.pathname === '/api/mvsep/config' ? {configured:true} : url.pathname === '/api/mvsep/models' ? {models:[{id:12,name:'Karaoke',fields:[]}]} : url.pathname === '/api/covers/search' ? {results:[{title:'Capa escolhida',artist:'Artista',previewUrl:'/cover.svg',imageUrl:'https://example.test/cover.jpg'}]} : url.pathname === '/api/covers/download' ? {name:'cover.jpg'} : url.pathname === '/api/remote/state' ? {hostType:'tv',playing:false} : url.pathname === '/api/remote/library' ? [] : {};
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)); return;
  }
  if(url.pathname.startsWith('/music/')) { res.writeHead(200,{'Content-Type':'audio/wav'}); res.end(wav); return; }
  if(url.pathname === '/cover.svg') { res.writeHead(200,{'Content-Type':'image/svg+xml'}); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#d4fb69"/></svg>'); return; }
  const filename = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if(!filename.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(filename,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':filename.endsWith('.json')?'application/json':filename.endsWith('.ttf')?'font/ttf':'text/html'});res.end(error?'Not found':data)});
});
async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,channel:'msedge',args:['--mute-audio']});
  const errors = [];
  try {
    const desktop = await browser.newContext({viewport:{width:1280,height:820}});
    await desktop.addInitScript(()=>localStorage.setItem('voxstage-onboarding-hidden','1'));
    const page = await desktop.newPage(); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin); await page.waitForFunction(()=>window.__voxstageUiReady);
    await page.evaluate(()=>settingsDialog.classList.add('show'));
    await page.locator('[data-settings-tab="about"]').click();
    await page.waitForFunction(()=>document.getElementById('aboutAppVersion').textContent===window.VoxStageBuildInfo.label);
    assert.equal(await page.locator('#settingsTabAbout').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('.about-app a').nth(0).getAttribute('href'),'https://github.com/kaua0f0m');
    assert.equal(await page.locator('.about-app a').nth(1).getAttribute('href'),'https://www.youtube.com/@funkyblackcat');
    assert.equal(await page.locator('.about-credits').evaluate(node=>node.open),false,'Credits stay collapsed');
    await page.waitForFunction(()=>document.querySelector('.about-app img').naturalWidth>0);
    await page.route('**/build-info.json',route=>route.fulfill({json:{label:'1.1 snapshot 999'}}));
    await page.evaluate(()=>refreshAboutVersion());
    assert.equal(await page.locator('#aboutAppVersion').textContent(),'1.1 snapshot 999','About reads fresh deployment metadata');
    await page.unroute('**/build-info.json');
    await page.evaluate(()=>refreshAboutVersion());
    assert.equal(await page.locator('#aboutAppVersion').textContent(),await page.evaluate(()=>VoxStageBuildInfo.label));
    await page.screenshot({path:path.join(artifacts,'about-desktop.png')});
    await page.locator('[data-settings-tab="playback"]').click();
    const playbackText=await page.locator('#settingsPanePlayback').textContent();
    fs.writeFileSync(path.join(artifacts,'rc-playback-text.txt'),playbackText);
    assert.doesNotMatch(playbackText,/2\.0|Em preparação|Indisponível|Windows.*experimental/i);
    assert.equal(await page.locator('#settingsPanePlayback #scoreOpenSettings').count(),0);
    assert.equal(await page.locator('#settingsPanePlayback .playback-transform').count(),0);
    assert.equal(await page.locator('#settingsTabDebug').isVisible(),await page.evaluate(()=>isDiagnosticBuild(VoxStageBuildInfo)));
    await page.evaluate(()=>updateDebugAvailability({version:'1.1.0-rc.3',label:'1.1 RC-3'}));
    await page.locator('[data-settings-tab="debug"]').click();
    assert.equal(await page.locator('#settingsPaneDebug #scoreOpenSettings').isVisible(),true);
    assert.equal(await page.locator('#settingsPaneDebug .playback-transform').isVisible(),true);
    await page.evaluate(()=>updateDebugAvailability({version:'1.1.0',label:'1.1.0'}));
    assert.equal(await page.locator('#settingsTabDebug').isVisible(),false);
    assert.equal(await page.locator('#settingsTabPlayback').getAttribute('aria-selected'),'true');
    await page.evaluate(()=>selectSettingsTab('debug'));
    assert.equal(await page.locator('#settingsTabPlayback').getAttribute('aria-selected'),'true','Stable cannot select Debug');
    for(const info of [{version:'1.1.0-snapshot.6'},{label:'1.1 snapshot 6'},{version:'1.1.0-rc.2'},{version:'1.1.0-test.1'}]) {
      await page.evaluate(info=>updateDebugAvailability(info),info);
      assert.equal(await page.locator('#settingsTabDebug').isVisible(),true);
    }
    await page.evaluate(()=>{nativeDebugBuild=true;updateDebugAvailability({version:'1.1.0',label:'1.1.0'});});
    assert.equal(await page.locator('#settingsTabDebug').isVisible(),true,'Native debug builds show Debug even with stable metadata');
    await page.evaluate(()=>{nativeDebugBuild=false;updateDebugAvailability();selectSettingsTab('about');window.__TAURI__={core:{invoke:async()=>false}};});
    const openedLinks=[];
    await page.route('**/api/about/open-link',route=>{openedLinks.push(route.request().postDataJSON().url);return route.fulfill({json:{opened:true}});});
    let popups=0;page.on('popup',()=>popups++);
    for(const link of ['https://github.com/kaua0f0m','https://www.youtube.com/@funkyblackcat']) {
      const response=page.waitForResponse(response=>response.url().endsWith('/api/about/open-link'));
      await page.locator(`.about-app a[href="${link}"]`).click();
      await response;
    }
    assert.deepEqual(openedLinks,['https://github.com/kaua0f0m','https://www.youtube.com/@funkyblackcat']);
    assert.equal(popups,0,'Native About links dispatch to OS instead of WebView popups');
    await page.evaluate(()=>delete window.__TAURI__);
    await page.evaluate(()=>{
      const stars=document.createElement('div');stars.id='starColorTest';stars.className='score-stars';
      stars.innerHTML='<span class="earned">★</span>';document.body.append(stars);
    });
    assert.equal(await page.locator('#starColorTest .earned').evaluate(node=>getComputedStyle(node).color),'rgb(255, 255, 255)');
    await page.locator('#starColorTest').evaluate(node=>node.classList.add('gold'));
    assert.equal(await page.locator('#starColorTest .earned').evaluate(node=>getComputedStyle(node).color),'rgb(255, 206, 86)');
    await page.locator('#starColorTest').evaluate(node=>node.remove());
    await page.evaluate(()=>settingsDialog.classList.remove('show'));
    assert.equal(await page.locator('.settings-tabs').evaluate(node=>getComputedStyle(node).flexDirection),'column');
    assert.equal(await page.locator('[data-settings-tab="local"]').getAttribute('hidden'),null);
    assert.doesNotMatch(await page.locator('#modal').textContent(),/próxima etapa|disponíveis em breve/);
    await page.locator(`[data-play="${id}"]`).click();
    await page.waitForFunction(()=>current?.buffers?.Inst);
    assert.equal(await page.locator('#volLead').isVisible(),false);
    assert.equal(await page.locator('#volBack').isVisible(),false);
    assert.match(await page.locator('#volInst').locator('..').textContent(),/Volume/);
    await page.evaluate(()=>{display.classList.add('show'); pausePlayback();});
    assert.equal(await page.locator('#mobileControlsToggle').isVisible(),true);
    assert.equal(await page.locator('#quickExitDisplay').isVisible(),true);
    await page.mouse.move(600,300); await page.waitForTimeout(5300);
    assert.equal(await page.evaluate(()=>display.classList.contains('mobile-controls-hidden')),true);
    await page.mouse.move(601,301);
    assert.equal(await page.evaluate(()=>display.classList.contains('mobile-controls-hidden')),false);
    await page.locator('#dispPlay').hover(); await page.waitForTimeout(5300);
    assert.equal(await page.evaluate(()=>display.classList.contains('mobile-controls-hidden')),false);
    await page.screenshot({path:path.join(artifacts,'desktop-controls.png')});
    await page.locator('#mobileControlsToggle').click();
    assert.equal(await page.locator('.display-bottom').isVisible(),false);
    assert.equal(await page.locator('#quickExitDisplay').isVisible(),true);
    await page.locator('#mobileControlsToggle').click();
    await page.evaluate(async()=>{await document.documentElement.requestFullscreen();openProfanityPickerForCurrent();});
    assert.equal(await page.evaluate(()=>profanityPicker.parentElement===document.fullscreenElement),true);
    assert.equal(await page.locator('.profanity-pick-word').first().evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
    await page.locator('#closeProfanityPicker').click();
    await page.evaluate(()=>document.exitFullscreen());
    await page.evaluate(()=>display.classList.remove('show'));
    await page.locator(`[data-play="${stems.id}"]`).click();
    await page.waitForFunction(()=>current?.buffers?.Lead);
    assert.equal(await page.locator('#volLead').isVisible(),true);
    await page.evaluate(()=>pausePlayback());
    await page.locator('#addTop').click();
    let automaticMetadataRequests=0;
    await page.route('**/api/youtube/metadata',route=>{automaticMetadataRequests++;return route.fulfill({json:{}});});
    await page.route('**/api/youtube/search',route=>route.fulfill({json:{results:[
      {url:'https://music.youtube.com/watch?v=abcdefghijk',title:'Será',artist:'Legião Urbana',album:'Legião Urbana'},
      {url:'https://music.youtube.com/watch?v=abcdefghijL',title:'Faixa sem álbum',artist:'Artista'}
    ]}}));
    await page.locator('#youtubeQuery').fill('Será - Legião Urbana');
    await page.evaluate(()=>searchYoutube());
    assert.equal(await page.locator('.youtube-result').count(),2);
    assert.match(await page.locator('.youtube-result').first().textContent(),/Legião Urbana/);
    assert.equal(automaticMetadataRequests,0,'Searching must not open every video to fill missing albums');
    assert.doesNotMatch(await page.locator('#youtubeResults').textContent(),/Buscando álbum|não encontrado/i);
    await page.unroute('**/api/youtube/search');
    await page.unroute('**/api/youtube/metadata');
    let metadataRequests=0;
    await page.route('**/api/youtube/metadata',route=>{
      metadataRequests++;
      return route.fulfill({status:metadataRequests===1?503:200,contentType:'application/json',body:JSON.stringify(metadataRequests===1?{error:'O YouTube bloqueou temporariamente as consultas.'}:{title:'Machine Love',artist:'Jamie Paige',album:'DAEMON/DOLL',duration:217})});
    });
    const metadataChecks=await page.evaluate(async()=>{
      const item={url:'https://music.youtube.com/watch?v=NKSqoIGYzGY',title:'Machine Love',metadataState:'pending',artistLabel:document.createElement('small'),albumLabel:document.createElement('small')};
      document.body.append(item.artistLabel,item.albumLabel);
      renderYoutubeMetadata(item);
      const pending=item.artistLabel.textContent;
      await ensureYoutubeMetadata(item).catch(()=>{});
      const failed=item.artistLabel.textContent;
      const retryAllowed=item.metadataPromise===null;
      await ensureYoutubeMetadata(item);
      const retried=item.artistLabel.textContent;
      const cached=await ensureYoutubeMetadata({url:item.url});
      await ensureYoutubeMetadata({url:'complete-catalog',artist:'Known artist',album:'Known album'});
      await enrichYoutubeMetadata([{url:'stale-search'}],youtubeSearchSequence-1);
      item.artistLabel.remove();item.albumLabel.remove();
      return {pending,failed,retryAllowed,retried,cached:cached.album};
    });
    assert.equal(metadataChecks.pending,'Buscando artista…');
    assert.equal(metadataChecks.failed,'Não foi possível consultar o artista');
    assert.equal(metadataChecks.retryAllowed,true);
    assert.equal(metadataChecks.retried,'Jamie Paige');
    assert.equal(metadataChecks.cached,'DAEMON/DOLL');
    assert.equal(metadataRequests,2,'Catalog results, cache and stale searches must not open more videos');
    await page.unroute('**/api/youtube/metadata');
    let blockedRequests=0;
    await page.route('**/api/youtube/metadata',route=>{
      blockedRequests++;
      return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'O YouTube bloqueou temporariamente as consultas.'})});
    });
    const blockedChecks=await page.evaluate(async()=>{
      const items=Array.from({length:4},(_,index)=>({url:`blocked-${index}`}));
      await enrichYoutubeMetadata(items,youtubeSearchSequence);
      return items.every(item=>item.metadataState==='error'&&item.metadataError.includes('bloqueou temporariamente'));
    });
    assert.equal(blockedChecks,true);
    assert.equal(blockedRequests,1,'A bot block must stop further automatic video queries');
    await page.unroute('**/api/youtube/metadata');
    await page.locator('#titleInput').fill('Capa');
    let coverRequests=0, coverMode='recover';
    const coverResult={title:'Capa recuperada',artist:'Artista',previewUrl:'/cover.svg',imageUrl:'https://example.test/cover.jpg'};
    await page.route('**/api/covers/search',async route=>{
      coverRequests++;
      if(coverMode==='recover'&&coverRequests===1||coverMode==='offline')return route.abort('connectionreset');
      if(coverMode==='unavailable')return route.fulfill({status:503,json:{error:'Serviço temporariamente indisponível. Aguarde 2 segundos.',retryAfter:2}});
      if(coverMode==='slow')await new Promise(resolve=>setTimeout(resolve,500));
      return route.fulfill({json:{results:[coverResult]}});
    });
    await page.locator('#artworkSearchOpen').click();
    await page.locator('.artwork-result').waitFor();
    assert.equal(coverRequests,2,'One lost local connection recovers automatically once');
    await page.locator('#artworkClose').click();
    coverMode='offline';coverRequests=0;
    await page.locator('#artworkSearchOpen').click();
    await page.waitForFunction(()=>document.getElementById('artworkStatus').textContent.includes('Tente novamente em alguns instantes.'));
    assert.equal(coverRequests,2,'A persistent fetch failure stops after the single recovery attempt');
    assert.doesNotMatch(await page.locator('#artworkStatus').textContent(),/Failed to fetch/);
    await page.locator('#artworkClose').click();
    coverMode='unavailable';coverRequests=0;
    await page.locator('#artworkSearchOpen').click();
    await page.waitForFunction(()=>document.getElementById('artworkSearch').textContent.includes('Aguarde'));
    assert.equal(await page.locator('#artworkSearch').isDisabled(),true);
    await page.locator('#artworkQuery').press('Enter');
    assert.equal(coverRequests,1,'503 is not retried during the provider wait');
    await page.waitForFunction(()=>!document.getElementById('artworkSearch').disabled);
    coverMode='slow';coverRequests=0;
    await page.evaluate(()=>{searchArtwork();searchArtwork();searchArtwork();});
    await page.locator('.artwork-result').waitFor();
    assert.equal(coverRequests,1,'Repeated clicks share the current cover search');
    await page.locator('#artworkClose').click();
    const staleCovers=await page.evaluate(async()=>{
      const original=api, pending={};
      api=(path,options)=>path==='/api/covers/search'?new Promise(resolve=>{pending[JSON.parse(options.body).query]=resolve;}):original(path,options);
      try {
        artworkDialog.classList.add('show');$('artworkQuery').value='older';const older=searchArtwork();
        $('artworkQuery').value='latest';const latest=searchArtwork();
        pending.latest({results:[{title:'Latest result',artist:'Artist',previewUrl:'/cover.svg',imageUrl:'https://example.test/cover.jpg'}]});await latest;
        pending.older({results:[{title:'Old result',artist:'Artist',previewUrl:'/cover.svg',imageUrl:'https://example.test/cover.jpg'}]});await older;
        return $('artworkResults').textContent;
      }finally{api=original;closeArtworkDialog();}
    });
    assert.match(staleCovers,/Latest result/);assert.doesNotMatch(staleCovers,/Old result/);
    await page.unroute('**/api/covers/search');
    await page.locator('#artworkSearchOpen').click();
    await page.locator('[data-art-role="both"]').click();
    assert.equal(await page.locator('.artwork-dialog').isVisible(),false);
    await page.waitForFunction(()=>chosenFiles.some(file=>file.role==='cover') && chosenFiles.some(file=>file.role==='background'));
    await page.evaluate(()=>{
      $('titleInput').value=''; $('artistInput').value=''; $('youtubeQuery').value='Nome pesquisado';
      const draftId=captureUploadDraft().id;
      prefillYoutubeDraft({},draftId);
      if($('titleInput').value!=='Nome pesquisado')throw new Error('Busca não preencheu título vazio');
      $('titleInput').value='Título escolhido'; $('artistInput').value='';
      prefillYoutubeDraft({title:'Metadado',artist:'Cantor escolhido'},draftId);
    });
    assert.equal(await page.locator('#titleInput').inputValue(),'Título escolhido');
    assert.equal(await page.locator('#artistInput').inputValue(),'Cantor escolhido');
    await page.evaluate(()=>{
      updateUploadActivity({id:'received',draftId:activeUploadDraftId,stage:'done',files:[
        {name:'received-inst.wav',role:'inst'},{name:'received-lead.wav',role:'lead'}]},true,'',false);
      uploadActivityButton.click();
    });
    await page.locator('.upload-activity-attach').click();
    await page.evaluate(()=>{
      chosenFiles.find(file=>file.name==='received-lead.wav').role='back';
      recoverReceivedMvsepFiles();
    });
    assert.equal(await page.evaluate(()=>chosenFiles.filter(file=>file.name==='received-inst.wav').length),1);
    assert.equal(await page.evaluate(()=>chosenFiles.find(file=>file.name==='received-lead.wav').role),'back');
    assert.equal(await page.locator('#titleInput').inputValue(),'Título escolhido');
    let retrySearches=0, cancelSearches=0;
    await page.route('https://lrclib.net/api/search?*',async route=>{
      const query=new URL(route.request().url()).searchParams.get('q');
      if(query.includes('cancelado')) { cancelSearches++; return route.fulfill({status:503,body:'Unavailable'}); }
      if(query.includes('Retry') && ++retrySearches<3) return route.fulfill({status:503,body:'Unavailable'});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{trackName:query,artistName:'Cantor',plainLyrics:'Uma letra'}])});
    });
    await page.evaluate(()=>{$('titleInput').value='Retry';$('artistInput').value='';openLyricsDialog('draft');});
    await page.waitForFunction(()=>document.querySelector('#lyricsResults .lyrics-result'));
    assert.equal(retrySearches,3);
    assert.match(await page.locator('#lyricsResults').textContent(),/Retry/);
    await page.evaluate(()=>{$('lyricsQuery').value='Retry cancelado';void searchLyrics(false);closeLyricsDialog();});
    await page.waitForTimeout(1100);
    assert.equal(retrySearches,3);
    assert.ok(cancelSearches<=1,'Busca cancelada não deve repetir o pedido');
    await page.evaluate(()=>{
      const silent={sampleRate:1000,duration:100,getChannelData:()=>new Float32Array(100000)};
      display.classList.add('show');
      current={id:'chorus',buffers:{Inst:silent,Lead:silent},lyricLines:[
        {time:38390,text:'Refrão continua mesmo no instrumental'},
        {time:40930,text:'Outra linha do refrão'},
        {time:65000,text:'Última linha'}],wordTimings:[],manualVocalSilences:[],
        vocalSilenceState:{quietSince:36,lastPosition:38.9,silent:true}};
      updateLyrics(39);
    });
    assert.equal(await page.locator('#lyricWordMarker i').isVisible(),true);
    assert.equal(await page.locator('#lyricPauseIndicator').isVisible(),false);
    await page.evaluate(()=>{current.manualVocalSilences=[{startMs:36000,endMs:80000}];updateLyrics(39);});
    assert.equal(await page.locator('#lyricWordMarker i').isVisible(),true);
    await page.evaluate(()=>updateLyrics(75));
    assert.equal(await page.locator('#lyricWordMarker i').isVisible(),false);
    assert.equal(await page.locator('#lyricPauseIndicator').isVisible(),true);
    assert.equal(await page.locator('#lyricCurrentLine').isVisible(),true);
    assert.equal(await page.evaluate(()=>{
      current.lyricLines=[{time:1000,text:'Um trecho com tempos reais'}];
      current.wordTimings=[{lineIndex:0,words:[{word:'Um',start:1,end:1.4},{word:'trecho',start:1.5,end:2}]}];
      return hasLyricTrackingNear(1950) && !hasLyricTrackingNear(3000);
    }),true);
    console.log('PASS 1.1: autofill, acoplar sem duplicação, busca instantânea/503/cancelamento e silêncio sem ocultar letra.');
    await page.evaluate(async()=>{await playSong(songs[1].id);await setPlaybackTransform(1.25,4);});
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>current.engine.speed),1.25);
    assert.equal(await page.evaluate(()=>current.engine.processor.parameters.get('pitchSemitones').value),4);
    const clockStart=await page.evaluate(()=>playbackPosition());
    await page.waitForTimeout(400);
    const clockDelta=(await page.evaluate(()=>playbackPosition()))-clockStart;
    assert.ok(clockDelta>.35 && clockDelta<.7,`Relógio em 1.25x: ${clockDelta}`);
    await page.evaluate(()=>{pausePlayback();seek(500);});
    assert.equal(await page.evaluate(()=>playbackPosition()),15);
    await page.evaluate(async()=>{await setPlaybackTransform(.75,-4);startAudioSources(playbackBase);});
    assert.equal(await page.evaluate(()=>current.engine.speed),.75);
    await page.evaluate(async()=>{await setPlaybackTransform(1,0);});
    assert.equal(await page.evaluate(()=>Boolean(current.engine.processor)),false);
    assert.equal(await page.locator('.playback-transform').count(),2);
    await page.evaluate(async()=>{
      pausePlayback();current.buffers={Inst:audioContext.createBuffer(1,Math.round(audioContext.sampleRate*.4),audioContext.sampleRate)};
      await setPlaybackTransform(1.25,4);startAudioSources(0);
    });
    await page.waitForFunction(()=>current.engine.finishTimer && playing && playbackPosition()>=current.buffers.Inst.duration,{},{polling:'raf'});
    await page.waitForFunction(()=>!playing);
    console.log('PASS velocidade/tom: processador único, relógio, pausa/seek, -4/+4 e restauração sem DSP.');
    await desktop.close();
    console.log('PASS PC: faixa completa/stems, ocultar manual, 5s, hover e capa.');

    const context = await browser.newContext({viewport:{width:360,height:800},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'});
    await context.addInitScript(({complete,stems})=>{
      window.calls=[]; window.library=[complete,stems];
      window.__TAURI__={core:{convertFileSrc:name=>'/music/'+name.split('/').pop(),invoke:async(command,args)=>{
        window.calls.push({command,args});
        if(command==='mobile_get_music_dir')return '/music';
        if(command==='mobile_get_library'||command==='mobile_get_pc_library')return window.library;
        if(command==='mobile_mvsep_get_config')return {configured:true};
        if(command==='mobile_mvsep_save_config')return {configured:true};
        if(command==='mobile_mvsep_models')return {models:[{id:12,name:'Karaoke',fields:[]}]};
        if(command==='mobile_remote_state')return {hostType:'tv',playing:false};
        if(command==='mobile_remote_send_mvsep_key')return {configured:true};
        if(command==='mobile_mvsep_start_song')return {id:'cccccccc-cccc-cccc-cccc-cccccccccccc',stage:'preparing'};
        if(command==='mobile_mvsep_youtube_status')return {stage:'done',files:[{name:'inst.wav',role:'inst',label:'Instrumental'},{name:'lead.wav',role:'lead',label:'Vocals'}]};
        if(command==='mobile_save_song'){window.library=window.library.map(song=>song.id===args.song.id?args.song:song);return args.song}
        if(command==='mobile_mvsep_validate_token')throw new Error('Validation unavailable');
        return {};
      }}};
    },{complete,stems});
    const mobile = await context.newPage(); mobile.on('pageerror',error=>errors.push(error.message));
    await mobile.goto(origin); await mobile.waitForFunction(()=>window.__voxstageUiReady);
    await mobile.locator('.setup-wizard.show').waitFor();
    await mobile.evaluate(()=>document.querySelector('.setup-wizard').classList.remove('show'));
    await mobile.evaluate(()=>settingsDialog.classList.add('show'));
    await mobile.locator('[data-settings-tab="about"]').click();
    await mobile.waitForFunction(()=>document.querySelector('.about-app img').naturalWidth>0);
    assert.equal(await mobile.locator('#aboutAppVersion').textContent(),await mobile.evaluate(()=>VoxStageBuildInfo.label));
    assert.ok(await mobile.locator('.about-app').evaluate(node=>node.scrollWidth<=node.clientWidth),'About fits the narrow settings pane');
    await mobile.screenshot({path:path.join(artifacts,'about-android.png')});
    await mobile.locator('[data-settings-tab="playback"]').click();
    await mobile.evaluate(()=>settingsDialog.classList.remove('show'));
    assert.equal(await mobile.locator('[data-settings-tab="local"]').evaluate(node=>node.hidden),true);
    assert.equal(await mobile.locator('.mobile-ytdlp-settings').count(),0);
    assert.equal(await mobile.locator('#syncPcLibrary').textContent(),'▣ Conectar ao VoxStage');
    await mobile.evaluate(()=>document.querySelector('.setup-wizard').classList.add('show'));
    await mobile.locator('#mobileMvsepHelp').click();
    assert.equal(await mobile.locator('.mvsep-help-dialog').isVisible(),true);
    await mobile.screenshot({path:path.join(artifacts,'android-key-help.png')});
    await mobile.locator('.mvsep-help-dialog .lyrics-close').click();
    await mobile.locator('#mobileMvsepToken').fill('test-api-key-123456789');
    await mobile.locator('#mobileSaveMvsep').click();
    await mobile.waitForFunction(()=>calls.some(call=>call.command==='mobile_mvsep_save_config'));
    assert.equal(await mobile.evaluate(()=>calls.some(call=>call.command==='mobile_mvsep_validate_token')),false);
    await mobile.waitForTimeout(750);
    await mobile.locator('#addTop').click();
    const filename='20261012_musica_completa_muito_longa_instrumental_e_backing_vocals_versao_ao_vivo.wav';
    await mobile.evaluate(name=>{chosenFiles=[{name:'source.wav',label:name,role:'source'}];drawAssignments()},filename);
    await mobile.locator('.file-name').click();
    assert.equal(await mobile.locator('#fullFilename').textContent(),filename);
    assert.equal(await mobile.locator('.filename-dialog').isVisible(),true);
    await mobile.screenshot({path:path.join(artifacts,'android-filename.png')});
    await mobile.locator('.filename-dialog .lyrics-close').click();
    await mobile.locator('#closeModal').click();
    await mobile.locator('#syncPcLibrary').click();
    await mobile.locator('#pcSyncLink').fill('http://192.168.1.8:8000/remote#12345678901234567890123456789012');
    await mobile.locator('#pcSyncFind').click();
    await mobile.waitForFunction(()=>!document.getElementById('tvKeyTransfer').hidden);
    assert.equal(await mobile.locator('#mobileSendSection').isVisible(),true);
    assert.equal(await mobile.locator('[data-local-request]').count(),2);
    assert.doesNotMatch(await mobile.locator('#pcSyncDialog').textContent(),/Enviar do celular para o PC|Já existe no PC/);
    await mobile.locator('#sendTvMvsepKey').click();
    await mobile.waitForFunction(()=>calls.some(call=>call.command==='mobile_remote_send_mvsep_key'));
    assert.match(await mobile.locator('#tvMvsepKeyStatus').textContent(),/Chave salva/);
    await mobile.locator('#pcSyncCancel').click();
    await mobile.locator(`[data-menu-toggle="${id}"]`).click();
    await mobile.locator(`[data-mvsep-separate="${id}"]`).click();
    await mobile.waitForFunction(()=>calls.some(call=>call.command==='mobile_mvsep_start_song'));
    await mobile.locator('#titleInput').fill('Edição feita durante a separação');
    await mobile.waitForFunction(()=>library[0].inst && library[0].lead);
    const converted = await mobile.evaluate(()=>library[0]);
    assert.equal(converted.favorite,true); assert.deepEqual(converted.wordTimings,complete.wordTimings);
    assert.equal(converted.source,source); assert.equal(converted.separationStatus,undefined);
    assert.equal(await mobile.locator('#titleInput').inputValue(),'Edição feita durante a separação');
    await mobile.waitForFunction(()=>!youtubeProcessing);
    assert.match(await mobile.locator('.upload-activity-button').textContent(),/Envio concluído/);
    await mobile.evaluate(()=>{document.getElementById('closeModal').click();uploadActivityButton.click();});
    assert.equal(await mobile.locator('.upload-activity-dialog').isVisible(),true);
    assert.equal(await mobile.locator('.upload-activity-dialog progress').getAttribute('value'),'100');
    assert.match(await mobile.locator('.upload-activity-dialog p').textContent(),/salva na biblioteca/);
    await mobile.locator('.upload-activity-return').click();
    await mobile.locator('#saveSong').click();
    await mobile.waitForFunction(()=>library[0].title==='Edição feita durante a separação');
    await mobile.evaluate(async()=>{await playSong(library[0].id);display.classList.add('show');setStageControlsHidden(true);});
    assert.equal(await mobile.locator('#quickExitDisplay').isVisible(),true);
    const hideBox=await mobile.locator('#mobileControlsToggle').boundingBox();
    const exitBox=await mobile.locator('#quickExitDisplay').boundingBox();
    assert.ok(Math.abs(hideBox.y-exitBox.y)<2 && exitBox.x>hideBox.x+hideBox.width,JSON.stringify({hideBox,exitBox}));
    await mobile.locator('#quickExitDisplay').click();
    assert.equal(await mobile.locator('#display').isVisible(),false);
    assert.equal(await mobile.evaluate(()=>library[0].source),source);
    console.log('PASS Android: ajuda, salvar chave offline, overlay de nome, envio à TV, separação de arquivo salvo preservando dados.');
    await context.close();

    const tvContext = await browser.newContext({viewport:{width:1280,height:720},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'});
    await tvContext.addInitScript(()=>{
      window.VoxStageMedia={isTelevision:()=>true,setOrientation:()=>{}};
      window.__TAURI__={core:{convertFileSrc:name=>'/music/'+name.split('/').pop(),invoke:async(command,args)=>{
        if(command==='mobile_get_music_dir')return '/music'; if(command==='mobile_get_library')return [];
        if(command==='mobile_mvsep_get_config')return {configured:false};
        if(command==='mobile_tv_host_api'){
          if(args.path.endsWith('host-info'))return {url:'http://192.168.1.8:8000/remote?target=tv#12345678901234567890123456789012',hostType:'tv'};
          if(args.path.endsWith('commands'))return {commands:[]};
          if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];
        }
        return {};
      }}};
    });
    const tv = await tvContext.newPage(); tv.on('pageerror',error=>errors.push(error.message));
    await tv.goto(origin); await tv.waitForFunction(()=>document.querySelector('.remote-panel.show'));
    assert.equal(await tv.locator('#mobileMvsepToken').count(),0);
    assert.equal(await tv.locator('#setupWizard').count(),0);
    assert.equal(await tv.locator('#remoteQr').isVisible(),true);
    assert.match(await tv.locator('.remote-panel-note').textContent(),/automaticamente na fila/);
    assert.doesNotMatch(await tv.locator('.remote-howto').textContent(),/transfer.*PC/);
    await tv.screenshot({path:path.join(artifacts,'tv-onboarding.png')});
    console.log('PASS TV: onboarding direto em Conectar com o celular.');
    await tvContext.close();
    const remote = await browser.newPage();
    await remote.goto(origin+'/remote.html');
    await remote.evaluate(()=>sessionStorage.setItem('voxstageRemoteToken','stale-session-token-123456789012'));
    await remote.goto(origin+'/remote.html?target=tv#12345678901234567890123456789012');
    await remote.waitForFunction(()=>!document.getElementById('tvMvsepPanel').hidden);
    await remote.locator('#tvMvsepKey').fill('test-api-key-123456789');
    await remote.locator('#sendTvMvsep').click();
    await remote.waitForFunction(()=>document.getElementById('tvMvsepStatus').textContent.includes('Chave salva'));
    assert.equal(await remote.evaluate(()=>token),'12345678901234567890123456789012');
    console.log('PASS controle web: formulário de envio da chave à TV.');
    const development=await browser.newContext();
    await development.addInitScript(()=>{localStorage.setItem('voxstage-onboarding-hidden','1');window.__TAURI__={core:{invoke:async()=>false}};});
    const devPage=await development.newPage();devPage.on('pageerror',error=>errors.push(error.message));
    await devPage.route('**/api/build-mode',route=>route.fulfill({json:{debug:true}}));
    await devPage.goto(origin);await devPage.waitForFunction(()=>window.VoxStageScoring);
    await devPage.evaluate(()=>settingsDialog.classList.add('show'));
    await devPage.locator('#settingsTabDebug').waitFor({state:'visible'});
    await devPage.locator('#settingsTabAbout').click();await devPage.waitForFunction(()=>document.getElementById('aboutAppVersion').textContent===VoxStageBuildInfo.label);
    assert.equal(await devPage.locator('#settingsTabDebug').isVisible(),true,'Development backend exposes Debug with stable metadata');
    await development.close();
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); server.close(); }
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1});
