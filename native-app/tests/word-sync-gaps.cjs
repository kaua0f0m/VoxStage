const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright'),model=require('../../lyrics-model.js');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');
const voices={version:1,lead:[{id:'l1',text:'First phrase',time:1000,end:3000,words:[{word:'First',index:0,start:1,end:2},{word:'phrase',index:1,start:2,end:3}]},{id:'l2',text:'Next passage',time:8000,end:10000,words:[{word:'Next',index:0,start:8,end:9},{word:'passage',index:1,start:9,end:10}]}],parallel:[{id:'p1',text:'Second voice',time:12000,end:14000,words:[]}],backing:[{id:'b1',text:'Backing answer',time:16000,end:18000,words:[]}]};
let song={id:'abababab-abab-abab-abab-abababababab',title:'Sync pauses',inst:'silent.wav',lead:'silent.wav',...model.storage(voices)},posts=0;
const wav=Buffer.alloc(44+48000*2*40);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/library'&&req.method==='POST'){let data='';req.on('data',part=>data+=part);req.on('end',()=>{song=JSON.parse(data);posts++;res.setHeader('Content-Type','application/json');res.end('{}');});return;}
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/library'?[song]:{}));return;}
  if(url.pathname.startsWith('/music/')){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(err?'Not found':data);});
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  const errors=[];
  try{
    const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('voxstage-onboarding-hidden','1'));
    const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageUiReady);
    await page.locator('#openUsageGuide').tap();assert.equal(await page.locator('#usageGuide').isVisible(),true);
    assert.equal(await page.locator('#usageGuide details[open]').count(),0,'Instructions stay collapsed until needed');
    await page.locator('#usageGuide-errors summary').tap();assert.match(await page.locator('#usageGuide-errors').textContent(),/503.*temporariamente indisponível/s);
    await page.locator('#usageGuide-scoring summary').tap();assert.match(await page.locator('#usageGuide-scoring aside').textContent(),/melhor no PC.*fone de ouvido/);
    await page.screenshot({path:path.join(artifacts,'usage-guide-mobile.png')});
    await page.keyboard.press('Escape');assert.equal(await page.locator('#usageGuide').isVisible(),false);
    assert.equal(await page.locator('#openUsageGuide').evaluate(node=>node===document.activeElement),true);
    await page.locator(`[data-play="${song.id}"]`).click();await page.waitForFunction(()=>current?.buffers?.Lead);
    // A deterministic song clock isolates each mark; the audio remains silent.
    await page.evaluate(()=>{pausePlayback();window.__realPosition=playbackPosition;window.__markTime=1.5;playbackPosition=()=>__markTime;display.classList.add('show');updateLyrics(1.5);});
    const saved=JSON.stringify(song.lyricVoices);
    for(const mode of ['line','word'])for(const voice of ['lead','parallel','backing']){
      await page.evaluate(async({mode,voice})=>{
        __markTime=1.5;playing=false;openManualLineSync();setManualSyncFocus(voice);setManualSyncMode(mode);
        await startManualSync();pausePlayback();__markTime=20;playing=true;markManualSyncInput();playing=false;
      },{mode,voice});
      await page.locator('#syncCancel').tap();
      assert.equal(await page.evaluate(()=>manualSyncState),null);
      assert.equal(await page.locator('#syncToolbar').isVisible(),false);
      assert.equal(await page.locator('#manualSyncDialog').isVisible(),false);
      assert.equal(await page.evaluate(()=>playbackBase),1.5,'Cancellation restores the position before sync');
      // Restore the deterministic clock to the restored transport position.
      await page.evaluate(()=>{__markTime=playbackBase;updateLyrics(__markTime);openManualLineSync();});
      assert.equal(await page.locator('#manualSyncFocusRow button:disabled').count(),0,'Every voice tab is unlocked after cancelling');
      assert.equal(await page.locator('#manualSyncText').isEnabled(),true);
      assert.equal(await page.locator('#manualSyncText').inputValue(),'First phrase\nNext passage');
      await page.locator('#closeManualSync').tap();
      assert.equal(await page.locator('#lyricCurrentLine').isVisible(),true,'Cancelling another voice restores saved main lyrics');
      assert.match(await page.locator('#lyricCurrentLine').textContent(),/First\s+phrase/);
      assert.equal(JSON.stringify(song.lyricVoices),saved);assert.equal(posts,0,'Cancel never saves a partial voice');
    }
    // Cancelling from the text editor, censorship and silence also unlocks all voices.
    for(const kind of ['edit','censor','silence']){
      await page.evaluate(async kind=>{
        __markTime=1.5;playing=false;openManualLineSync();
        if(kind==='edit'){setManualSyncFocus('parallel');await startManualSync();pausePlayback();editManualLyrics();$('manualSyncParallelText').value='Unsaved change';}
        if(kind==='censor'){current.profanityMarks=[{lineIndex:0,wordIndex:0,word:'First'}];await startCensorSync();pausePlayback();}
        if(kind==='silence'){startSilenceSync();pausePlayback();}
        $('closeManualSync').click();__markTime=playbackBase;updateLyrics(__markTime);openManualLineSync();
      },kind);
      assert.equal(await page.locator('#manualSyncFocusRow button:disabled').count(),0);
      assert.equal(await page.locator('#manualSyncFocusRow').isVisible(),true);
      await page.locator('[data-sync-focus="parallel"]').tap();
      assert.equal(await page.locator('#manualSyncParallelText').inputValue(),'Second voice');
      await page.locator('#closeManualSync').tap();
      assert.equal(JSON.stringify(song.lyricVoices),saved);
      assert.equal(posts,0);
    }
    await page.evaluate(async()=>{__markTime=1.5;openManualLineSync();$('manualSyncText').value='First phrase\n\n\nNext passage';setManualSyncMode('word');await startManualSync();pausePlayback();});
    assert.equal(await page.evaluate(()=>manualSyncState.queue[2].breakBefore),true);
    async function mark(time){await page.evaluate(time=>{__markTime=time;playing=true;},time);await page.locator('#lyricCurrentLine').tap();await page.evaluate(()=>{playing=false;});}
    await mark(1);await mark(2);await mark(3);
    assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),true);
    assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[1,2]);
    assert.match(await page.locator('#syncStageStatus').textContent(),/Pausa.*próximo trecho/);
    for(const id of ['lyricWordMarker','lyricParallelWordMarker','lyricBackingWordMarker'])assert.equal(await page.locator('#'+id).isVisible(),false,'No word marker moves during the blank-line interval');
    await page.evaluate(()=>{__markTime=2.5;playing=true;markManualSyncInput();playing=false;});
    assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),true,'A backward seek cannot start the next passage before the previous end');
    await mark(8);assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),false);
    assert.equal(await page.evaluate(()=>manualSyncState.nextIndex),2,'The start tap does not skip the first word');
    await page.locator('#syncUndo').tap();assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),true,'Undo of the new start restores the waiting interval');
    await page.locator('#syncUndo').tap();assert.equal(await page.evaluate(()=>manualSyncState.nextIndex),1,'Undo of phrase end returns to the last word');
    assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),false);
    await mark(3.1);
    // Editing a later phrase while waiting must preserve the explicit earlier end.
    await page.locator('#syncEdit').tap();await page.locator('#manualSyncText').fill('First phrase\n\nNext passage!');
    await page.locator('#editManualLyrics').tap();
    assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),true);
    assert.equal(await page.evaluate(()=>manualSyncState.wordEnds[1]),3.1);
    await mark(8);await mark(9);await mark(10);
    assert.equal(await page.evaluate(()=>manualSyncState.finished),true);
    await page.locator('#syncUndo').tap();assert.equal(await page.evaluate(()=>manualSyncState.finished),false);
    await mark(10.1);await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
    assert.deepEqual(song.lyricVoices.lead.map(row=>row.words.map(cue=>[cue.start,cue.end])),[[[1,2],[2,3.1]],[[8,9],[9,10.1]]]);
    assert.equal(song.lyricVoices.lead[0].end,3100,'A phrase never stretches through the blank-line interval');
    assert.deepEqual(song.lyricVoices.parallel,voices.parallel);assert.deepEqual(song.lyricVoices.backing,voices.backing);
    await page.evaluate(()=>openManualLineSync());assert.equal(await page.locator('#manualSyncText').inputValue(),'First phrase\n\nNext passage!','The blank line survives saving and reopening');
    await page.locator('#closeManualSync').tap();
    // A one-word passage can be saved even before the next start is known.
    await page.evaluate(async()=>{openManualLineSync();$('manualSyncText').value='First\n\nNext passage!';setManualSyncMode('word');await startManualSync();pausePlayback();});
    await mark(1);await mark(2.2);await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
    assert.equal(song.lyricVoices.lead[0].words[0].end,2.2,'Partial save keeps a completed phrase end during a gap');
    // A new/incorrectly zero-timed Voice 2 waits for its actual first onset.
    const leadBeforeLate=structuredClone(song.lyricVoices.lead);
    await page.evaluate(async()=>{
      __markTime=5;playing=false;openManualLineSync();setManualSyncFocus('parallel');
      $('manualSyncParallelText').value='Late words';manualSyncVoices.parallel[0].time=0;manualSyncVoices.parallel[0].words=[];
      setManualSyncMode('word');await startManualSync();pausePlayback();
    });
    assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[],'No word onset is inferred at zero');
    assert.equal(await page.evaluate(()=>playbackBase),5,'Sync starts at the current transport position');
    assert.match(await page.locator('#syncStageStatus').textContent(),/Primeira palavra/);
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false);
    await mark(20);assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[20]);
    await page.locator('#syncUndo').tap();assert.equal(await page.evaluate(()=>manualSyncState.awaitingStart),true,'Even the first onset can be undone');
    assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[]);
    await mark(20.1);await mark(21);await mark(22);await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
    assert.equal(song.lyricVoices.parallel[0].time,20100);assert.equal(song.lyricVoices.parallel[0].end,22000);
    assert.deepEqual(song.lyricVoices.parallel[0].words.map(cue=>[cue.start,cue.end]),[[20.1,21],[21,22]]);
    assert.deepEqual(song.lyricVoices.lead,leadBeforeLate);
    // Every line in every voice requires an end, including the final line.
    for(const voice of ['lead','parallel','backing']){
      const otherVoices=structuredClone(song.lyricVoices);
      await page.evaluate(async voice=>{
        __markTime=4;playing=false;openManualLineSync();setManualSyncFocus(voice);
        manualSyncEditor().value='Intro phrase\nOutro phrase';setManualSyncMode('line');await startManualSync();pausePlayback();
      },voice);
      await mark(10);assert.equal(await page.evaluate(()=>manualSyncState.pendingBackingEnd),true);
      await mark(12);assert.equal(await page.evaluate(()=>manualSyncState.nextIndex),1);
      await mark(11);assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[10],'A backward seek cannot start a line inside the preceding completed line');
      await mark(15);assert.equal(await page.evaluate(()=>manualSyncState.finished),false);
      assert.match(await page.locator('#syncStageStatus').textContent(),/Frase começou.*fim da frase/);
      await page.locator('#syncEdit').tap();await page.locator(voice==='lead'?'#manualSyncText':voice==='parallel'?'#manualSyncParallelText':'#manualSyncBackingText').fill('Intro phrase\nOutro phrase!');
      await page.locator('#editManualLyrics').tap();
      assert.equal(await page.evaluate(()=>manualSyncState.pendingBackingEnd),true,'Editing a started final phrase retains the pending end');
      assert.equal(await page.evaluate(()=>manualSyncState.nextIndex),1);
      await mark(18);assert.equal(await page.evaluate(()=>manualSyncState.finished),true);
      await page.locator('#syncUndo').tap();assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[10,15]);
      assert.equal(await page.evaluate(()=>manualSyncState.pendingBackingEnd),true,'Undo removes the end without removing its start');
      await page.locator('#syncUndo').tap();assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[10]);
      await mark(15.2);await mark(18.2);await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
      assert.deepEqual(song.lyricVoices[voice].map(row=>[row.time,row.end]),[[10000,12000],[15200,18200]]);
      for(const track of model.tracks)if(track!==voice)assert.deepEqual(song.lyricVoices[track],otherVoices[track]);
    }
    // Brackets inside Voice 2 gate just the selected words in a shared phrase.
    await page.evaluate(()=>{
      const make=(id)=>({id,text:'look through my eyes',time:1000,end:5000,words:['look','through','my','eyes'].map((word,index)=>({word,index,start:index+1,end:index+2}))});
      current.lyricVoices={version:1,lead:[make('lead-overlap')],parallel:[make('v2-overlap')],backing:[]};
      Object.assign(current,VoxStageLyrics.project(current.lyricVoices));current.playbackTracks=null;current.wordByWordEnabled=true;
      __markTime=1.5;openManualLineSync();setManualSyncFocus('parallel');$('manualSyncParallelText').value='look through [my eyes]';
    });
    const leadBeforeMask=await page.evaluate(()=>structuredClone(current.lyricVoices.lead));
    await page.locator('#saveManualSync').tap();await page.waitForFunction(()=>manualSyncState===null);
    assert.deepEqual(song.lyricVoices.lead,leadBeforeMask);
    assert.deepEqual(song.lyricVoices.parallel[0].activeWordIndices,[2,3]);
    assert.equal(song.lyricVoices.parallel[0].text,'look through my eyes');
    await page.evaluate(()=>{updateLyrics(1.5);});assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false,'The prefix gets no Voice 2 marker');
    await page.evaluate(()=>{updateLyrics(3.5);});
    assert.equal(await page.locator('#lyricCurrentLine .voices-active').textContent(),'my');
    assert.equal(await page.locator('#lyricParallelWordMarker i').isVisible(),false,'Shared active word gets a single dot');
    assert.equal(await page.locator('#lyricWordMarker').evaluate(node=>node.classList.contains('paired')),true);
    assert.equal(await page.locator('#lyricCurrentLine .voice2-active').count(),1);
    await page.evaluate(()=>{updateLyrics(4.5);});assert.equal(await page.locator('#lyricCurrentLine .voices-active').textContent(),'eyes');
    await page.evaluate(()=>openManualLineSync());await page.locator('[data-sync-focus="parallel"]').tap();
    assert.equal(await page.locator('#manualSyncParallelText').inputValue(),'look through [my eyes]','Selected words survive saving and reopening');
    await page.evaluate(async()=>{setManualSyncMode('word');await startManualSync();pausePlayback();});
    assert.deepEqual(await page.evaluate(()=>manualSyncState.queue.map(entry=>[entry.wordIndex,entry.word])),[[2,'my'],[3,'eyes']],'Manual word sync only asks for the bracketed words');
    assert.deepEqual(await page.evaluate(()=>VoxStageScoreHost.lyricCues(0,10).filter(cue=>cue.voice==='parallel').map(cue=>cue.text)),['my','eyes'],'Scoring lyrics also exclude the inactive context words');
    await mark(3.2);await mark(4.1);await mark(5.1);await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
    assert.equal(song.lyricVoices.parallel[0].time,3200);assert.equal(song.lyricVoices.parallel[0].end,5100);
    assert.deepEqual(song.lyricVoices.parallel[0].words.filter(cue=>cue.index>=2).map(cue=>[cue.start,cue.end]),[[3.2,4.1],[4.1,5.1]]);
    assert.deepEqual(song.lyricVoices.lead,leadBeforeMask);
    await page.evaluate(()=>{openManualLineSync();setManualSyncFocus('parallel');$('manualSyncParallelText').value='look through my eyes';});
    await page.locator('#saveManualSync').tap();await page.waitForFunction(()=>manualSyncState===null);
    assert.equal(song.lyricVoices.parallel[0].activeWordIndices,undefined,'No brackets means the entire Voice 2 phrase');
    await page.evaluate(()=>updateLyrics(1.5));assert.equal(await page.locator('#lyricCurrentLine .voices-active').textContent(),'look');
    // Save another voice while line/word recording retains every pending mark.
    for(const mode of ['line','word'])for(const recordingVoice of model.tracks){
      song={...song,...model.storage(voices)};
      const baseline=structuredClone(song.lyricVoices),beforePosts=posts;
      await page.evaluate(async({baseline,mode,recordingVoice})=>{
        Object.assign(current,VoxStageLyrics.project(baseline),{lyricVoices:baseline,lyricIndex:null,playbackTracks:null});
        __markTime=19;playing=false;openManualLineSync();setManualSyncFocus(recordingVoice);setManualSyncMode(mode);await startManualSync();pausePlayback();
      },{baseline,mode,recordingVoice});
      await mark(20);
      await page.locator('#syncEdit').tap();
      assert.equal(await page.locator('#manualSyncFocusRow button:disabled').count(),0,'Paused editor allows switching every voice');
      const snapshot=await page.evaluate(()=>JSON.stringify(manualSyncState));
      const editorId=recordingVoice==='lead'?'manualSyncText':recordingVoice==='parallel'?'manualSyncParallelText':'manualSyncBackingText';
      await page.locator('#'+editorId).fill((await page.locator('#'+editorId).inputValue())+'!');
      const otherVoices=model.tracks.filter(voice=>voice!==recordingVoice);
      for(const [index,other] of otherVoices.entries()){
        await page.locator(`[data-sync-focus="${other}"]`).tap();
        const otherEditor=other==='lead'?'manualSyncText':other==='parallel'?'manualSyncParallelText':'manualSyncBackingText';
        await page.locator('#'+otherEditor).fill('Prepared '+other+' lyrics');
        assert.equal(await page.locator('#saveManualSync').isEnabled(),true);
        assert.match(await page.locator('#editManualLyrics').textContent(),/Retomar sync/);
        if(mode==='word'&&recordingVoice==='lead'&&index===0){
          await page.route('**/api/library',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Simulated write failure'}}):route.continue());
          await page.locator('#saveManualSync').tap();await page.waitForFunction(()=>!manualVoiceSavePending);
          assert.equal(posts,beforePosts,'Failed saves cannot persist the paused timing buffer');
          assert.equal(await page.locator('#'+otherEditor).inputValue(),'Prepared '+other+' lyrics');
          assert.equal(await page.evaluate(()=>JSON.stringify(manualSyncState)),snapshot,'A write failure leaves the pending sync intact');
          await page.unroute('**/api/library');
        }
        await page.locator('#saveManualSync').tap();await page.waitForFunction(()=>!manualVoiceSavePending);
        assert.equal(await page.locator('#manualSyncDialog').isVisible(),true,'Saving another voice keeps the editor open');
        assert.equal(await page.evaluate(()=>JSON.stringify(manualSyncState)),snapshot,'Saving text cannot change the active recording state');
        assert.equal(song.lyricVoices[other][0].text,'Prepared '+other+' lyrics');
        assert.deepEqual(song.lyricVoices[recordingVoice],baseline[recordingVoice],'The recording voice and its unsaved text stay out of another voice save');
        assert.equal(await page.evaluate(()=>manualSyncFocus),other);
      }
      assert.equal(posts,beforePosts+2);
      const prepared=structuredClone(song.lyricVoices);
      await page.locator('#editManualLyrics').tap();
      assert.equal(await page.locator('#manualSyncDialog').isVisible(),false);
      assert.equal(await page.evaluate(()=>manualSyncFocus),recordingVoice,'Return always restores the voice that was recording');
      assert.equal(await page.evaluate(()=>manualSyncState.focus),recordingVoice);
      assert.deepEqual(await page.evaluate(()=>manualSyncState.times),[20],'Return preserves the pending first onset');
      assert.equal(await page.evaluate(()=>manualSyncState.mode),mode);
      if(mode==='word'){
        await mark(20.7);await mark(21.4);await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
        assert.equal(song.lyricVoices[recordingVoice][0].words[0].start,20,'Recorded timing saves onto its original voice');
        for(const other of otherVoices)assert.deepEqual(song.lyricVoices[other],prepared[other],'Finishing sync retains separately saved lyrics');
      }else{
        assert.equal(await page.evaluate(()=>manualSyncState.pendingBackingEnd),true,'The pending line end survives editing another voice');
        await page.locator('#syncCancel').tap();
        assert.deepEqual(song.lyricVoices,prepared,'Cancelling discards active marks without undoing other voice saves');
      }
      await page.evaluate(()=>openManualLineSync());
      for(const other of otherVoices){await page.locator(`[data-sync-focus="${other}"]`).tap();assert.equal(await page.locator(other==='lead'?'#manualSyncText':other==='parallel'?'#manualSyncParallelText':'#manualSyncBackingText').inputValue(),'Prepared '+other+' lyrics');}
      await page.locator('#closeManualSync').tap();
    }
    for(const track of model.tracks){
      const phrase={id:'hyphen-'+track,text:'caçado-o-or agora',time:1000,end:5000,words:[{word:'caçado-o-or',index:0,start:1,end:4},{word:'agora',index:1,start:4,end:5}]};
      const chart=model.normalize({[track]:[phrase]});
      song={...song,...model.storage(chart)};
      await page.evaluate(({chart})=>{
        Object.assign(current,VoxStageLyrics.project(chart),{lyricVoices:chart,lyricIndex:null,playbackTracks:null,wordByWordEnabled:true});
        processingSettings.showUpcomingWordPreview=false;window.__previewPreference=localStorage.getItem('voxstage-processing-settings');updateLyrics(1.3);
      },{chart});
      const host=track==='lead'?'#lyricCurrentLine':track==='parallel'?'#lyricSecondLine':'#lyricBackingLine';
      assert.equal(await page.locator(host+' .active').textContent(),'caçado');
      assert.equal(await page.locator(host+' .upcoming').textContent(),'o','The next hyphen part is forced on while singing the group');
      assert.match(await page.locator(host).textContent(),/caçado-o-or agora/,'Hyphens stay in the rendered lyrics');
      await page.evaluate(()=>updateLyrics(2.3));assert.equal(await page.locator(host+' .upcoming').textContent(),'or');
      await page.evaluate(()=>updateLyrics(3.3));assert.equal(await page.locator(host+' .upcoming').count(),0,'Preview stops at the final hyphen part');
      await page.evaluate(()=>updateLyrics(4.3));assert.equal(await page.locator(host+' .active').textContent(),'agora');assert.equal(await page.locator(host+' .upcoming').count(),0);
      assert.equal(await page.evaluate(()=>processingSettings.showUpcomingWordPreview),false);
      assert.equal(await page.evaluate(()=>localStorage.getItem('voxstage-processing-settings')===window.__previewPreference),true,'Temporary preview does not write preferences');
      await page.evaluate(async track=>{__markTime=9;playing=false;openManualLineSync();setManualSyncFocus(track);setManualSyncMode('word');await startManualSync();pausePlayback();},track);
      assert.deepEqual(await page.evaluate(()=>manualSyncState.queue.map(entry=>entry.word)),['caçado','o','or','agora'],'Each part gets its own sync step');
      for(const time of [10,11,12,13,14])await mark(time);
      await page.locator('#syncSave').tap();await page.waitForFunction(()=>manualSyncState===null);
      assert.deepEqual(song.lyricVoices[track][0].words.map(cue=>[cue.word,cue.start,cue.end]),[['caçado',10,11],['o',11,12],['or',12,13],['agora',13,14]]);
      await page.evaluate(()=>openManualLineSync());await page.locator(`[data-sync-focus="${track}"]`).tap();
      assert.equal(await page.locator(track==='lead'?'#manualSyncText':track==='parallel'?'#manualSyncParallelText':'#manualSyncBackingText').inputValue(),'caçado-o-or agora');
      await page.locator('#closeManualSync').tap();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS sync: explicit first onset, late Voice 2, every line start/end, final end, undo/edit boundaries, blank-line pauses, partial save, independent voices, partial overlap brackets, scoring text masks, cancellation recovery and saving other voice tabs during line/word sync (including failed writes), hyphen sync and temporary next-part previews across all voices.');
  }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
