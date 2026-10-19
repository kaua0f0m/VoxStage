const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');
fs.mkdirSync(artifacts,{recursive:true});
const song={id:'cccccccc-cccc-cccc-cccc-cccccccccccc',title:'Vozes independentes',artist:'Teste',inst:'inst.wav',lead:'lead.wav',
  syncedLyrics:'[00:01.00]Lead first\n[00:04.00]Lead last\n[00:08.00][Second only]',plainLyrics:'Lead first\nLead last\n[Second only]',
  backingSyncedLyrics:'[00:02.00](Backing one)\n[00:06.00](Backing two)',backingPlainLyrics:'Backing one\nBacking two',
  wordTimings:[{lineIndex:0,words:[{word:'Lead',start:1,end:1.5},{word:'first',start:1.5,end:2}]},{lineIndex:1,words:[{word:'Lead',start:4,end:4.5},{word:'last',start:4.5,end:5}]}],
  parallelWordTimings:[{lineIndex:2,words:[{word:'Second',start:8,end:8.5},{word:'only',start:8.5,end:9}]}],
  backingWordTimings:[{lineIndex:0,words:[{word:'Backing',start:2,end:2.5},{word:'one',start:2.5,end:3}]},{lineIndex:1,words:[{word:'Backing',start:6,end:6.5},{word:'two',start:6.5,end:7}]}]};
