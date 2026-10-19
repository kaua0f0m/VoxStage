const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(url.pathname==='/api/library'?'[]':'{}');return;}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(error?'Not found':data);});
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  let releaseArchive,mode='delayed',requests=[],downloads=0;
  const errors=[];
  try{
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{localStorage.setItem('voxstage-onboarding-hidden','1');localStorage.setItem('voxstage-artwork-provider-v2','all');});
    await page.route('**/api/covers/search',async route=>{
      const body=route.request().postDataJSON(),{provider,query}=body;assert.ok(!body.artist,'Cover requests must not append or filter by the artist');requests.push(body);
      if(provider==='itunes'&&mode==='apple-empty')return route.fulfill({json:{results:[]}});
      if(provider==='itunes'&&mode==='apple-offline')return route.abort('connectionreset');
      if(provider==='archive'&&mode==='unavailable')return route.fulfill({status:503,json:{error:'Serviço ocupado.',retryAfter:30}});
      if(provider==='archive'&&mode==='empty')return route.fulfill({json:{results:[]}});
      if(provider==='archive')await new Promise(resolve=>releaseArchive=resolve);
      await route.fulfill({json:{results:[{id:provider,title:(provider==='itunes'?'Apple rápida ':'Álbum comunitário ')+query,artist:'Artista',previewUrl:'/branding/voxstage-animated.svg',imageUrl:'https://example.test/'+provider+'.jpg'}]}}).catch(()=>{});
    });
    await page.route('**/api/covers/download',route=>{downloads++;return route.fulfill({json:{name:'selected-cover.jpg'}});});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageUiReady);
    assert.equal(await page.locator('#artworkProvider').inputValue(),'itunes','Old combined preferences migrate to Apple');
    assert.equal(await page.locator('#artworkProvider option[value="all"], #artworkProvider option[value="archive"]').count(),0);
    await page.evaluate(()=>{$('titleInput').value='Teste';$('artistInput').value='Artist that must not filter covers';openArtworkDialog();});
    await page.waitForFunction(()=>!artworkSearchBusy);
    assert.deepEqual(requests.map(item=>item.provider),['itunes'],'Opening only searches Apple');
    assert.equal(await page.locator('#artworkArchiveSearch').textContent(),'Não encontrou seu resultado? Pesquise no Cover Art');
    await page.locator('#artworkArchiveSearch').click();
    await page.waitForFunction(()=>artworkSearchBusy);
    await page.evaluate(()=>{searchArtwork('archive');searchArtwork('archive');});
    assert.equal(requests.length,2,'Repeated Archive clicks coalesce');
    assert.match(await page.locator('#artworkStatus').textContent(),/Cover Art Archive; isso pode demorar/);
    await page.locator('[data-art-use="0"][data-art-role="cover"]').focus();
    releaseArchive();await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(await page.locator('.artwork-result').count(),2);
    assert.equal(await page.locator('[data-art-use="0"][data-art-role="cover"]').evaluate(node=>node===document.activeElement),true,'Archive appends without replacing focused Apple covers');
    await page.locator('#artworkArchiveSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(requests.length,2,'A completed Archive search is reused');
    await page.locator('#artworkClose').click();await page.evaluate(()=>openArtworkDialog());await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(requests.length,3);assert.equal(requests.at(-1).provider,'itunes');
    assert.equal(await page.locator('.artwork-result').count(),2,'Reopening restores cached community covers without querying Archive');
    await page.locator('#artworkQuery').fill('Nova');await page.locator('#artworkSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(await page.locator('.artwork-result').count(),1,'A different query cannot display the old Archive results');
    mode='unavailable';await page.locator('#artworkArchiveSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(await page.locator('.artwork-result').count(),1,'Archive 503 preserves Apple covers');
    assert.equal(await page.locator('#artworkArchiveSearch').isDisabled(),true);
    assert.equal(await page.locator('#artworkSearch').isDisabled(),false,'Archive backoff does not block Apple');
    const before=requests.length;await page.evaluate(()=>searchArtwork('archive'));
    assert.equal(requests.length,before,'Archive is not retried during the 503 wait');
    await page.locator('#artworkClose').click();await page.evaluate(()=>{$('titleInput').value='Nova';openArtworkDialog();});await page.waitForFunction(()=>!artworkSearchBusy);
    assert.deepEqual(requests.slice(before).map(item=>item.provider),['itunes'],'Reopening during Archive recovery only refreshes Apple');
    await page.evaluate(()=>{artworkRetryUntil.archive=0;refreshArtworkSearchButton();});
    for(const scenario of ['apple-empty','apple-offline']){
      const beforeArchive=requests.filter(item=>item.provider==='archive').length;
      mode=scenario;await page.locator('#artworkQuery').fill(scenario);await page.locator('#artworkSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
      assert.equal(await page.locator('#artworkArchiveSearch').isEnabled(),true,'Archive remains available when Apple returns no results or fails');
      assert.equal(requests.filter(item=>item.provider==='archive').length,beforeArchive,'Apple failures never trigger Archive automatically');
      await page.locator('#artworkArchiveSearch').click();await page.waitForFunction(()=>artworkSearchBusy);releaseArchive();await page.waitForFunction(()=>!artworkSearchBusy);
      assert.equal(await page.locator('.artwork-result').count(),1);
      assert.equal(requests.filter(item=>item.provider==='archive').length,beforeArchive+1);
    }
    mode='empty';await page.locator('#artworkQuery').fill('Sem capa');await page.locator('#artworkSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    await page.locator('#artworkArchiveSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    const afterEmpty=requests.length;await page.locator('#artworkArchiveSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(requests.length,afterEmpty,'Empty Archive responses are cached too');
    mode='delayed';await page.locator('#artworkQuery').fill('Cancelar');await page.locator('#artworkSearch').click();await page.waitForFunction(()=>!artworkSearchBusy);
    await page.locator('#artworkArchiveSearch').click();await page.waitForFunction(()=>artworkSearchBusy);
    await page.locator('[data-art-use="0"][data-art-role="cover"]').click();
    await page.waitForFunction(()=>captureUploadDraft().files.some(file=>file.name==='selected-cover.jpg'));
    assert.equal(downloads,1);assert.equal(await page.locator('#artworkDialog').isVisible(),false,'Apple is selectable while Archive loads');
    releaseArchive();await page.waitForTimeout(100);
    assert.equal(await page.locator('.artwork-result').count(),1,'Late cancelled covers do not change the closed search');
    await page.route('**/api/youtube/search',route=>route.fulfill({json:{results:[]}}));
    await page.evaluate(()=>openArtworkDialog());await page.waitForFunction(()=>!artworkSearchBusy);
    await page.locator('#artworkProvider').selectOption('youtube');await page.waitForFunction(()=>!artworkSearchBusy);
    assert.equal(await page.locator('#artworkArchiveSearch').isVisible(),false,'The optional Archive button only belongs to Apple');
    await page.setViewportSize({width:390,height:720});await page.locator('#artworkProvider').selectOption('itunes');await page.waitForFunction(()=>!artworkSearchBusy);
    assert.ok(await page.locator('#artworkArchiveSearch').evaluate(node=>node.scrollWidth<=node.clientWidth),'The full button label fits on mobile');
    await page.screenshot({path:path.join(root,'native-app/test-results/covers-opt-in-mobile.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS covers: explicit Archive opt-in, query cache, empty cache, no automatic Archive queries, independent 503 recovery, Apple failures, preserved selection, mobile layout.');
  }finally{releaseArchive?.();await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
