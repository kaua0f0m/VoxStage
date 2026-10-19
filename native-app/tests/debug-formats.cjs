const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{server,library}=require('./menu-shell.cjs');
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
  for(const native of [false,true]){
   const context=await browser.newContext({viewport:{width:1440,height:900},...(native?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});
   await context.route('**/api/build-mode',r=>r.fulfill({json:{debug:true}}));
   await context.addInitScript(({native,library})=>{
    localStorage.setItem('voxstage-onboarding-hidden','1');
    if(!native)window.__TAURI__={core:{invoke:async()=>{throw new Error('Native debug command unavailable in desktop shell');}}};
    if(native){window.VoxStageMedia={isTelevision:()=>false,setOrientation:()=>{},update:()=>{},clear:()=>{}};window.__TAURI__={core:{convertFileSrc:n=>'/music/'+n.split('/').pop(),invoke:async(command,args)=>{
     if(command==='is_debug_build')return true;if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library')return library;if(command==='mobile_mvsep_models')return [];
     if(command==='mobile_tv_host_api'){if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];if(args.path.endsWith('commands'))return {commands:[]};return {url:'http://192.168.1.5/remote#12345678901234567890123456789012'};}return {};
    }}};}
   },{native,library});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageStageReady);
   for(const format of ['tv','phone','pc','auto']){
    if(await page.evaluate(()=>VoxStageMenu.device==='tv')){await page.waitForFunction(()=>VoxStageMenu.page==='connection');await page.evaluate(()=>voxstageBack());}
    await page.locator('#settingsTop').click();
    await page.locator(await page.evaluate(()=>VoxStageMenu.device==='phone')?'[data-settings-topic="debug"]':'#settingsTabDebug').click();
    await page.locator('#debugInterfaceFormat').selectOption(format);
    await page.waitForTimeout(700);assert.equal(await page.locator('#debugInterfaceFormat').inputValue(),format,'Selection survives before applying');
    await Promise.all([page.waitForEvent('load'),page.locator('#debugApplyInterfaceFormat').click()]);await page.waitForFunction(()=>window.__voxstageStageReady);
    const expected=format==='auto'?(native?'phone':'pc'):format;
    assert.equal(await page.locator('body').getAttribute('data-menu-device'),expected);
    assert.equal(await page.locator('#display').getAttribute('data-stage-device'),expected);
    assert.equal(await page.evaluate(()=>mobileNative),native,'Layout never changes the real backend');
    assert.equal(await page.evaluate(()=>VoxStageScoreHost.tv),expected==='tv');
    assert.equal(await page.evaluate(()=>VoxStageScoreHost.mobile),expected!=='pc');
    assert.equal(await page.evaluate(()=>typeof window.voxstageTvKey==='function'),expected==='tv','D-pad follows TV format');
    assert.equal(await page.evaluate(()=>localStorage.getItem('voxstage-debug-format')),format==='auto'?null:format);
    assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('mobile-native-app')),expected!=='pc');
    await page.evaluate(async id=>{await playSong(id);pausePlayback();$('display').classList.add('show');setStageControlsHidden(false);},library[0].id);
    assert.equal(await page.locator('#dispPlay').isVisible(),true);
    assert.equal(await page.locator('#lyricSync').count(),1);
    assert.equal(await page.locator('#stageMoreOpen').count(),expected==='pc'?0:1);
    if(expected==='pc')assert.equal(await page.locator('#mobileStageMode').isVisible(),false);
    if(expected==='tv')assert.equal(await page.locator('#mobileStageMode').getAttribute('aria-pressed'),'true','TV uses its cover toggle');
    await page.locator('#quickExitDisplay').click();
   }
   assert.deepEqual(errors,[]);console.log('PASS format switch: '+(native?'native Android backend':'PC backend'));await context.close();
  }
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.route('**/api/build-mode',r=>r.fulfill({json:{debug:false}}));
  await context.addInitScript(()=>{localStorage.setItem('voxstage-onboarding-hidden','1');localStorage.setItem('voxstage-debug-format','tv');});
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageStageReady);
  assert.equal(await page.locator('body').getAttribute('data-menu-device'),'pc','Stable ignores a saved debug format');
  await page.locator('#settingsTop').click();assert.equal(await page.locator('#settingsTabDebug').isVisible(),false);console.log('PASS stable build ignores debug overrides');await context.close();
 }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
