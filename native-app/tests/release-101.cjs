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
  fs.readFile(filename,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.ttf')?'font/ttf':'text/html'});res.end(error?'Not found':data)});
});
async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  const errors = [];
  try {
    const desktop = await browser.newContext({viewport:{width:1280,height:820}});
    await desktop.addInitScript(()=>localStorage.setItem('voxstage-onboarding-hidden','1'));
    const page = await desktop.newPage(); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin); await page.waitForFunction(()=>window.__voxstageUiReady);
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
    await page.locator('#titleInput').fill('Capa');
    await page.locator('#artworkSearchOpen').click();
    await page.locator('[data-art-role="both"]').click();
    assert.equal(await page.locator('.artwork-dialog').isVisible(),false);
    await page.waitForFunction(()=>chosenFiles.some(file=>file.role==='cover') && chosenFiles.some(file=>file.role==='background'));
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
    assert.equal(await mobile.locator('[data-settings-tab="local"]').evaluate(node=>node.hidden),true);
    assert.equal(await mobile.locator('.mobile-ytdlp-settings').count(),0);
    assert.equal(await mobile.locator('#syncPcLibrary').textContent(),'▣ Conectar ao VoxStage');
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
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); server.close(); }
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1});
