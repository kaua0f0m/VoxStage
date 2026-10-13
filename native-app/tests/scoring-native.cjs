/* Smoke test a running packaged WebView2 exposed on local CDP port 9229.
 * The launcher supplies an isolated profile/data dir and a fake microphone. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const artifacts=path.resolve(__dirname,'../test-results');
async function main(){
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline){try{const response=await fetch('http://127.0.0.1:9229/json/version');if(response.ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,'Packaged WebView2 did not expose its diagnostic endpoint');
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
  try{
    const context=browser.contexts()[0],page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:8000'))||context.pages()[0];
    // CDP can become available while WebView2 is still on its initial blank page.
    await page.waitForURL('http://127.0.0.1:8000/**',{waitUntil:'domcontentloaded',timeout:30000});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',wav=fs.readFileSync(path.join(artifacts,'score-mic-tone.wav'));
    await page.route('**/api/library',route=>route.fulfill({json:[{id,title:'Pontuação 1.1 · teste nativo',inst:'native-inst.wav',lead:'native-lead.wav',plainLyrics:'Cante uma nota'}]}));
    await page.route('**/music/native-*.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
    await page.route('https://lrclib.net/**',route=>route.fulfill({json:[]}));
    await page.addInitScript(()=>localStorage.setItem('voxstage-onboarding-hidden','1'));
    await page.reload();
    try { await page.waitForFunction(()=>window.VoxStageScoring); }
    catch(error) {
      console.error('Native startup diagnostics', {url:page.url(),errors,state:await page.evaluate(()=>({ready:document.readyState,text:document.body?.innerText?.slice(0,1500),host:typeof window.VoxStageScoreHost,ui:window.__voxstageUiReady,build:window.VoxStageBuildInfo}))});
      await page.screenshot({path:path.join(artifacts,'native-startup-error.png')});throw error;
    }
    await page.evaluate(()=>{
      const original=startAudioSources;
      startAudioSources=(...args)=>{original(...args);if(current?.engine?.output){current.engine.output.gain.cancelScheduledValues(audioContext.currentTime);current.engine.output.gain.setValueAtTime(0,audioContext.currentTime);}};
    });
    await page.evaluate(async()=>{await VoxStageScoreHost.ensureAudio();});
    assert.equal(await page.evaluate(()=>typeof window.__TAURI__?.core?.invoke),'function','This must be the native shell');
    assert.equal(await page.evaluate(async()=>(await VoxStageScoreHost.api('/api/build-mode')).debug),false,'Packaged app uses the release backend');
    await page.evaluate(()=>settingsDialog.classList.add('show'));
    assert.equal(await page.locator('#settingsTabDebug').isVisible(),false,'Stable hides diagnostic controls');
    assert.equal(await page.locator('#settingsPanePlayback #scoreOpenSettings, #settingsPanePlayback .playback-transform').count(),0);
    await page.evaluate(()=>selectSettingsTab('debug'));
    assert.equal(await page.locator('#settingsTabPlayback').getAttribute('aria-selected'),'true');
    await page.screenshot({path:path.join(artifacts,'stable-playback-settings.png')});
    await page.locator('#settingsTabAbout').click();
    const openedLinks=[];
    await page.route('**/api/about/open-link',route=>{openedLinks.push(route.request().postDataJSON().url);return route.fulfill({json:{opened:true}});});
    for(const url of ['https://github.com/kaua0f0m','https://www.youtube.com/@funkyblackcat']) {
      const response=page.waitForResponse(response=>response.url().endsWith('/api/about/open-link'));
      await page.locator(`.about-app a[href="${url}"]`).click();await response;
    }
    assert.deepEqual(openedLinks,['https://github.com/kaua0f0m','https://www.youtube.com/@funkyblackcat']);
    await page.evaluate(()=>settingsDialog.classList.remove('show'));
    await page.evaluate(async id=>{await playSong(id);pausePlayback();},id);await page.waitForFunction(()=>current?.buffers?.Lead);
    await page.evaluate(()=>{pausePlayback();VoxStageScoring.open();});
    await page.locator('#scoreStart').click();await page.waitForFunction(()=>VoxStageScoring.snapshot().armed,null,{timeout:60000});
    await page.evaluate(()=>{startAudioSources(0);current.engine.output.gain.cancelScheduledValues(audioContext.currentTime);current.engine.output.gain.setValueAtTime(0,audioContext.currentTime);});await page.waitForFunction(()=>VoxStageScoring.snapshot().result.seconds>=11);
    const snapshot=await page.evaluate(()=>VoxStageScoring.snapshot());
    assert.equal(snapshot.result.points,1000,JSON.stringify(snapshot.result));assert.ok(snapshot.hasStream);
    assert.equal(await page.locator('#scoreDialog').evaluate(node=>node.open),false);
    const expectedVersion=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../package.json'),'utf8')).version;
    assert.equal(await page.evaluate(()=>VoxStageBuildInfo.version),expectedVersion);
    assert.equal(await page.evaluate(()=>VoxStageBuildInfo.label),expectedVersion);
    assert.equal(await page.evaluate(()=>['sequence','buildId','builtAt'].some(key=>key in VoxStageBuildInfo)),false,'Internal build metadata is absent from the shipped app');
    await page.screenshot({path:path.join(artifacts,'scoring-native.png')});
    await page.evaluate(()=>{pausePlayback();VoxStageScoring.stop();});
    assert.equal(await page.evaluate(()=>VoxStageScoring.snapshot().hasStream),false);
    assert.deepEqual(errors,[]);
    console.log('PASS packaged native WebView2: bundled worker/worklet/styles, Tauri shell, fake mic, pitch score and microphone release.');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
