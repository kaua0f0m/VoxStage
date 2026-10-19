const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{server,library}=require('./menu-shell.cjs');
Object.assign(library[2],{source:'silent.wav',inst:null,lead:null,back:null,separationStatus:'pending'});
const out=path.resolve(__dirname,'../test-results/ui-feedback');fs.mkdirSync(out,{recursive:true});
async function fits(page,selector){const r=await page.locator(selector).boundingBox(),v=page.viewportSize();assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,selector+' fits '+JSON.stringify({r,v}));return r;}
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{for(const [device,width,height]of [['pc',1440,900],['phone',390,844],['tv',1280,720]]){
  const context=await browser.newContext({viewport:{width,height},...(device!=='pc'?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'}:{})});context.setDefaultTimeout(10000);
  await context.route('https://fonts.googleapis.com/**',r=>r.abort());await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  await context.addInitScript(({device,library})=>{
   window.__nativeCalls=[];window.__savedTestKey=false;
   if(device!=='pc'){
    window.VoxStageMedia={isTelevision:()=>device==='tv',setOrientation:()=>{},update:()=>{},clear:()=>{},exitToLauncher:()=>{window.__launcher=true;}};
    window.__TAURI__={core:{convertFileSrc:n=>'/music/'+n.split('/').pop(),invoke:async(command,args)=>{
     window.__nativeCalls.push(command);if(command==='mobile_get_music_dir')return '/music';if(command==='mobile_get_library')return library;if(command==='mobile_mvsep_models')return [];
     if(command==='mobile_mvsep_save_config'){window.__savedTestKey=true;return {configured:true};}if(command==='mobile_mvsep_get_config')return {configured:window.__savedTestKey};
     if(command==='mobile_tv_host_api'){if(args.path.endsWith('requests')||args.path.endsWith('transfers'))return [];if(args.path.endsWith('commands'))return {commands:[]};return {url:'http://192.168.1.5/remote#12345678901234567890123456789012'};}return {};
    }}};
   }
  },{device,library});
  const page=await context.newPage(),errors=[],installRequests=[];page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(/\/api\/(?:local(?:-audio|\/)|align(?:\/|$)|setup\/)/.test(r.url()))installRequests.push(r.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageStageReady);await page.evaluate(()=>document.fonts.ready);
  if(device==='tv'){
   await page.waitForFunction(()=>VoxStageMenu.page==='connection');await fits(page,'#menuConnectionPage');assert.equal(await page.locator('#remotePanel').evaluate(n=>getComputedStyle(n).position),'static');assert.equal(await page.locator('.remote-card').getAttribute('role'),'region');assert.equal(await page.locator('#setupWizard').count(),0);await page.waitForFunction(()=>$('remoteUrl').textContent.startsWith('http'));
   await page.screenshot({path:path.join(out,'tv-start-connect.png')});await page.evaluate(()=>voxstageBack());assert.equal(await page.evaluate(()=>VoxStageMenu.page),null);assert.equal(await page.locator('#menuTvHero').isVisible(),true);await page.locator('#syncPcLibrary').click();assert.equal(await page.locator('#menuConnectionPage').isVisible(),true);await page.locator('#menuLibrary').focus();await page.evaluate(()=>voxstageTvKey('Enter'));assert.equal(await page.evaluate(()=>VoxStageMenu.page),null,'TV connection page does not trap navigation');
  }else{
   await page.locator('#setupWizard.show').waitFor();await fits(page,'.welcome-card');await page.screenshot({path:path.join(out,device+'-welcome.png')});
   await page.locator('#setupWizardNext').click();assert.equal(await page.locator('[data-welcome-step="1"]').isVisible(),true);await page.locator('#mobileMvsepHelp').click();assert.equal(await page.evaluate(()=>!mvsepHelpDialog.hidden),true);await page.evaluate(()=>closeMvsepKeyHelp());
   if(device==='pc')await page.evaluate(()=>{const prior=api;api=async(url,opts)=>url==='/api/mvsep/config'&&opts?.method==='POST'?(window.__savedTestKey=true,{configured:true}):url==='/api/mvsep/config'?{configured:window.__savedTestKey}:prior(url,opts);});
   await page.locator('#mobileMvsepToken').fill('fixture-api-key-not-a-real-token');await page.locator('#mobileSaveMvsep').click();await page.waitForFunction(()=>$('mobileMvsepToken').value===''&&window.__savedTestKey);await fits(page,'.welcome-footer');
   await page.screenshot({path:path.join(out,device+'-welcome-key.png')});await page.locator('#setupWizardNext').click();assert.equal(await page.locator('[data-welcome-step="2"]').isVisible(),true);assert.match(await page.locator('.welcome-tip').textContent(),/fones/);
   assert.equal(await page.locator('#setupResources,[data-settings-tab="local"],[data-local-separate],#openSetupWizard').count(),0,'Local processing and installers are removed');
   await page.locator('#setupWizardBack').click();assert.equal(await page.locator('[data-welcome-step="1"]').isVisible(),true);await page.locator('#setupWizardNext').click();await page.locator('#setupWizardNext').click();assert.equal(await page.locator('#setupWizard').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('voxstage-onboarding-hidden')),'1');assert.deepEqual(installRequests,[],'Onboarding never starts an installation automatically');
   await page.reload();await page.waitForFunction(()=>window.__voxstageStageReady);await page.waitForTimeout(750);assert.equal(await page.locator('#setupWizard').isVisible(),false);
   await page.locator('#settingsTop').click();await page.locator(device==='phone'?'[data-settings-topic="visual"]':'#settingsTabVisual').click();
   assert.equal(await page.locator('[data-settings-tab="lyrics"],[data-settings-topic="lyrics"]').count(),0,'One appearance page');
   for(const id of ['interfaceTheme','voice2Color','voicesOverlapGradient','lyricsScale','lyricsFont','interfaceFont'])assert.equal(await page.locator('#'+id).isVisible(),true,id+' is in Visual');
   assert.equal(await page.locator('#lyricsFont option').count(),6);await page.locator('#interfaceFont').selectOption('dm-sans');await page.locator('#lyricsFont').selectOption('nunito-light');await page.evaluate(()=>document.fonts.ready);
   assert.match(await page.locator('body').evaluate(n=>getComputedStyle(n).fontFamily),/DM Sans/);assert.equal(await page.locator('#lyrics').evaluate(n=>getComputedStyle(n).fontWeight),'300');
   for(const [key,family]of [['nunito','Nunito'],['manrope','Manrope'],['dm-sans','DM Sans'],['outfit','Outfit'],['rubik','Rubik']]){await page.locator('#lyricsFont').selectOption(key);assert.match(await page.locator('#lyrics').evaluate(n=>getComputedStyle(n).fontFamily),new RegExp(family));assert.equal(await page.evaluate(family=>document.fonts.load(`500 24px "${family}"`).then(fonts=>fonts.length>0),family),true,'Font is locally available');}
   await page.locator('#lyricsFont').selectOption('nunito');await page.screenshot({path:path.join(out,device+'-visual.png')});await page.locator('#saveProcessing').click();
   if(device==='phone'){await page.locator('#syncPcLibrary').click();assert.equal(await page.locator('#menuPhoneConnectionPage').isVisible(),true);assert.equal(await page.locator('#pcSyncDialog').evaluate(n=>getComputedStyle(n).position),'static');assert.equal(await page.locator('#pcSyncDialog>.modal').getAttribute('role'),'region');await page.screenshot({path:path.join(out,'phone-connect.png')});await page.evaluate(()=>voxstageBack());assert.equal(await page.evaluate(()=>VoxStageMenu.page),null);assert.equal(await page.locator('#pcSyncDialog').isVisible(),false);}
   if(device==='pc'){
    await page.evaluate(()=>{songs=Array.from({length:50},(_,i)=>({...songs[i%8],id:'long-library-'+i}));render();window.scrollTo(0,document.body.scrollHeight);});
    for(const [w,h]of [[1440,900],[850,560]]){await page.setViewportSize({width:w,height:h});await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));for(const selector of ['#openUsageGuide','#settingsTop']){const r=await fits(page,selector);assert.equal(await page.locator(selector).evaluate(n=>Boolean(n.closest('.menu-sidebar-bottom'))),true);const player=await page.locator('.player').boundingBox();assert.ok(r.y+r.height<=player.y,'Utilities stay above player');}}
    await page.locator('#openUsageGuide').click();assert.equal(await page.locator('#usageGuide').evaluate(n=>n.open),true);await page.locator('#reopenOnboarding').click();assert.equal(await page.locator('#setupWizard').isVisible(),true);assert.equal(await page.locator('[data-welcome-step="0"]').isVisible(),true);await page.locator('#setupWizardClose').click();await page.setViewportSize({width,height});await page.evaluate(()=>{songs=window.__baseLibrary||songs;});
    await page.reload();await page.waitForFunction(()=>window.__voxstageStageReady);assert.equal(await page.locator('#interfaceFont').inputValue(),'dm-sans');assert.equal(await page.locator('#lyricsFont').inputValue(),'nunito');
    await page.evaluate(async id=>{await playSong(id);pausePlayback();seek(30);},library[0].id);await page.screenshot({path:path.join(out,'pc-player.png')});
    await page.evaluate(()=>{$('display').classList.add('show');setStageControlsHidden(false);});await page.locator('#mobileControlsToggle').click();
    assert.notEqual(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Manual hide keeps the cursor visible on click');
    await page.waitForTimeout(4200);assert.notEqual(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Manual cursor waits five seconds even over the hide button');
    await page.waitForTimeout(1100);assert.equal(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Manual hide also hides an idle cursor');
    await page.mouse.move(20,300);assert.notEqual(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Moving restores only the cursor in manual mode');await page.keyboard.press('Shift');assert.equal(await page.locator('.palco-panel').isVisible(),false,'Mouse and keyboard cannot undo manual hide');
    await page.waitForTimeout(4200);assert.notEqual(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Activity restarts the cursor countdown');await page.waitForTimeout(1100);assert.equal(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Cursor hides again after five idle seconds');
    await page.locator('#mobileControlsToggle').click();await page.mouse.move(20,300);await page.waitForTimeout(5300);assert.equal(await page.locator('.palco-panel').isVisible(),true,'Manual show is independent of idle timer');
    await page.locator('#quickExitDisplay').click();await page.evaluate(()=>{$('display').classList.add('show');});await page.mouse.move(24,300);await page.waitForTimeout(5300);assert.equal(await page.locator('.palco-panel').isVisible(),false,'Automatic mode resumes on the next presentation');
    for(const selector of ['#display','#lyrics','#quickExitDisplay'])assert.equal(await page.locator(selector).evaluate(n=>getComputedStyle(n).cursor),'none','Idle hides the cursor throughout the stage');
    await page.mouse.move(25,301);assert.equal(await page.locator('.palco-panel').isVisible(),true,'Mouse still restores automatic controls');assert.notEqual(await page.locator('#display').evaluate(n=>getComputedStyle(n).cursor),'none','Movement restores the cursor');
    await page.locator('#quickExitDisplay').click();assert.notEqual(await page.locator('body').evaluate(n=>getComputedStyle(n).cursor),'none','Leaving the stage restores the cursor');
   }
  }
  if(device!=='phone'){await page.evaluate(()=>{$('display').classList.add('show');setStageControlsHidden(false);});await page.locator('#scoreOpen').click();await page.locator('#scoreConnectPhone').click();assert.equal(await page.locator('#display').isVisible(),false);assert.equal(await page.locator('#menuConnectionPage').isVisible(),true);assert.equal(await page.locator('#remotePanel').evaluate(n=>getComputedStyle(n).position),'static');assert.equal(await page.locator('.remote-card').getAttribute('role'),'region');await page.evaluate(()=>voxstageBack());}
  assert.deepEqual(installRequests,[],'Retired processing endpoints are never requested');assert.deepEqual(errors,[]);console.log('PASS '+device+': onboarding, connection navigation, combined appearance, offline fonts and feedback controls');await context.close();
 }}finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
