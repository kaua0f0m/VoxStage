/* Smoke test a running packaged WebView2 exposed on local CDP port 9229.
 * The launcher supplies an isolated profile/data dir and a fake microphone. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const artifacts=path.resolve(__dirname,'../test-results');
const debugBuild=process.env.VOXSTAGE_EXPECT_DEBUG==='1';
async function main(){
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline){try{const response=await fetch('http://127.0.0.1:9229/json/version');if(response.ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,'Packaged WebView2 did not expose its diagnostic endpoint');
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
  try{
    const context=browser.contexts()[0],page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:8000'))||context.pages()[0];
    // CDP can become available while WebView2 is still on its initial blank page.
    await page.waitForURL('http://127.0.0.1:8000/**',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__voxstageUiReady,null,{timeout:30000});
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
    assert.ok(new URL(page.url()).searchParams.get('launch'),'Each native launch must request a fresh entry page');
    assert.equal(await page.evaluate(()=>typeof window.VoxStageLyrics?.extractLegacy),'function','The independent lyric model must be bundled');
    // Desktop HTTP pages use the backend build-mode API; native IPC stays restricted to local app origins.
    assert.equal(await page.evaluate(async()=>(await VoxStageScoreHost.api('/api/build-mode')).debug),debugBuild,'Packaged backend must match the requested build mode');
    await page.waitForFunction(expected=>nativeDebugBuild===expected,debugBuild);
    await page.evaluate(()=>settingsDialog.classList.add('show'));
    assert.equal(await page.locator('#settingsTabDebug').isVisible(),debugBuild,'Only debug builds show diagnostic controls');
    assert.equal(await page.locator('#settingsPanePlayback #scoreOpenSettings, #settingsPanePlayback .playback-transform').count(),0);
    await page.evaluate(()=>selectSettingsTab('debug'));
    assert.equal(await page.locator(debugBuild?'#settingsTabDebug':'#settingsTabPlayback').getAttribute('aria-selected'),'true');
    await page.screenshot({path:path.join(artifacts,'stable-playback-settings.png')});
    await page.locator('#settingsTabLyrics').click();
    assert.equal(await page.locator('#voice2Color').isVisible(),true,'Packaged native preferences expose voice colors');
    assert.equal(await page.locator('#settingsPaneLyrics button').count(),0,'The global lyrics tab needs only preferences and a text notice');
    assert.match(await page.locator('#settingsPaneLyrics [role="note"]').textContent(),/cada música/);
    assert.equal(await page.locator('#artworkProvider').inputValue(),'itunes','The package searches Apple by default; Archive is opt-in');
    assert.equal(await page.locator('#artworkArchiveSearch').textContent(),'Não encontrou seu resultado? Pesquise no Cover Art');
    assert.equal(await page.locator('#artworkProvider option[value="all"], #artworkProvider option[value="archive"]').count(),0);
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/app.js');return response.headers.get('Cache-Control');}),'no-store','Private builds must not reuse stale UI scripts');
    await page.screenshot({path:path.join(artifacts,'lyrics-settings-native.png')});
    await page.evaluate(()=>selectSettingsTab('data'));
    assert.equal(await page.locator('#exportLibrary').isVisible(),true,'The packaged app exposes full library export');
    assert.equal(await page.locator('#importLibrary').isVisible(),true);
    const emptyBackup=await page.evaluate(()=>api('/api/archives/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferences:{'voxstage-language':'pt-BR'}})}));
    assert.equal(emptyBackup.songs,0,'The real packaged backend can export an empty isolated test library');
    const downloadedBackup=await page.evaluate(async url=>{const response=await fetch(url);return {status:response.status,bytes:(await response.arrayBuffer()).byteLength};},emptyBackup.downloadUrl);
    assert.equal(downloadedBackup.status,200);assert.ok(downloadedBackup.bytes>100);
    await page.evaluate(()=>openUsageGuide('sync'));
    assert.equal(await page.locator('#usageGuide').isVisible(),true,'The real package contains the usage guide');
    assert.match(await page.locator('#usageGuide-sync').textContent(),/linha vazia/i);
    assert.match(await page.locator('#usageGuide-errors').textContent(),/503/);
    assert.match(await page.locator('#usageGuide-scoring aside').textContent(),/fone de ouvido/);
    await page.locator('#closeUsageGuide').click();

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
    await page.evaluate(()=>{pausePlayback();openManualLineSync();});
    await page.locator('[data-sync-focus="parallel"]').click();
    assert.equal(await page.locator('.voice-editor:visible').count(),1,'The native editor shows one voice at a time');
    assert.equal(await page.locator('#manualSyncParallelText').isVisible(),true);
    assert.ok(await page.locator('#manualSyncParallelText').evaluate(node=>node.clientWidth>500),'The native text field uses the available width');
    assert.equal(await page.locator('#syncCensorTool').getAttribute('open'),null,'Advanced tools start collapsed');
    await page.screenshot({path:path.join(artifacts,'lyrics-editor-native.png')});
    await page.locator('#closeManualSync').click();
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
