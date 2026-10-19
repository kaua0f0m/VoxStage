const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),readline=require('node:readline');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');
async function main(){
  let python=process.env.PYTHON||path.join(root,'releases/V2.0.0-debug/VoxStage-Windows-x64/app/python/python.exe');
  if(!fs.existsSync(python))python=process.platform==='win32'?'py':'python3';
  const child=spawn(python,[...(python==='py'?['-3.13']:[]),path.join(__dirname,'archive-fixture.py')],{cwd:root,stdio:['pipe','pipe','inherit'],windowsHide:true});
  const fixture=await new Promise((resolve,reject)=>{const lines=readline.createInterface({input:child.stdout});lines.once('line',line=>{lines.close();resolve(JSON.parse(line));});child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('Fixture backend exited: '+code));});});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  const errors=[];
  try{
    const page=await browser.newPage({acceptDownloads:true});page.setDefaultTimeout(15000);page.on('pageerror',error=>{errors.push(error.message);console.error('UI error:',error.message);});
    await page.addInitScript(()=>{localStorage.setItem('voxstage-onboarding-hidden','1');if(!localStorage.getItem('voxstage-processing-settings'))localStorage.setItem('voxstage-processing-settings',JSON.stringify({voice2Color:'#123456',apiToken:'PRIVATE-TEST-KEY'}));localStorage.setItem('voxstage-pc-sync-link','PRIVATE-TEST-PAIRING');});
    console.log('Archive fixture ready.');await page.goto(fixture.origin);await page.waitForFunction(()=>window.__voxstageStageReady);console.log('Archive UI ready.');
    await page.locator('#settingsTop').click();await page.locator('[data-settings-tab="data"]').click();
    assert.equal(await page.locator('#exportLibrary').isVisible(),true);
    await page.locator('#exportLibrary').click();await page.locator('#archiveDownload').waitFor();
    const full=await page.evaluate(()=>structuredClone(archiveExport));
    assert.equal(full.songs,1);assert.equal(full.files,1);
    const downloadEvent=page.waitForEvent('download');await page.locator('#archiveDownload').click();const download=await downloadEvent;
    const downloaded=path.join(artifacts,'library-fixture.voxstage.zip');await download.saveAs(downloaded);
    assert.equal(download.suggestedFilename(),full.filename,'The download preserves the full library or song-specific filename');
    assert.ok(!fs.readFileSync(downloaded).includes(Buffer.from('PRIVATE-TEST-')),'API keys and paired links cannot enter the backup');
    await page.locator('#archiveClose').click();
    // File selection uploads the real downloaded package and obtains a real preview.
    await page.locator('#archiveFileInput').setInputFiles(downloaded);await page.locator('#archiveConfirm').waitFor();
    assert.equal(await page.locator('#archiveReplace').isChecked(),false);
    assert.equal(await page.locator('#archivePreferences').isChecked(),false);
    await page.locator('#archiveConfirm').click();await page.waitForFunction(()=>!archiveBusy);
    assert.match(await page.locator('#archiveStatus').textContent(),/0 nova.*0 atualizada.*1 mantida/);
    let library=JSON.parse(fs.readFileSync(path.join(fixture.dataDir,'library.json'),'utf8'));
    assert.deepEqual(library,[fixture.song]);
    await page.locator('#archiveClose').click();await page.evaluate(()=>settingsDialog.classList.remove('show'));
    await page.locator('[data-menu-toggle]').click();await page.locator('[data-export-song]').click();await page.locator('#archiveDownload').waitFor();
    assert.equal(await page.evaluate(()=>archiveExport.songs),1);
    const singleEvent=page.waitForEvent('download');await page.locator('#archiveDownload').click();const single=await singleEvent;
    const singlePath=path.join(artifacts,'song-fixture.voxstage.zip');await single.saveAs(singlePath);
    await page.locator('#archiveClose').click();
    fs.writeFileSync(path.join(fixture.dataDir,'library.json'),JSON.stringify([{...fixture.song,title:'Mudança local'}]));
    await page.locator('#archiveFileInput').setInputFiles(singlePath);await page.locator('#archiveConfirm').waitFor();
    assert.equal(await page.locator('#archivePreferencesLabel').isVisible(),false,'A single-song export never restores global preferences');
    await page.locator('#archiveReplace').check();await page.locator('#archiveConfirm').click();await page.waitForFunction(()=>!archiveBusy);
    library=JSON.parse(fs.readFileSync(path.join(fixture.dataDir,'library.json'),'utf8'));
    assert.equal(library[0].title,fixture.song.title);assert.deepEqual(library[0].lyricVoices,fixture.song.lyricVoices);
    assert.notEqual(library[0].source,fixture.song.source);assert.equal(fs.readFileSync(path.join(fixture.dataDir,'music',library[0].source),'utf8'),'silent-test-fixture');
    await page.locator('#archiveClose').click();
    await page.locator('#archiveFileInput').setInputFiles({name:'invalid.voxstage.zip',mimeType:'application/zip',buffer:Buffer.from('broken package')});await page.waitForFunction(()=>!archiveBusy);
    assert.match(await page.locator('#archiveStatus').textContent(),/corrompido/);assert.equal(await page.locator('#archiveConfirm').isVisible(),false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.dataDir,'library.json'),'utf8'))[0].title,fixture.song.title);
    await page.locator('#archiveClose').click();
    // Import into an empty library creates a playable entry with all saved lyric data.
    fs.writeFileSync(path.join(fixture.dataDir,'library.json'),'[]');
    await page.locator('#archiveFileInput').setInputFiles(singlePath);await page.locator('#archiveConfirm').waitFor();
    assert.equal(await page.locator('#archiveReplaceLabel').isVisible(),false);
    await page.locator('#archiveConfirm').click();await page.waitForFunction(()=>!archiveBusy);
    assert.match(await page.locator('#archiveStatus').textContent(),/1 nova.*0 atualizada/);
    await page.locator('#archiveClose').click();await page.reload();await page.waitForFunction(()=>window.__voxstageStageReady);
    assert.match(await page.locator('#grid').textContent(),/Backup de teste/);
    await page.evaluate(()=>{const preferences=JSON.parse(localStorage.getItem('voxstage-processing-settings'));preferences.voice2Color='#abcdef';localStorage.setItem('voxstage-processing-settings',JSON.stringify(preferences));});
    await page.locator('#archiveFileInput').setInputFiles(downloaded);await page.locator('#archiveConfirm').waitFor();
    await page.locator('#archivePreferences').check();
    await Promise.all([page.waitForEvent('framenavigated',frame=>frame===page.mainFrame()),page.locator('#archiveConfirm').click()]);
    await page.waitForFunction(()=>window.__voxstageStageReady);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('voxstage-processing-settings')).voice2Color),'#123456','Explicit preference restore survives the interface reload');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('voxstage-processing-settings')).apiToken),undefined);
    assert.equal(await page.evaluate(()=>localStorage.getItem('voxstage-pc-sync-link')),'PRIVATE-TEST-PAIRING','Local pairings are not overwritten by a backup');
    // Narrow phone/TV WebView uses chunked upload + native Android document save.
    let calls=[],saveChecks=0;
    const mobile=await browser.newContext({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'});
    await mobile.exposeFunction('__archiveInvoke',async(command,args={})=>{
      calls.push({command,args});
      if(command==='mobile_get_music_dir')return '/data/files/music';
      if(command==='mobile_get_library')return [fixture.song];
      if(command==='mobile_archive'){
        if(args.action==='export')return {id:full.id,filename:'Mobile.voxstage.zip',songs:1,files:1,bytes:500};
        if(args.action==='save')return {token:'native-save'};
        if(args.action==='save-status')return {state:++saveChecks>1?'done':'waiting'};
        if(args.action==='inspect')return {id:full.id,songs:1,existing:1,new:0,files:1,bytes:500,preferences:false,titles:['Backup de teste']};
        if(args.action==='import')return {added:0,updated:0,skipped:1,preferences:{},ids:[]};
      }
      return {};
    });
    await mobile.addInitScript(()=>{localStorage.setItem('voxstage-onboarding-hidden','1');window.__TAURI__={core:{invoke:(...args)=>window.__archiveInvoke(...args),convertFileSrc:path=>'/fixture-file'}};});
    const phone=await mobile.newPage();phone.on('pageerror',error=>errors.push(error.message));await phone.goto(fixture.origin);await phone.waitForFunction(()=>window.__voxstageStageReady);
    await phone.locator('#settingsTop').click();await phone.locator('[data-settings-topic="data"]').click();
    await phone.locator('#exportLibrary').click();await phone.locator('#archiveDownload').waitFor();await phone.locator('#archiveDownload').click();await phone.waitForFunction(()=>!archiveBusy);
    assert.match(await phone.locator('#archiveStatus').textContent(),/Arquivo salvo/);
    assert.ok(calls.some(call=>call.command==='mobile_archive'&&call.args.action==='save'));
    await phone.locator('#archiveClose').click();await phone.locator('#archiveFileInput').setInputFiles(singlePath);await phone.locator('#archiveConfirm').waitFor();
    assert.ok(calls.some(call=>call.command==='mobile_write_file_chunk'&&call.args.finalChunk),'Mobile import writes the package in bounded native chunks');
    await phone.screenshot({path:path.join(artifacts,'archive-import-mobile.png')});
    assert.ok(await phone.locator('#archiveDialog').evaluate(node=>node.scrollWidth<=node.clientWidth));
    await phone.locator('#archiveConfirm').click();await phone.waitForFunction(()=>!archiveBusy);assert.match(await phone.locator('#archiveStatus').textContent(),/1 mantida/);
    await mobile.close();assert.deepEqual(errors,[]);
    console.log('PASS backup UI: real ZIP download/upload, full + per-song exports, safe duplicate defaults, explicit update, new imports, corruption handling, preserved voices, Android chunks/save bridge and mobile layout.');
  }finally{
    await browser.close();child.stdin.end();
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{if(child.exitCode===null)child.kill();},5000).unref();});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