let library=[structuredClone(song)],posts=0,deletes=0;
const wav=Buffer.alloc(44+48000*2*12);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(req.method==='DELETE')deletes++;
    if(url.pathname==='/api/library'&&req.method==='POST'){
      let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{library=[JSON.parse(body)];posts++;res.end('{}');});return;
    }
    res.end(JSON.stringify(url.pathname==='/api/library'?library:url.pathname==='/api/mvsep/config'?{configured:false}:{}));return;
  }
  if(url.pathname.startsWith('/music/')){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(error?'Not found':data);});
});
// Synthetic rendering keeps the paused transport clock at the requested test time.
async function pinClock(page){await page.evaluate(()=>{const render=updateLyrics;updateLyrics=function(seconds=0){if(!playing&&!manualSyncState)playbackBase=seconds;return render(seconds);};});}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  const errors=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(()=>localStorage.setItem('voxstage-onboarding-hidden','1'));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.waitForFunction(()=>window.__voxstageUiReady);await pinClock(page);
    await page.locator(`[data-play="${song.id}"]`).click();await page.waitForFunction(()=>current?.buffers?.Lead);
    await page.evaluate(()=>{pausePlayback();openManualLineSync();});
    assert.equal(await page.locator('#manualSyncText').inputValue(),'Lead first\nLead last');
    assert.equal(await page.locator('#manualSyncParallelText').inputValue(),'Second only');
    assert.equal(await page.locator('#manualSyncBackingText').inputValue(),'Backing one\nBacking two');
    const before=await page.evaluate(()=>structuredClone(manualSyncVoices));
    await page.locator('[data-sync-focus="backing"]').click();
    await page.locator('#manualSyncBackingText').fill('Inserted backing\nBacking one!\nBacking two');
    await page.locator('#saveManualSync').click();await page.waitForFunction(()=>current?.lyricVoices?.version===1);
    assert.deepEqual(library[0].lyricVoices.lead,before.lead,'Inserting backing must leave every Voice 1 timestamp byte-for-byte equal');
    assert.deepEqual(library[0].lyricVoices.parallel,before.parallel,'Inserting backing must leave Voice 2 unchanged');
    assert.equal(library[0].lyricVoices.backing[0].time,null);
    assert.equal(library[0].lyricVoices.backing[1].time,2000);
    assert.equal(library[0].lyricVoices.backing[2].time,6000);
    await page.evaluate(()=>{
      const index=current.lyricLines.findIndex(row=>row.text==='Lead last');
      current.profanityMarks=[{lineIndex:index,wordIndex:1,word:'last'}];
      current.profanityCues=[{lineIndex:index,wordIndex:1,word:'last',startMs:4500,endMs:5000}];
    });
    await page.evaluate(()=>openManualLineSync());
    await page.locator('[data-sync-focus="backing"]').click();
    await page.locator('#manualSyncBackingText').fill('Backing two');
    await page.locator('#saveManualSync').click();await page.waitForFunction(()=>current.lyricVoices.backing.length===1);
    assert.deepEqual(library[0].lyricVoices.lead,before.lead,'Deleting backing must leave Voice 1 unchanged');
    assert.equal(library[0].lyricVoices.backing[0].time,6000);
    assert.equal(await page.evaluate(()=>current.lyricLines[current.profanityCues[0].lineIndex].text),'Lead last','Censorship follows its original phrase after backing indices change');
    await page.reload();await page.waitForFunction(()=>window.__voxstageUiReady);await pinClock(page);
    await page.locator(`[data-play="${song.id}"]`).click();await page.waitForFunction(()=>current?.buffers?.Lead);
    await page.evaluate(()=>{pausePlayback();display.classList.add('show');updateLyrics(8.6);});
    assert.equal(await page.locator('#lyricSecondLine').isVisible(),true,'Voice 2 can sing independently of Voice 1');
    assert.match(await page.locator('#lyricSecondLine').textContent(),/Second\s+only/);
    assert.equal(await page.locator('#lyricCurrentLine').isVisible(),false,'A finished Voice 1 must not remain visible during a Voice 2 solo');
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),true);
    await page.evaluate(()=>{openManualLineSync();});
    await page.locator('[data-sync-focus="parallel"]').click();
    await page.locator('#manualSyncParallelText').fill('Together\nSecond only');
    await page.locator('[data-sync-focus="parallel"]').click();
    await page.evaluate(async()=>{
      await startManualSync();pausePlayback();
      if(manualSyncState.lines.length!==2)throw new Error('Voice 2 must not use the combined line indices');
      manualSyncState.times=[1,8];manualSyncState.lineEnds={0:3,1:9};manualSyncState.nextIndex=2;manualSyncState.running=false;
      await saveManualSync();updateLyrics(1.5);
    });
    assert.deepEqual(library[0].lyricVoices.lead,before.lead,'Syncing Voice 2 must not shift Voice 1');
    assert.equal(await page.locator('#lyricSecondLine').isVisible(),true);
    assert.equal(await page.locator('#lyricCurrentLine').isVisible(),true,'Both voices may appear at the same time');
    await page.evaluate(()=>{settingsDialog.classList.add('show');selectSettingsTab('lyrics');});
    assert.equal(await page.locator('#voice2Color').isVisible(),true);
    assert.equal(await page.locator('#settingsPaneVisual .lyric-appearance-section button').count(),0,'Global lyrics preferences need no redundant editor button');
    assert.match(await page.locator('#settingsPaneVisual [role="note"]').textContent(),/cada música/);
    await page.locator('#lyricsScale').evaluate(node=>{node.value='1.25';node.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#lyricsScaleValue').textContent(),'125%');
    await page.locator('#voice2Color').evaluate(node=>{node.value='#45b5ff';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#voicesOverlapGradient').uncheck();
    await page.evaluate(()=>{settingsDialog.classList.remove('show');updateLyrics(1.5);});
    assert.equal(await page.locator('#lyricSecondLine .active').evaluate(node=>getComputedStyle(node).color),'rgb(69, 181, 255)');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--word-marker-secondary').trim()),'#45b5ff');
    await page.evaluate(()=>{settingsDialog.classList.add('show');selectSettingsTab('lyrics');});
    await page.locator('#voicesOverlapGradient').check();
    await page.evaluate(()=>{settingsDialog.classList.remove('show');updateLyrics(1.5);});
    assert.equal(await page.locator('#lyricCurrentLine .active').evaluate(node=>getComputedStyle(node).backgroundImage),'none','Different phrases never get a duet gradient');
    assert.equal(await page.locator('#lyricSecondLine .active').evaluate(node=>getComputedStyle(node).backgroundImage),'none');
    assert.equal(await page.locator('#lyricSecondLine').evaluate(node=>node.parentElement.classList.contains('display-content')),true,'Voice 2 stays outside the animated main block');
    await page.screenshot({path:path.join(artifacts,'lyrics-voices-gradient.png')});
    const savesBeforeOverlay=posts;
    await page.evaluate(()=>{
      window.__overlayOriginal=current;
      const voices=VoxStageLyrics.normalize({version:1,lead:[{id:'same-lead',text:'Shared line',time:1000,end:3000,words:[{word:'Shared',start:1,end:1.9},{word:'line',start:1.9,end:3}]}],
        parallel:[{id:'same-parallel',text:'shared line!',time:1250,end:3500,words:[{word:'shared',start:1.25,end:2.3},{word:'line!',start:2.3,end:3.5}]}],backing:[]});
      current={...current,...VoxStageLyrics.project(voices),lyricVoices:voices,lyricIndex:null,playbackTracks:null,vocalSilenceState:null,vocalSilenceEnds:[]};
      window.__overlayTimings=JSON.stringify(current.lyricVoices);updateLyrics(1.5);
    });
    assert.equal(await page.locator('#lyrics').evaluate(node=>node.classList.contains('voices-merged')),true,'Matching phrases merge even with casing/punctuation differences');
    assert.equal(await page.locator('#lyricCurrentLine').isVisible(),true);
    assert.equal(await page.locator('#lyricSecondLine').isVisible(),false,'A shared phrase is drawn only once');
    assert.equal(await page.locator('#lyricWordMarker i').isVisible(),true);
    assert.equal(await page.locator('#lyricWordMarker').evaluate(node=>node.classList.contains('paired')),true);
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false,'Shared word uses one gradient dot');
    assert.match(await page.locator('#lyricWordMarker i').evaluate(node=>getComputedStyle(node).backgroundImage),/linear-gradient/);
    assert.equal(await page.locator('#lyricCurrentLine .voices-active').textContent(),'Shared');
    assert.match(await page.locator('#lyricCurrentLine .voices-active').evaluate(node=>getComputedStyle(node).backgroundImage),/linear-gradient/);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false,'Only one dot remains after animation settles');
    await page.screenshot({path:path.join(artifacts,'lyrics-merged-voices.png')});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>updateLyrics(1.5));
    assert.equal(await page.locator('#lyricSecondLine').isVisible(),false,'Mobile uses the same shared phrase instead of duplicating it');
    assert.equal(await page.locator('#lyricWordMarker i').isVisible(),true);
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false);
    await page.screenshot({path:path.join(artifacts,'lyrics-merged-voices-mobile.png')});
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(()=>updateLyrics(1.5));
    await page.evaluate(()=>{
      const animations=$('lyricParallelWordMarker').querySelector('i').getAnimations();window.__parallelAnimation=animations[0];updateLyrics(1.55);
    });
    assert.equal(await page.evaluate(()=>$('lyricParallelWordMarker').querySelector('i').getAnimations()[0]===window.__parallelAnimation),true,'Voice 2 must not restart its hop on every frame');
    await page.evaluate(()=>updateLyrics(2.05));
    assert.equal(await page.locator('#lyricCurrentLine .voice1-active').textContent(),'line');
    assert.equal(await page.locator('#lyricCurrentLine .voice2-active').textContent(),'Shared','Two markers follow their own timings on the shared text');
    assert.equal(await page.locator('#lyricCurrentLine .voices-active').count(),0,'Different active words must not blend their colors');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#lyricCurrentLine .voice2-active').evaluate(node=>getComputedStyle(node).color),'rgb(69, 181, 255)');
    assert.equal(await page.locator('#lyricCurrentLine .voice2-active').evaluate(node=>getComputedStyle(node).backgroundImage),'none');
    await page.evaluate(()=>{processingSettings.voicesOverlapGradient=false;applyVoiceTheme();updateLyrics(2.5);});
    assert.equal(await page.locator('#lyricCurrentLine .voices-active').evaluate(node=>getComputedStyle(node).backgroundImage),'none','Merging respects the optional gradient preference');
    await page.evaluate(()=>{current.wordByWordEnabled=false;updateLyrics(1.5);});
    assert.equal(await page.locator('#lyricSecondLine').isVisible(),false,'Line mode still avoids duplicate phrases');
    for(const id of ['lyricWordMarker','lyricParallelWordMarker'])assert.equal(await page.locator('#'+id).isVisible(),false,'Line mode must not show word markers');
    await page.evaluate(()=>{current.wordByWordEnabled=true;processingSettings.voicesOverlapGradient=true;applyVoiceTheme();updateLyrics(1.1);});
    assert.equal(await page.locator('#lyrics').evaluate(node=>node.classList.contains('voices-merged')),false,'Identical phrases do not merge before their times overlap');
    await page.evaluate(()=>{processingSettings.voicesOverlapGradient=true;applyVoiceTheme();updateLyrics(3.25);});
    assert.equal(await page.locator('#lyricCurrentLine').isVisible(),true,'Shared phrase stays in place after Voice 1 ends');
    assert.equal(await page.locator('#lyricSecondLine').isVisible(),false,'No duplicate Voice 2 flash at the end of a duet');
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),true,'Remaining Voice 2 follows the shared phrase');
    assert.equal(await page.locator('#lyricWordMarker').isVisible(),false,'A finished hidden voice must not leave its marker behind');
    await page.evaluate(()=>updateLyrics(4));
    assert.equal(await page.locator('#lyrics').evaluate(node=>node.classList.contains('voices-merged')),true,'Shared phrase stays until the next lyric event');
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false,'A held phrase has no singing dot after its end');
    assert.equal(await page.evaluate(()=>JSON.stringify(current.lyricVoices)===window.__overlayTimings),true,'Visual merging never rewrites the independent lyrics or timestamps');
    assert.equal(posts,savesBeforeOverlay,'Visual merging must not save or merge the stored tracks');
    await page.evaluate(()=>{
      const voices=VoxStageLyrics.normalize({version:1,lead:[{id:'duet-lead',text:'Same words',time:1000,end:3000,words:[{word:'Same',index:0,start:1,end:2},{word:'words',index:1,start:2,end:3}]}],
        parallel:[{id:'duet-voice2',text:'same words!',time:1050,end:2700,words:[{word:'same',index:0,start:1.05,end:1.9},{word:'words!',index:1,start:1.9,end:2.7}]},
          {id:'next-solo',text:'A solo answer',time:4000,end:6000,words:[{word:'A',index:0,start:4,end:4.5},{word:'solo',index:1,start:4.5,end:5},{word:'answer',index:2,start:5,end:6}]}],backing:[]});
      Object.assign(current,VoxStageLyrics.project(voices),{lyricVoices:voices,lyricIndex:null,playbackTracks:null});updateLyrics(1.5);
      window.__sharedElement=$('lyricCurrentLine');
    });
    for(const t of [2.71,2.99,3.01,3.5,3.99,1.5,3.5]){
      await page.evaluate(t=>updateLyrics(t),t);
      assert.equal(await page.locator('#lyricCurrentLine').isVisible(),true,`Keep the duet until solo (${t}s)`);
      assert.equal(await page.locator('#lyricSecondLine').isVisible(),false);
      assert.equal(await page.evaluate(()=>$('lyricCurrentLine')===window.__sharedElement),true,'No rebuilding/fading the shared phrase');
    }
    for(const form of [{width:1280,height:900,tv:false},{width:390,height:844,tv:false},{width:844,height:390,tv:false},{width:1280,height:720,tv:true}]){
      await page.setViewportSize({width:form.width,height:form.height});
      await page.evaluate(tv=>{document.body.classList.add('mobile-native-app');display.classList.toggle('mobile-stage-tv',tv);display.dataset.stageDevice=tv?'tv':innerWidth<900?'phone':'pc';updateLyrics(1.5);},form.tv);
      await page.waitForTimeout(350);
      const before=await page.locator('#lyrics').boundingBox();
      await page.evaluate(()=>updateLyrics(4.5));await page.waitForTimeout(50);
      assert.equal(await page.locator('#lyricSecondLine').isVisible(),true,'Only the new solo enters Voice 2 lane');
      assert.equal(await page.locator('#lyricCurrentLine').isVisible(),false,'Finished main phrase is hidden with geometry retained');
      const after=await page.locator('#lyrics').boundingBox();assert.equal(after.y,before.y,'Voice 2 cannot move the main lyric block');
      const overlay=await page.locator('#lyricSecondLine').boundingBox();
      assert.ok(overlay.x>=0&&overlay.y>=0&&overlay.x+overlay.width<=form.width+1&&overlay.y+overlay.height<=form.height+1,'Voice 2 fits on screen');
      assert.ok(overlay.y+overlay.height<=after.y+2 || overlay.x+overlay.width<=after.x+2 || overlay.x>=after.x+after.width-2,'Separate Voice 2 lane stays clear of the main block');
      await page.screenshot({path:path.join(artifacts,`lyrics-voice2-solo-${form.width}x${form.height}.png`)});
    }
    await page.evaluate(()=>{document.body.classList.remove('mobile-native-app');display.classList.remove('mobile-stage-tv');display.dataset.stageDevice='pc';});await page.setViewportSize({width:1280,height:900});
    const mobileVoices=await page.evaluate(()=>structuredClone(current.lyricVoices));
    for(const television of [false,true]){
      const native=await browser.newContext({viewport:television?{width:1280,height:720}:{width:390,height:844},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'});
      await native.addInitScript(({television})=>{
        localStorage.setItem('voxstage-onboarding-hidden','1');
        window.VoxStageMedia={isTelevision:()=>television};
        window.__TAURI__={core:{convertFileSrc:path=>path,invoke:async(command,args)=>{
          if(command==='mobile_tv_host_api'){
            if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];
            if(args.path.endsWith('commands'))return {commands:[]};
          }
          if(command==='mobile_get_music_dir')return '/music';
          if(command==='mobile_get_library'||command==='mobile_get_pc_library')return [];
          return {};
        }}};
      },{television});
      const mobile=await native.newPage();mobile.on('pageerror',error=>errors.push(error.message));
      await mobile.goto(origin);await mobile.waitForFunction(()=>window.__voxstageUiReady);await pinClock(mobile);
      if(television){await mobile.locator('#remotePanel.show').waitFor();await mobile.locator('#remotePanelClose').click();}
      await mobile.evaluate(voices=>{
        const buffer=new AudioBuffer({length:48000*12,numberOfChannels:1,sampleRate:48000});
        current={id:'native-duet',title:'Silent test',...VoxStageLyrics.project(voices),lyricVoices:voices,lyricIndex:null,wordByWordEnabled:true,buffers:{Inst:buffer,Lead:buffer}};
        $('remotePanel').classList.remove('show');display.classList.add('show');updateLyrics(1.5);
      },mobileVoices);
      for(const viewport of television?[{width:1280,height:720}]:[{width:390,height:844},{width:844,height:390}]){
        await mobile.setViewportSize(viewport);await mobile.evaluate(()=>updateLyrics(1.5));await mobile.waitForTimeout(350);
        const before=await mobile.locator('#lyrics').boundingBox();
        await mobile.evaluate(()=>updateLyrics(4.5));
        const after=await mobile.locator('#lyrics').boundingBox(),solo=await mobile.locator('#lyricSecondLine').boundingBox();
        await mobile.screenshot({path:path.join(artifacts,`lyrics-native-voice2-${television?'tv':viewport.width}.png`)});
        assert.ok(Math.abs(after.y-before.y)<1,'Native Voice 2 keeps the main layout stable');
        assert.ok(solo.y+solo.height<=after.y+2,'Native Voice 2 stays above the main lyrics: '+JSON.stringify({television,viewport,solo,after}));
        const controls=await mobile.locator('.display-bottom').boundingBox();
        assert.ok(solo.y+solo.height<=controls.y,'Native solo lane stays above playback controls');
        await mobile.screenshot({path:path.join(artifacts,`lyrics-native-voice2-${television?'tv':viewport.width}.png`)});
        if(!television){
          await mobile.evaluate(()=>{setStageControlsHidden(false,'manual');window.__realPlayClick=displayPlayButton.onclick;window.__tapPlayCount=0;displayPlayButton.onclick=()=>__tapPlayCount++;});
          await mobile.locator('#lyricSecondLine').click();assert.equal(await mobile.locator('#display').evaluate(node=>node.classList.contains('mobile-controls-hidden')),true);
          await mobile.locator('#lyricSecondLine').click();assert.equal(await mobile.evaluate(()=>__tapPlayCount),1,'Voice 2 supports the lyric playback shortcut');
          await mobile.evaluate(()=>{displayPlayButton.onclick=__realPlayClick;setStageControlsHidden(false,'manual');});
        }
        await mobile.evaluate(()=>updateLyrics(7));assert.equal(await mobile.locator('#lyricSecondLine').isVisible(),true,'Solo text holds until the next phrase');
        await mobile.evaluate(()=>{openManualLineSync();setManualSyncFocus('parallel');});
        await mobile.evaluate(async()=>{await startManualSync();pausePlayback();});
        assert.equal(await mobile.locator('#lyricSecondLine').isVisible(),false,'Detached lane is hidden during manual sync');
        await mobile.locator('#syncCancel').click();
      }
      await mobile.evaluate(()=>stopSong());assert.equal(await mobile.locator('#lyricSecondLine').isVisible(),false,'Stopping clears detached lyrics');
      await native.close();
    }
    await page.evaluate(()=>{current=window.__overlayOriginal;delete window.__overlayOriginal;delete window.__overlayTimings;delete window.__parallelAnimation;current.lyricIndex=null;updateLyrics(1.5);});

    await page.evaluate(async()=>{
      openManualLineSync();setManualSyncFocus('backing');setManualSyncMode('word');
      await startManualSync();pausePlayback();
      if(manualSyncState.lines.length!==1)throw new Error('Backing indices must be local to its own voice');
      manualSyncState.times=[6,6.25];manualSyncState.endTime=6.9;manualSyncState.finished=true;manualSyncState.running=false;
      await saveManualSync();
    });
    assert.deepEqual(library[0].lyricVoices.lead,before.lead,'Word-syncing backing must preserve every main-vocal timestamp');
    assert.deepEqual(library[0].lyricVoices.backing[0].words.map(cue=>[cue.start,cue.end]),[[6,6.25],[6.25,6.9]]);
    await page.evaluate(()=>openManualLineSync());
    await page.locator('#manualSyncText').fill('Lead first\nFresh last');
    await page.locator('#saveManualSync').click();await page.waitForFunction(()=>current.lyricVoices.lead[1].text==='Fresh last');
    await page.evaluate(()=>updateLyrics(4.6));
    assert.equal(await page.locator('#lyricCurrentLine .lyric-word.active').textContent(),'last','A changed first word must not discard the following word timestamps during playback');
    await page.evaluate(()=>openManualLineSync());
    await page.locator('#manualSyncText').fill('Lead (first)\nLead last');
    await page.locator('#syncExtractTool summary').click();
    await page.locator('#extractLegacyVoices').click();
    assert.equal(await page.locator('#manualSyncText').inputValue(),'Lead\nLead last');
    assert.equal(await page.locator('#manualSyncBackingText').inputValue(),'Backing two\nfirst');
    assert.equal(await page.locator('#manualSyncParallelText').inputValue(),'Together\nSecond only','Extracting new backing must not reconstruct Voice 2');
    await page.locator('#saveManualSync').click();await page.waitForFunction(()=>current.lyricVoices.backing.length===2);
    assert.equal(library[0].lyricVoices.backing[1].words[0].start,1.5,'Extracted words keep their original timestamps');
    // New catalog lyrics and manually pasted lyrics accept inline legacy markup.
    await page.evaluate(async()=>{await useLyricCandidate({trackName:'New lyrics',plainLyrics:'Nova (resposta) [dueto]',syncedLyrics:'[00:02.00]Nova (resposta) [dueto]'},'current');});
    assert.equal(library[0].lyricVoices.lead[0].text,'Nova');
    assert.equal(library[0].lyricVoices.backing[0].text,'resposta');
    assert.equal(library[0].lyricVoices.parallel[0].text,'dueto');
    const beforeBackingPaste=structuredClone(library[0].lyricVoices);
    await page.evaluate(async()=>{await useLyricCandidate({plainLyrics:'(resposta corrigida)',lyricProvider:'VoxStage · letra colada'},'current');});
    assert.deepEqual(library[0].lyricVoices.lead,beforeBackingPaste.lead,'Pasting backing-only legacy text must never erase or resync Voice 1');
    assert.deepEqual(library[0].lyricVoices.parallel,beforeBackingPaste.parallel,'Pasting backing-only legacy text must preserve Voice 2');
    await page.evaluate(()=>{display.classList.remove('show');$('addTop').click();chosenFiles=[{name:'keep.wav',role:'source'},{name:'accidental.wav',role:'back'}];drawAssignments();});
    await page.locator('#menuImportStep1').click();await page.locator('[data-remove-file="1"]').click();
    assert.deepEqual(await page.evaluate(()=>chosenFiles.map(file=>file.name)),['keep.wav']);
    assert.deepEqual(await page.evaluate(()=>uploadDrafts.get(activeUploadDraftId).files.map(file=>file.name)),['keep.wav']);
    assert.equal(deletes,0,'Removing an assignment must never delete a stored file');
    await page.evaluate(()=>hideModal());
    await page.evaluate(()=>openManualLineSync());
    await page.evaluate(()=>document.getElementById('toast')?.classList.remove('show'));
    await page.screenshot({path:path.join(artifacts,'lyrics-voices-desktop.png')});
    await page.evaluate(()=>document.body.classList.add('mobile-native-app'));
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.voice-editors').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),1);
    for(const [voice,editor] of [['lead','#manualSyncText'],['parallel','#manualSyncParallelText'],['backing','#manualSyncBackingText']]){
      await page.locator('[data-sync-focus="'+voice+'"]').click();
      assert.equal(await page.locator(editor).isVisible(),true);
      assert.equal(await page.locator('.voice-editor:visible').count(),1,'Only the selected voice occupies the editor');
      assert.ok(await page.locator(editor).evaluate(node=>node.clientWidth>260),'Mobile lyrics need the full panel width');
    }
    await page.locator('[data-sync-focus="lead"]').click();
    assert.ok(await page.locator('.manual-sync-card').evaluate(node=>node.scrollWidth<=node.clientWidth+2),'Mobile editor must not overflow horizontally');
    await page.locator('[data-sync-focus="lead"]').focus();await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-sync-focus="parallel"]').getAttribute('aria-selected'),'true','Voice tabs support keyboard navigation');
    await page.locator('[data-sync-focus="lead"]').click();
    for(const viewport of [{width:320,height:640},{width:390,height:420},{width:760,height:430}]){
      await page.setViewportSize(viewport);
      assert.ok(await page.locator('.manual-sync-card').evaluate(node=>node.scrollWidth<=node.clientWidth+2));
      assert.ok(await page.locator('#saveManualSync').evaluate(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}),'Save stays visible on a short screen');
      assert.ok(await page.locator('#closeManualSync').evaluate(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}),'Close stays visible on a short screen');
      await page.locator('#syncCensorTool summary').click();
      assert.equal(await page.locator('#openProfanityPicker').isVisible(),true,'Collapsed tools remain available');
      await page.locator('#syncCensorTool summary').click();
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:360});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:30});visualViewport.dispatchEvent(new Event('resize'));});
    assert.ok(await page.locator('#saveManualSync').evaluate(node=>node.getBoundingClientRect().bottom<=390),'Save stays above the mobile keyboard when only the visual viewport shrinks');
    assert.ok(await page.locator('#closeManualSync').evaluate(node=>node.getBoundingClientRect().top>=30),'Header follows the visible viewport');
    await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
    await page.evaluate(()=>{document.querySelector('.sync-editor-body').scrollTop=0;document.getElementById('toast')?.classList.remove('show');});
    await page.screenshot({path:path.join(artifacts,'lyrics-voices-mobile.png')});
    await page.reload();await page.waitForFunction(()=>window.__voxstageUiReady);await pinClock(page);
    assert.equal(await page.evaluate(()=>processingSettings.voice2Color),'#45b5ff','Voice 2 color must survive restarting');
    assert.equal(await page.evaluate(()=>processingSettings.voicesOverlapGradient),true);
    await page.evaluate(()=>{display.classList.remove('show');document.querySelectorAll('.toast').forEach(n=>n.remove());openProcessingSettings();selectSettingsTab('lyrics');});await page.waitForTimeout(100);
    assert.equal(await page.locator('#voice2Color').isVisible(),true,'Global lyrics preferences must be available on a narrow screen');
    assert.ok(await page.locator('.processing-card').evaluate(node=>node.scrollWidth<=node.clientWidth+2),'Mobile global preferences must not overflow horizontally');
    await page.screenshot({path:path.join(artifacts,'lyrics-settings-mobile.png')});
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:path.join(artifacts,'lyrics-settings-desktop.png')});
    assert.deepEqual(errors,[]);
    console.log(`PASS letras UI: 3 campos, backing isolado após salvar/reabrir, Voz 2 solo e simultânea, extração preservando palavras, letras novas, remoção de anexos sem apagar arquivos (${posts} gravações em biblioteca de teste).`);
  }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
