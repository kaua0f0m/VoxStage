const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');
const data=fs.mkdtempSync(path.join(artifacts,'rc-platforms-'));assert.ok(data.startsWith(artifacts+path.sep));
const token='rc-test-peer-token-12345678901234567890';
function wav(vocal){const rate=48000,frames=rate*8,out=Buffer.alloc(44+frames*2);out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(out.length-44,40);for(let i=0;i<frames;i++)out.writeInt16LE(vocal?Math.round(.2*32767*Math.sin(2*Math.PI*(i/rate<4?440:660)*i/rate)):0,44+i*2);return out;}
const song={id:'11111111-1111-4111-8111-111111111111',title:'Canto RC',artist:'VoxStage',inst:'22222222-2222-4222-8222-222222222222.wav',lead:'33333333-3333-4333-8333-333333333333.wav',syncedLyrics:'[00:00.00]Cante uma nota\n[00:04.00]Outro tom',plainLyrics:'Cante uma nota\nOutro tom'};
fs.mkdirSync(path.join(data,'music'));fs.writeFileSync(path.join(data,'music',song.inst),wav(false));fs.writeFileSync(path.join(data,'music',song.lead),wav(true));fs.writeFileSync(path.join(data,'library.json'),JSON.stringify([song]));
async function setup(context,{mobile=false,tv=false}={}){
  await context.addInitScript(({song,mobile,tv,token})=>{
    localStorage.setItem('voxstage-onboarding-hidden','1');window.__micStopped=0;window.__micFrequency=440;window.__micTimer=0;window.__micDenied=false;
    if(!mobile)return;
    window.VoxStageMedia={isTelevision:()=>tv,setOrientation:()=>{},update:()=>{}};
    window.VoxStageNativeMic={stop(){clearInterval(window.__micTimer);window.__micTimer=0;window.__micStopped++;},start(id){
      if(window.__micDenied){setTimeout(()=>window.dispatchEvent(new CustomEvent('voxstage-native-microphone',{detail:{id,type:'error',message:'Permissão negada'}})),10);return;}
      setTimeout(()=>{
        window.dispatchEvent(new CustomEvent('voxstage-native-microphone',{detail:{id,type:'ready',sampleRate:16000}}));
        window.__micTimer=setInterval(()=>{const bytes=new Uint8Array(2048),view=new DataView(bytes.buffer);for(let i=0;i<1024;i++)view.setInt16(i*2,Math.round(.2*32767*Math.sin(2*Math.PI*window.__micFrequency*i/16000)),true);window.dispatchEvent(new CustomEvent('voxstage-native-microphone',{detail:{id,type:'frame',sampleRate:16000,ageMs:32,pcm:btoa(String.fromCharCode(...bytes))}}));},64);
      },10);
    }};
    window.__TAURI__={core:{convertFileSrc:name=>'/music/'+name.split('/').pop(),invoke:async(command,args)=>{
      if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library'||command==='mobile_get_pc_library')return [song];
      if(command==='mobile_mvsep_get_config')return {configured:false};if(command==='mobile_mvsep_models')return {models:[]};
      if(command==='mobile_tv_host_api'){
        if(args.path.endsWith('host-info'))return {url:location.origin+'/remote#'+token,hostType:'tv'};
        const response=await fetch(args.path,{method:args.method,headers:{'Content-Type':'application/json'},body:args.body?JSON.stringify(args.body):undefined});return response.json();
      }
      if(command==='mobile_remote_microphone'||command==='mobile_remote_state'){
        const response=await fetch(args.baseUrl+(command==='mobile_remote_state'?'/api/remote/state':'/api/remote/microphone'),{method:args.body?'POST':'GET',headers:{Authorization:'Bearer '+args.token,'Content-Type':'application/json'},body:args.body?JSON.stringify(args.body):undefined});
        const body=await response.json();if(!response.ok)throw new Error(body.error);return body;
      }
      return {};
    }}};
  },{song,mobile,tv,token});
}
async function pageFor(browser,origin,options={}){
  const context=await browser.newContext({viewport:options.viewport||{width:1280,height:820},...(options.mobile?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'}:{})});
  await setup(context,options);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/remote/')||url.pathname==='/api/library')return route.continue();return route.fulfill({json:{models:[],configured:false}});});
  await page.route('https://lrclib.net/**',route=>route.fulfill({json:[]}));await page.goto(origin);await page.waitForFunction(()=>window.VoxStageScoring);
  if(options.tv){await page.waitForFunction(()=>remotePanel.classList.contains('show'));await page.evaluate(()=>closeRemotePanel());}
  return {context,page,errors};
}
async function selectSong(page){await page.evaluate(async id=>{await playSong(id);pausePlayback();VoxStageScoring.open();},song.id);await page.waitForFunction(()=>current?.buffers?.Lead);}
async function verifyPerformanceRow(page){
  const rects=await page.evaluate(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,width:r.width,height:r.height};};
    return {speed:rect(document.querySelector('[data-speed-open]')),score:rect(document.getElementById('scoreOpen')),controls:rect(document.querySelector('.stage-control-panel'))};
  });
  assert.ok(Math.abs(rects.speed.top-rects.score.top)<2,JSON.stringify(rects));
  assert.ok(rects.speed.width<180&&rects.score.width<150,'Performance buttons have intrinsic widths');
  assert.ok(rects.speed.right<=rects.score.left&&rects.score.right<=rects.controls.right,JSON.stringify(rects));
}
async function verifyTransformPopup(page,open=true){
  if(open)await page.locator('[data-speed-open]').click();await page.locator('#playbackTransformPopup').waitFor({state:'visible'});
  const layout=await page.evaluate(()=>{
    const popup=document.getElementById('playbackTransformPopup'),r=popup.getBoundingClientRect(),bar=document.querySelector('.stage-control-panel').getBoundingClientRect();
    return {bottom:r.bottom,barTop:bar.top,left:r.left,right:r.right,width:innerWidth,visible:popup.contains(document.elementFromPoint(r.left+30,r.top+30))};
  });
  assert.ok(layout.bottom<=layout.barTop-8,JSON.stringify(layout));assert.ok(layout.left>=8&&layout.right<=layout.width-8,JSON.stringify(layout));assert.ok(layout.visible,'Popup is above stage controls and receives input');
}
async function main(){
  const fixture=spawn('py',['-3.13',path.join(__dirname,'phone-fixture.py')],{cwd:root,env:{...process.env,VOXSTAGE_DATA_DIR:data},stdio:['ignore','pipe','pipe']});let browser;let stderr='';fixture.stderr.on('data',chunk=>stderr+=chunk);
  try {
    const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Fixture did not start: '+stderr)),15000);fixture.once('exit',code=>reject(new Error('Fixture exited '+code+' '+stderr)));fixture.stdout.once('data',chunk=>{clearTimeout(timeout);resolve(Number(String(chunk).trim()));});});
    const origin=`http://127.0.0.1:${port}`;browser=await chromium.launch({headless:true,channel:'msedge',args:['--mute-audio']});
    const vertical=await pageFor(browser,origin,{mobile:true,viewport:{width:390,height:844}});const mobile=vertical.page;
    await selectSong(mobile);assert.equal(await mobile.locator('#scoreLaneLyricsToggle').isDisabled(),false,'Portrait permits line-only lyrics');
    await mobile.locator('#scoreStart').click();await mobile.waitForFunction(()=>VoxStageScoring.snapshot().armed);assert.equal(await mobile.locator('#scoreDialog').evaluate(node=>node.open),false);
    await mobile.waitForFunction(()=>VoxStageScoring.snapshot().lastDetected?.frequency>400);
    await mobile.evaluate(()=>VoxStageScoring.open());
    assert.equal(await mobile.locator('#scoreNoise').isDisabled(),false,'Noise filter is adjustable without restarting scoring');
    assert.equal(await mobile.locator('#scoreNoise').getAttribute('min'),'-80');assert.equal(await mobile.locator('#scoreNoise').getAttribute('max'),'-6');
    await mobile.locator('#scoreNoise').fill('-12');
    await mobile.waitForFunction(()=>VoxStageScoring.snapshot().lastDetected?.rms>0&&VoxStageScoring.snapshot().lastDetected?.frequency===0);
    assert.match(await mobile.locator('#scoreNoiseLive').textContent(),/abaixo do filtro/);
    await mobile.locator('#scoreNoise').fill('-65');await mobile.waitForFunction(()=>VoxStageScoring.snapshot().lastDetected?.frequency>400);
    assert.match(await mobile.locator('.score-headphone-advice').textContent(),/encobrir sua voz/);
    await mobile.locator('#scoreClose').click();
    await mobile.evaluate(()=>{pausePlayback();setStageControlsHidden(false);});await verifyPerformanceRow(mobile);
    assert.equal(await mobile.locator('#lyrics').evaluate(node=>node.parentElement.id),'scoreLaneLyrics');
    assert.equal(await mobile.locator('#lyricCurrentLine').count(),1,'Portrait moves the existing lyric view, without duplicates');
    assert.ok(await mobile.locator('#scoreGraph').evaluate(node=>node.getBoundingClientRect().height)<110);
    await mobile.screenshot({path:path.join(artifacts,'rc-android-portrait.png')});
    console.log('PREVIEW portrait ready:',path.join(artifacts,'rc-android-portrait.png'));
    await mobile.locator('#mobileMixToggle').click();await verifyTransformPopup(mobile);
    assert.equal(await mobile.locator('.stage-control-panel').evaluate(node=>node.classList.contains('mix-open')),false,'Transform dismisses mixer');
    await mobile.screenshot({path:path.join(artifacts,'rc-android-transform-popup.png')});
    await mobile.locator('[data-speed-open]').click();
    await mobile.setViewportSize({width:320,height:568});await mobile.evaluate(()=>setStageControlsHidden(false));await verifyPerformanceRow(mobile);await verifyTransformPopup(mobile);
    await mobile.setViewportSize({width:844,height:390});await mobile.waitForFunction(()=>!display.classList.contains('score-lane-portrait'));
    await verifyTransformPopup(mobile,false);await mobile.locator('[data-speed-open]').click();
    await mobile.evaluate(()=>VoxStageScoring.open());assert.equal(await mobile.locator('#scoreLaneLyricsToggle').isDisabled(),true,'Landscape requires word timings');
    await mobile.evaluate(()=>current.backingWordTimings=[{lineIndex:0,words:[{word:'Cante',start:0,end:1}]}]);
    await mobile.waitForFunction(()=>!document.getElementById('scoreLaneLyricsToggle').disabled);
    await mobile.evaluate(()=>current.backingWordTimings=[]);
    await mobile.waitForFunction(()=>document.getElementById('scoreLaneLyricsToggle').disabled);
    await mobile.locator('#scoreClose').click();assert.equal(await mobile.locator('#lyrics').evaluate(node=>node.parentElement.className),'display-content');
    await mobile.evaluate(()=>setStageControlsHidden(false));await verifyPerformanceRow(mobile);await verifyTransformPopup(mobile);await mobile.locator('[data-speed-open]').click();
    assert.equal(await mobile.locator('#scoreLaneLyrics').isVisible(),false);
    assert.ok(await mobile.locator('#scoreGraph').evaluate(node=>node.getBoundingClientRect().height)<80);
    await mobile.waitForFunction(()=>lyrics.getBoundingClientRect().top>=document.getElementById('scoreOverlay').getBoundingClientRect().bottom);
    await mobile.screenshot({path:path.join(artifacts,'rc-android-landscape.png')});
    for(const viewport of [{width:640,height:360},{width:560,height:280},{width:844,height:390}]){
      await mobile.setViewportSize(viewport);await mobile.evaluate(()=>setStageControlsHidden(true));
      await mobile.waitForTimeout(200);
      const room=await mobile.evaluate(()=>{const lane=scoreOverlay.getBoundingClientRect(),text=lyrics.getBoundingClientRect(),toggle=mobileControlsToggle.getBoundingClientRect();return{laneHeight:lane.height,laneBottom:lane.bottom,textTop:text.top,textHeight:text.height,screenHeight:innerHeight,toggleRight:toggle.right,laneLeft:lane.left};});
      assert.ok(room.laneHeight<viewport.height*.30,JSON.stringify(room));
      assert.ok(room.textHeight>=40&&room.textTop>=room.laneBottom&&room.textTop+room.textHeight<=viewport.height-8,JSON.stringify(room));
      assert.ok(room.toggleRight<room.laneLeft,JSON.stringify(room));
      await mobile.locator('#lyrics').click();await mobile.waitForFunction(()=>playing);
      await mobile.locator('#lyrics').click();await mobile.waitForFunction(()=>!playing);
      assert.equal(await mobile.evaluate(()=>VoxStageScoring.snapshot().armed),true,'Touch pause preserves scoring session');
      await mobile.locator('#mobileControlsToggle').click();
      assert.equal(await mobile.evaluate(()=>display.classList.contains('mobile-controls-hidden')),false,'Transport can always be restored');
    }
    await mobile.evaluate(()=>setStageControlsHidden(true));
    await mobile.screenshot({path:path.join(artifacts,'1.1.1-android-landscape-compact.png')});
    await mobile.evaluate(()=>{VoxStageScoring.stop();VoxStageScoring.open();window.__micDenied=true;});
    await mobile.locator('#scoreStart').click();await mobile.waitForFunction(()=>!VoxStageScoring.snapshot().preparing);assert.equal(await mobile.evaluate(()=>VoxStageScoring.snapshot().armed),false);
    assert.match(await mobile.locator('#scoreStatus').textContent(),/negada|cancelada/);assert.ok(await mobile.evaluate(()=>window.__micStopped)>0);
    assert.deepEqual(vertical.errors,[]);await vertical.context.close();
    const television=await pageFor(browser,origin,{mobile:true,tv:true,viewport:{width:1280,height:720}});const tv=television.page;
    await selectSong(tv);assert.equal(await tv.locator('#scoreLaneLyricsToggle').isDisabled(),true);await tv.locator('#scoreDevice').selectOption('');await tv.locator('#scoreStart').click();await tv.waitForFunction(()=>VoxStageScoring.snapshot().armed);
    await tv.waitForFunction(()=>VoxStageScoring.snapshot().lastDetected?.frequency>400);
    await tv.evaluate(()=>{pausePlayback();setStageControlsHidden(false);});await verifyPerformanceRow(tv);
    await verifyTransformPopup(tv);
    await tv.evaluate(()=>window.voxstageTvKey('ArrowRight'));
    assert.equal(await tv.locator('#playbackTransformPopup [data-playback-speed]').inputValue(),'1.05','D-pad adjusts speed');
    await tv.waitForFunction(()=>playbackSpeed===1.05);
    await tv.evaluate(()=>window.voxstageTvKey('Back'));assert.equal(await tv.locator('#playbackTransformPopup').isVisible(),false);assert.equal(await tv.locator('#display').evaluate(node=>node.classList.contains('show')),true,'Back closes popup instead of exiting stage');
    await tv.evaluate(()=>{current.wordTimings=[{lineIndex:0,words:[{word:'Cante',start:0,end:1},{word:'uma',start:1,end:2},{word:'nota',start:2,end:3}]}];VoxStageScoring.open();});
    await tv.waitForFunction(()=>!document.getElementById('scoreLaneLyricsToggle').disabled);await tv.locator('#scoreLaneLyricsToggle').check();await tv.locator('#scoreClose').click();
    await tv.evaluate(()=>{const image=document.getElementById('mobileStageArtwork');image.hidden=false;image.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%23262832"/></svg>';display.classList.add('tv-cover-visible');});
    await tv.waitForFunction(()=>document.getElementById('mobileStageArtwork').naturalWidth>0);
    for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:960,height:540}]){
      await tv.setViewportSize(viewport);await tv.waitForTimeout(200);
      const room=await tv.evaluate(()=>{const lane=document.getElementById('scoreOverlay').getBoundingClientRect(),bar=document.querySelector('.stage-control-panel').getBoundingClientRect(),text=lyrics.getBoundingClientRect();return{laneHeight:lane.height,controlsHeight:bar.height,textTop:text.top,textBottom:text.bottom,laneBottom:lane.bottom,barTop:bar.top,height:innerHeight};});
      assert.ok(room.controlsHeight<room.height*.23,JSON.stringify(room));assert.ok(room.laneHeight<room.height*.33,JSON.stringify(room));assert.ok(room.textTop>=room.laneBottom&&room.textBottom<=room.barTop,JSON.stringify(room));
    }
    await tv.setViewportSize({width:1280,height:720});await tv.evaluate(()=>setStageControlsHidden(false));
    await tv.screenshot({path:path.join(artifacts,'rc-tv-stage.png')});await tv.evaluate(()=>VoxStageScoring.open());await tv.evaluate(()=>window.voxstageTvKey('Back'));await tv.waitForFunction(()=>!document.getElementById('scoreDialog').open);
    await tv.evaluate(()=>VoxStageScoring.stop());assert.deepEqual(television.errors,[]);await television.context.close();
    const desktop=await pageFor(browser,origin);const pc=desktop.page;await selectSong(pc);assert.equal(await pc.locator('#scoreLaneLyricsToggle').isDisabled(),true);
    await pc.locator('#scoreDevice').selectOption('phone');await pc.locator('#scoreStart').click();await pc.waitForFunction(()=>VoxStageScoring.snapshot().preparing);
    const phone=await pageFor(browser,origin,{mobile:true,viewport:{width:390,height:844}});await phone.page.locator('#syncPcLibrary').click();await phone.page.locator('#pcSyncLink').fill(origin+'/remote#'+token);await phone.page.locator('#pcSyncFind').click();await phone.page.waitForFunction(()=>!document.getElementById('pcRemoteControls').hidden);
    await phone.page.locator('#pcUseMicrophone').click();await phone.page.waitForFunction(()=>VoxStagePhoneMicrophone.snapshot().running);await pc.waitForFunction(()=>VoxStageScoring.snapshot().armed,null,{timeout:30000});
    await pc.waitForFunction(()=>VoxStageScoring.snapshot().result.hitNotes>=1);const earned=await pc.evaluate(()=>VoxStageScoring.snapshot().result.points);assert.equal(earned,1000);
    await pc.evaluate(()=>pausePlayback());const frames=await pc.evaluate(()=>VoxStageScoring.snapshot().result.frames);await pc.waitForTimeout(450);assert.equal(await pc.evaluate(()=>VoxStageScoring.snapshot().result.frames),frames,'Phone input does not score while paused');
    await phone.page.evaluate(()=>window.__micFrequency=660);await pc.evaluate(()=>startAudioSources(4.1));
    try { await pc.waitForFunction(()=>VoxStageScoring.snapshot().result.hitNotes===2); }
    catch(error) { console.error('Phone score diagnostics',await pc.evaluate(()=>{const s=VoxStageScoring.snapshot();return{armed:s.armed,result:s.result,lastResult:s.lastResult,lastDetected:s.lastDetected,lastExpected:s.lastExpected,position:playbackPosition()};}),await phone.page.locator('#pcMicrophoneStatus').textContent());throw error; }
    const completed=await pc.evaluate(()=>VoxStageScoring.snapshot().result);assert.equal(completed.points,2000);assert.equal(completed.gold,true);assert.equal(completed.stars,5);
    await pc.screenshot({path:path.join(artifacts,'rc-phone-microphone-pc.png')});
    await pc.evaluate(()=>pausePlayback());await phone.page.evaluate(()=>VoxStagePhoneMicrophone.stop());await pc.waitForFunction(()=>!VoxStageScoring.snapshot().armed,null,{timeout:15000});assert.equal(await pc.evaluate(()=>playing),false,'Losing the phone releases scoring and pauses playback');
    assert.deepEqual(desktop.errors,[]);assert.deepEqual(phone.errors,[]);await desktop.context.close();await phone.context.close();
    console.log('PASS RC platforms: Android native adapter/permission/portrait/rotation; TV dialog navigation; actual Python LAN relay + phone pitch worker + PC scoring, pause/seek/stars/disconnect. All audio muted.');
  }finally{await browser?.close();if(fixture.exitCode===null){const exited=new Promise(resolve=>fixture.once('exit',resolve));fixture.kill();await exited;}fs.rmSync(data,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
