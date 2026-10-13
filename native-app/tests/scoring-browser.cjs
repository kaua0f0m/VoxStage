const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');
fs.mkdirSync(artifacts,{recursive:true});
function wav(frequency,duration=16,stereo=false){
  const rate=48000,channels=stereo?2:1,frames=rate*duration,out=Buffer.alloc(44+frames*channels*2);
  out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(channels,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*channels*2,28);out.writeUInt16LE(channels*2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(out.length-44,40);
  for(let i=0;i<frames;i++){
    const value=frequency?Math.round(6000*(Math.sin(2*Math.PI*frequency*i/rate)+.2*Math.sin(4*Math.PI*frequency*i/rate))):0;
    out.writeInt16LE(value,44+i*channels*2);if(stereo)out.writeInt16LE(-value,44+i*channels*2+2);
  }return out;
}
const song={id:'cccccccc-cccc-cccc-cccc-cccccccccccc',title:'Teste de afinação',artist:'VoxStage',inst:'inst.wav',lead:'lead.wav',plainLyrics:'Cante uma nota\nOutra frase',syncedLyrics:'[00:00.00]Cante uma nota\n[00:08.00]Outra frase',wordTimings:[{lineIndex:0,words:[{word:'Cante',start:0,end:2},{word:'uma',start:2,end:4},{word:'nota',start:4,end:7}]}]},complete={id:'dddddddd-dddd-dddd-dddd-dddddddddddd',title:'Sem vocal',source:'inst.wav'};
const lead=wav(440,16,true),inst=wav(0);
const micTone=path.join(artifacts,'score-mic-tone.wav'),micSilence=path.join(artifacts,'score-mic-silence.wav');
fs.writeFileSync(micTone,wav(440,30));fs.writeFileSync(micSilence,wav(0,30));
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/library'?[song,complete]:url.pathname==='/api/mvsep/config'?{configured:false}:{}));return;}
  if(url.pathname.startsWith('/music/')){res.setHeader('Content-Type','audio/wav');res.end(url.pathname.includes('lead')?lead:inst);return;}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(error?'Not found':data);});
});
async function session(origin,microphone,run){
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${microphone}`]});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:820}});await context.grantPermissions(['microphone'],{origin});
    await context.addInitScript(()=>{
      localStorage.setItem('voxstage-onboarding-hidden','1'); window.__referenceWorkers=0;
      window.Worker=new Proxy(window.Worker,{construct(target,args){if(String(args[0]).includes('pitch-worker'))window.__referenceWorkers++;return Reflect.construct(target,args);}});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://lrclib.net/**',route=>route.fulfill({json:[]}));
    await page.goto(origin);await page.waitForFunction(()=>window.VoxStageScoring);
    await page.locator(`[data-play="${song.id}"]`).click();await page.waitForFunction(()=>current?.buffers?.Lead);
    await page.evaluate(()=>{startAudioSources(7);pausePlayback();VoxStageScoring.open();});
    await page.locator('#scoreStart').click();await page.waitForFunction(()=>VoxStageScoring.snapshot().armed,null,{timeout:60000});
    await page.waitForFunction(()=>playing && playbackBase===0);
    assert.ok(await page.evaluate(()=>playbackPosition())<2,'Activating scoring rewinds and plays automatically');
    assert.equal(await page.locator('#scoreDialog').evaluate(node=>node.open),false,'Starting closes the scoring dialog');
    await page.evaluate(()=>VoxStageScoring.open());
    await run(page);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    await session(origin,micTone,async page=>{
      const prepared=await page.evaluate(()=>VoxStageScoring.snapshot());
      assert.ok(prepared.reference.frequencies.filter(f=>f>0).length>300,'Opposite stereo phases retain a reference');
      assert.equal(prepared.reference.version,5);
      assert.equal(prepared.reference.tracks[0].notes.length,1,'A sustained vocal becomes a single horizontal bar');
      assert.equal(prepared.reference.tracks[0].notes[0].midi,69);
      await page.evaluate(()=>startAudioSources(0));
      await page.waitForFunction(()=>VoxStageScoring.snapshot().result.seconds>=6);
      let result=await page.evaluate(()=>VoxStageScoring.snapshot());
      assert.equal(result.result.points,1000,JSON.stringify(result.result));assert.equal(result.result.hitNotes,1);assert.ok(result.lastDetected.confidence>.85);
      assert.ok(Math.abs(result.displayFrequency-440)<5,'The smoothed microphone indicator follows the captured pitch');
      assert.match(await page.locator('#scoreReferenceSummary').textContent(),/1 barra/);
      await page.evaluate(()=>VoxStageScoring.open());
      await page.screenshot({path:path.join(artifacts,'scoring-panel.png')});
      await page.locator('#scoreClose').click();
      await page.evaluate(()=>pausePlayback());const frozen=await page.evaluate(()=>VoxStageScoring.snapshot().result.frames);
      await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().result.frames),frozen);
      await page.evaluate(async()=>{await setPlaybackTransform(1.25,4);startAudioSources(5);});
      await page.waitForFunction(()=>VoxStageScoring.snapshot().lastExpected?.frequency>550);
      await page.waitForFunction(()=>playbackPosition()>8.3);result=await page.evaluate(()=>VoxStageScoring.snapshot());
      assert.equal(result.result.points,1000,'Wrong pitch never removes an earned note');
      assert.ok(result.result.pitchAccuracy<95,'Diagnostics still identify a wrong pitch');
      await page.evaluate(()=>{display.classList.add('show');document.getElementById('scoreDialog').close();});
      assert.equal(await page.locator('#scoreOverlay').isVisible(),true);
      await page.waitForFunction(()=>document.getElementById('scoreGraph').dataset.cursorRatio==='.12');
      assert.ok(await page.locator('#scoreOverlay').evaluate(node=>node.getBoundingClientRect().width)>1100,'The highway spans the top of the stage');
      assert.equal(await page.locator('#scoreLaneLyrics').isVisible(),false,'Extra lyrics are off by default');
      assert.doesNotMatch(await page.locator('#scoreOverlayNotes').textContent(),/cents|Lá|dB/,'Stage readout stays simple');
      await page.evaluate(()=>{window.__originalStageLyrics=document.getElementById('lyrics');VoxStageScoring.open();});
      await page.locator('#scoreLaneLyricsToggle').check();
      await page.locator('#scoreClose').click();
      await page.evaluate(()=>startAudioSources(0));
      await page.waitForFunction(()=>document.querySelector('#scoreLaneLyrics .score-lane-word'));
      assert.equal(await page.locator('#scoreLaneLyrics').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.getElementById('lyrics')===window.__originalStageLyrics && document.getElementById('lyrics').textContent.includes('Cante')),true,'Optional lane lyrics preserve the original stage lyrics');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('voxstage-score-settings')).laneLyrics),true);
      await page.evaluate(()=>{window.__timedLyrics=current.lyricLines;current.lyricLines=[];});
      await page.waitForFunction(()=>document.getElementById('scoreLaneLyrics').classList.contains('score-lyrics-empty'));
      assert.ok(await page.locator('#scoreLaneLyrics').evaluate(node=>node.getBoundingClientRect().height)<=48,'Missing lyric timings do not expand the optional lyric row');
      await page.evaluate(()=>{current.lyricLines=window.__timedLyrics;});
      const cues=await page.evaluate(()=>{
        current.lyricAdjustments={0:{offsetMs:500,speed:1.25}};
        current.profanityMarks=[{lineIndex:0,wordIndex:1,word:'uma'}];processingSettings.markProfanity=true;
        return VoxStageScoreHost.lyricCues(0,12);
      });
      assert.equal(cues.find(cue=>cue.text==='uma').start,3);
      assert.equal(cues.find(cue=>cue.text==='uma').censored,true);
      assert.equal(cues.find(cue=>cue.text==='Outra frase').line,true,'Line-only lyrics are shown without invented word timestamps');
      await page.evaluate(()=>{startAudioSources(2);});
      await page.waitForFunction(()=>document.querySelector('#scoreLaneLyrics .censored')?.textContent==='•••');
      assert.equal(await page.locator('#scoreLaneLyrics .censored').getAttribute('title'),null,'Censored words are not exposed in extra lyric tooltips');
      await page.evaluate(()=>{current.lyricAdjustments={};current.profanityMarks=[];processingSettings.markProfanity=false;});
      assert.ok(await page.locator('#scoreOpen').evaluate(node=>node.getBoundingClientRect().width)<110);
      assert.ok(await page.locator('.playback-transform-compact').evaluate(node=>node.getBoundingClientRect().height)<40);
      assert.equal(await page.locator('[data-speed-open]').count(),1);
      assert.equal(await page.locator('#scoreOpen').evaluate(node=>node.parentElement.classList.contains('display-transport')),true);
      assert.equal(await page.locator('.playback-transform-compact').evaluate(node=>node.parentElement.classList.contains('display-transport')),true);
      await page.evaluate(()=>setStageControlsHidden(false));
      await page.locator('[data-speed-open]').click();
      assert.equal(await page.locator('.playback-transform-popup').isVisible(),true);
      await page.locator('[data-speed-open]').click();
      assert.equal(await page.locator('.playback-transform-popup').isVisible(),false);
      await page.screenshot({path:path.join(artifacts,'scoring-stage.png')});
      await page.setViewportSize({width:900,height:540});await page.waitForTimeout(200);
      const layout=await page.evaluate(()=>{const a=document.getElementById('scoreOverlay').getBoundingClientRect(),b=document.getElementById('lyrics').getBoundingClientRect(),c=document.querySelector('.display-bottom').getBoundingClientRect();return{laneBottom:a.bottom,lyricTop:b.top,lyricBottom:b.bottom,controlsTop:c.top,right:a.right,width:innerWidth};});
      assert.ok(layout.lyricTop>=layout.laneBottom,'The highway does not cover the existing stage lyrics in a short window');
      assert.ok(layout.lyricBottom<=layout.controlsTop,'Wrapped controls do not cover the existing stage lyrics');
      assert.ok(layout.right<=layout.width);
      await page.screenshot({path:path.join(artifacts,'scoring-stage-small.png')});
      await page.setViewportSize({width:1280,height:820});
      await page.evaluate(()=>VoxStageScoring.open());await page.locator('#scoreLaneLyricsToggle').uncheck();await page.locator('#scoreOverlayToggle').uncheck();
      await page.locator('#scoreClose').click();
      assert.equal(await page.locator('#scoreOverlay').isVisible(),false);
      assert.equal(await page.locator('#lyrics').isVisible(),true);
      assert.equal(await page.evaluate(()=>display.classList.contains('score-lane-active')),false,'Hiding the highway restores stage spacing');
      await page.evaluate(()=>VoxStageScoring.open());await page.locator('#scoreOverlayToggle').check();await page.locator('#scoreClose').click();
      await page.evaluate(()=>finishPlayback());
      await page.waitForFunction(()=>!VoxStageScoring.snapshot().hasStream);
      assert.equal(await page.locator('#scoreDialog').evaluate(node=>node.open),true);
      assert.ok(await page.evaluate(()=>VoxStageScoring.snapshot().lastResult.points>=0));
      await page.evaluate(()=>{document.getElementById('scoreDialog').close();display.classList.remove('show');});
      await page.locator(`[data-play="${complete.id}"]`).click();await page.waitForFunction(()=>current?.id==='dddddddd-dddd-dddd-dddd-dddddddddddd'&&current?.buffers?.Inst);
      await page.evaluate(()=>{pausePlayback();VoxStageScoring.open();});await page.locator('#scoreStart').click();
      await page.waitForFunction(()=>!VoxStageScoring.snapshot().preparing);
      assert.match(await page.locator('#scoreStatus').textContent(),/não tem esse stem vocal/);
      assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().hasStream),false);
      await page.evaluate(()=>document.getElementById('scoreDialog').close());
      await page.locator(`[data-play="${song.id}"]`).click();await page.waitForFunction(()=>current?.buffers?.Lead);
      await page.evaluate(()=>{
        pausePlayback();VoxStageScoring.open();window.__originalGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));
      });
      const workersBefore=await page.evaluate(()=>window.__referenceWorkers);
      await page.locator('#scoreStart').click();await page.waitForFunction(()=>document.getElementById('scoreStatus').textContent.includes('negado'));
      assert.equal(await page.evaluate(()=>window.__referenceWorkers),workersBefore+1,'Cached reference starts only the live worker, without another analysis worker');
      assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().hasStream),false);
      await page.evaluate(()=>{
        navigator.mediaDevices.getUserMedia=async constraints=>{
          const acquired=await window.__originalGetUserMedia(constraints);window.__delayedScoreStream=acquired;
          await new Promise(resolve=>setTimeout(resolve,900));return acquired;
        };
      });
      await page.locator('#scoreStart').click();await page.waitForFunction(()=>window.__delayedScoreStream);
      await page.locator('#scoreStart').click();await page.waitForFunction(()=>window.__delayedScoreStream.getTracks().every(track=>track.readyState==='ended'));
      assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().hasStream),false,'Cancel stops a late microphone grant');
      await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.__originalGetUserMedia;document.getElementById('scoreDialog').close();});
      await page.evaluate(async()=>{await document.documentElement.requestFullscreen();VoxStageScoring.open();});
      assert.equal(await page.evaluate(()=>document.getElementById('scoreDialog').parentElement===document.fullscreenElement),true);
      await page.evaluate(()=>{document.getElementById('scoreDialog').close();document.exitFullscreen();});
      await page.evaluate(async()=>{
        pausePlayback();await setPlaybackTransform(1,0);
        const duration=12,rate=audioContext.sampleRate;
        const stem=(frequency,begin,end)=>{const buffer=audioContext.createBuffer(1,rate*duration,rate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++){const time=i/rate;if(time>=begin&&time<end)data[i]=.2*Math.sin(2*Math.PI*frequency*time);}return buffer;};
        current.buffers={Inst:stem(277,0,12),Lead:stem(440,0,3),Back:stem(660,3,6)};
        startAudioSources(8);pausePlayback();VoxStageScoring.open();
      });
      await page.locator('#scoreReference').selectOption('Vocals');await page.locator('#scoreStart').click();
      await page.waitForFunction(()=>VoxStageScoring.snapshot().armed && playing && playbackBase===0);
      let combined=await page.evaluate(()=>{const r=VoxStageScoring.snapshot().reference;return{mode:r.mode,tracks:r.tracks.map(t=>t.id),back:VoxStagePitch.referenceAt(r,4),missing:VoxStagePitch.referenceAt(r,7)};});
      assert.equal(combined.mode,'Vocals');assert.deepEqual(combined.tracks,['Lead','Back']);assert.equal(combined.back.track,'Back');assert.equal(combined.missing,null);
      await page.evaluate(()=>{VoxStageScoring.stop();VoxStageScoring.open();});
      await page.locator('#scoreReference').selectOption('All');await page.locator('#scoreStart').click();
      await page.waitForFunction(()=>VoxStageScoring.snapshot().armed && playing && playbackBase===0);
      combined=await page.evaluate(()=>{const r=VoxStageScoring.snapshot().reference;return{mode:r.mode,tracks:r.tracks.map(t=>t.id),back:VoxStagePitch.referenceAt(r,4),fallback:VoxStagePitch.referenceAt(r,7)};});
      assert.equal(combined.mode,'All');assert.deepEqual(combined.tracks,['Lead','Back','Inst']);assert.equal(combined.back.track,'Back');assert.equal(combined.fallback.track,'Inst');
      await page.evaluate(()=>{startAudioSources(5);pausePlayback();});
      await page.evaluate(()=>VoxStageScoring.open());
      await page.locator('#scoreReset').click();
      await page.waitForFunction(()=>playing && playbackBase===0);
      assert.ok(await page.evaluate(()=>VoxStageScoring.snapshot().result.seconds)<1,'New attempt restarts and clears prior scores');
      await page.evaluate(()=>{VoxStageScoring.stop();VoxStageScoring.open();});
      await page.evaluate(()=>{
        pausePlayback();
        const rate=audioContext.sampleRate,buffer=audioContext.createBuffer(1,rate*12,rate),samples=buffer.getChannelData(0);
        let phase=0;
        for(let i=0;i<samples.length;i++) {
          const time=i/rate,note=time<2?69+.6*Math.sin(2*Math.PI*5*time):time<3?71:time<3.16?72:time<4?76:time<4.24?null:time<8?69:null;
          if(note!==null){phase+=2*Math.PI*VoxStagePitch.frequencyForNote(note)/rate;samples[i]=.2*Math.sin(phase);}
        }
        current.buffers.Lead=buffer;delete current.buffers.Back;
      });
      await page.locator('#scoreReference').selectOption('Lead');await page.locator('#scoreStart').click();
      await page.waitForFunction(()=>VoxStageScoring.snapshot().armed);
      const bars=await page.evaluate(()=>{
        const r=VoxStageScoring.snapshot().reference;return{notes:r.tracks[0].notes,rest:VoxStagePitch.referenceAt(r,4.12)};
      });
      assert.equal(bars.notes[0].midi,69);
      assert.ok(bars.notes[0].end>1.8,'Actual vibrato audio becomes a sustained bar');
      assert.ok([71,72,76].every(note=>bars.notes.some(bar=>bar.midi===note)),'The worker preserves real note changes and a short note');
      assert.equal(bars.rest,null,'A breath in the waveform remains unscored');
      await page.evaluate(()=>startAudioSources(2));await page.waitForTimeout(250);
      await page.evaluate(()=>{display.classList.add('show');document.getElementById('scoreDialog').close();});
      await page.waitForFunction(()=>Number(document.getElementById('scoreGraph').dataset.connectors)>=2);
      await page.screenshot({path:path.join(artifacts,'scoring-note-bars.png')});
      await page.evaluate(()=>{VoxStageScoring.stop();VoxStageScoring.open();});
    });
    await session(origin,micSilence,async page=>{
      await page.evaluate(()=>startAudioSources(0));await page.waitForFunction(()=>VoxStageScoring.snapshot().result.seconds>=2.1);
      const result=await page.evaluate(()=>VoxStageScoring.snapshot().result);assert.equal(result.points,0);assert.equal(result.coverage,0);
      assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().displayFrequency),0);
      await page.evaluate(()=>{VoxStageScoring.stop();VoxStageScoring.open();});assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().hasStream),false);
    });
    console.log('PASS scoring browser: reference/stereo/cache, real capture worklet with fake mic, accuracy/silence, pause, speed/transpose, graph/result, microphone denied/late cancellation/release, missing vocal and fullscreen.');
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
