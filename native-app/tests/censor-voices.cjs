const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright'),model=require('../../lyrics-model.js');
const root=path.resolve(__dirname,'../..'),artifacts=path.join(root,'native-app/test-results');fs.mkdirSync(artifacts,{recursive:true});
const row=(id,text,time)=>({id,text,time,end:time+2000,words:model.words(text).map((word,index)=>({word,index,start:time/1000+index*.2,end:time/1000+(index+1)*.2}))});
const chart=model.normalize({lead:[row('lead-0','Never caçado-o-or again',1000),...Array.from({length:45},(_,index)=>row('lead-'+(index+1),'Another lyric phrase '+index,6000+index*3000))],parallel:[row('parallel-0','Never answer',1000),{...row('parallel-mask','look through my eyes',4000),activeWordIndices:[2,3]}],backing:[row('backing-0','Never echo',2000)]});
let song={id:'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',title:'Silent censorship fixture',inst:'silent.wav',lead:'silent.wav',...model.storage(chart)},posts=0,failNext=false;
const wav=Buffer.alloc(44+48000*2*150);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/library'&&req.method==='POST'){let data='';req.on('data',part=>data+=part);req.on('end',()=>{res.setHeader('Content-Type','application/json');if(failNext){failNext=false;res.writeHead(503);res.end(JSON.stringify({error:'Simulated save failure'}));return;}song=JSON.parse(data);posts++;res.end('{}');});return;}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/library'?[song]:{}));return;}
 if(url.pathname.startsWith('/music/')){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(err?'Not found':data);});
});
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1366,height:900}});await context.addInitScript(()=>localStorage.setItem('voxstage-onboarding-hidden','1'));
  const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__voxstageUiReady);
  await page.locator(`[data-play="${song.id}"]`).click();await page.waitForFunction(()=>current?.buffers?.Lead);await page.evaluate(async()=>{pausePlayback();await document.documentElement.requestFullscreen();openManualLineSync();});

  await page.evaluate(()=>{window.__voicesBeforeCensor=JSON.stringify(current.lyricVoices);window.__censorBefore=JSON.stringify([current.profanityMarks,current.profanityCues]);});
  await page.locator('#syncCensorTool summary').click();await page.locator('#openProfanityPicker').click();
  assert.equal(await page.evaluate(()=>profanityPicker.parentElement===document.fullscreenElement),true,'Picker attaches to the real fullscreen layer');
  assert.equal(await page.locator('[data-censor-voice]').count(),3);
  assert.equal(await page.locator('#censorTab-lead').getAttribute('aria-selected'),'true');
  assert.match(await page.locator('#profanityPickerTitle').evaluate(node=>getComputedStyle(node).fontFamily),/Manrope/);
  assert.notEqual(await page.locator('#profanityPickerTitle').evaluate(node=>getComputedStyle(node).color),'rgb(0, 0, 0)','Fullscreen root must not turn the heading black');
  assert.match(await page.locator('.profanity-pick-word').first().evaluate(node=>getComputedStyle(node).fontFamily),/DM Sans/);
  assert.equal(await page.locator('.profanity-pick-word').first().evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Picker stays above the Sync editor');

  for(const voice of model.tracks){
    await page.locator('#censorTab-'+voice).click();
    for(const button of await page.locator('#censorWords-'+voice+' .profanity-pick-word').all())assert.equal(await button.evaluate(node=>current.lyricLines[Number(node.dataset.lineIndex)].voice),voice);

    const word=page.locator('#censorWords-'+voice+' [data-word="Never"]');assert.equal(await word.count(),1,'Expected a fixture occurrence in '+voice);await word.click();assert.equal(await word.getAttribute('aria-pressed'),'true');
  }
  assert.equal(await page.locator('#censorWords-parallel [data-word="look"]').count(),0,'Inactive Voice 2 context cannot be selected');
  assert.equal(await page.locator('#censorWords-parallel [data-word="my"]').count(),1);
  await page.locator('#censorTab-lead').click();assert.equal(await page.locator('#censorWords-lead [data-word="Never"]').getAttribute('aria-pressed'),'true','Switching tabs preserves all selections');
  assert.match(await page.locator('#censorWords-lead .profanity-phrase').first().textContent(),/caçado-o-or/,'Hyphen parts preserve their visible separators');
  assert.equal(await page.locator('#profanitySelectionCount').textContent(),'3 selecionadas');
  await page.locator('#censorTab-lead').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#censorTab-parallel').getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.locator('#censorTab-backing').getAttribute('aria-selected'),'true');
  await page.locator('#censorTab-lead').click();
  for(const viewport of [{width:1366,height:900},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(70);
    const card=await page.locator('.profanity-picker-card').boundingBox(),header=await page.locator('.profanity-picker-card header').boundingBox(),footerBefore=await page.locator('.profanity-picker-card footer').boundingBox();
    assert.ok(card.x>=0&&card.y>=0&&card.x+card.width<=viewport.width+1&&card.y+card.height<=viewport.height+1,'Entire card fits the viewport');
    assert.ok(header.y>=card.y&&footerBefore.y+footerBefore.height<=card.y+card.height+1);
    const scroll=await page.locator('#profanityPickerWords').evaluate(node=>{node.scrollTop=1500;return {scroll:node.scrollTop,viewport:node.clientHeight,total:node.scrollHeight};});assert.ok(scroll.scroll>0&&scroll.total>scroll.viewport,'Long lyrics scroll inside their list');
    const footerAfter=await page.locator('.profanity-picker-card footer').boundingBox();assert.ok(Math.abs(footerBefore.y-footerAfter.y)<1,'Save button stays fixed while the list scrolls');
    await page.screenshot({path:path.join(artifacts,`censor-voices-${viewport.width}x${viewport.height}.png`)});
    await page.locator('#profanityPickerWords').evaluate(node=>node.scrollTop=0);
  }
  await page.setViewportSize({width:1366,height:900});
  failNext=true;await page.locator('#saveProfanityWords').click();await page.waitForFunction(()=>!profanityPickerBusy);
  assert.equal(await page.locator('#profanityPicker').isVisible(),true,'Failed save keeps all selections open for retry');assert.equal(posts,0);
  assert.equal(await page.locator('.profanity-pick-word.selected').count(),3);
  assert.equal(await page.evaluate(()=>JSON.stringify([current.profanityMarks,current.profanityCues])===window.__censorBefore),true,'Failure cannot partially change current censorship');
  await page.locator('#saveProfanityWords').click();await page.waitForFunction(()=>!profanityPickerBusy&&!profanityPicker.classList.contains('show'));
  assert.equal(posts,1);assert.equal(song.profanityMarks.length,3);
  assert.deepEqual(await page.evaluate(()=>current.profanityMarks.map(mark=>current.lyricLines[mark.lineIndex].voice).sort()),['backing','lead','parallel']);
  assert.equal(await page.evaluate(()=>JSON.stringify(current.lyricVoices)===window.__voicesBeforeCensor),true,'Censorship cannot change lyrics or sync');
  await page.locator('#openProfanityPicker').click();assert.equal(await page.locator('.profanity-pick-word.selected').count(),3,'All voices reopen with saved selection');
  await page.locator('#censorTab-parallel').click();await page.locator('#censorWords-parallel [data-word="Never"]').click();
  await page.keyboard.press('Escape');assert.equal(await page.locator('#profanityPicker').isVisible(),false);assert.equal(await page.locator('#manualSyncDialog').isVisible(),true,'Escape only closes the top picker');assert.equal(song.profanityMarks.length,3,'Close discards unsaved selection changes');
  await page.evaluate(()=>{setManualSyncFocus('parallel');openProfanityPickerForCurrent();});assert.equal(await page.locator('#censorTab-parallel').getAttribute('aria-selected'),'true','Opening from a voice starts on that tab');
  await page.locator('#closeProfanityPicker').click();await page.locator('#closeManualSync').click();
  await page.evaluate(()=>{const voices={version:1,lead:[],parallel:[],backing:[]};Object.assign(current,VoxStageLyrics.project(voices),{lyricVoices:voices,lyricIndex:null,playbackTracks:null});current.plainLyrics='';openProfanityPickerForCurrent();});
  await page.locator('#censorTab-backing').click();assert.equal(await page.locator('#censorWords-backing .profanity-empty').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS censura: fullscreen typography/layering, three voice tabs, partial Voice 2 masks, hidden selections, exact occurrences, keyboard/Escape, responsive internal scrolling, failed saves and persistence.');
 }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
