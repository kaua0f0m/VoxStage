/* Optional benchmark against a caller-provided, local vocal stem; no uploads. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const files=process.argv.slice(2);if(!files.length)throw new Error('Usage: node scoring-reference.cjs lead [backing] [instrumental]');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local reference benchmark</title>');return;}
  const referenceRequest=pathname.match(/^\/reference(?:\/(\d+))?$/);
  const target=referenceRequest?path.resolve(files[Number(referenceRequest[1]||0)]):path.resolve(root,'.'+pathname);
  if(!referenceRequest&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':pathname.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(error?'Missing':data);});
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--mute-audio']});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async count=>{
      const context=new AudioContext(),tracks=[];
      for(let index=0;index<count;index++){const audio=await context.decodeAudioData(await(await fetch(`/reference/${index}`)).arrayBuffer());tracks.push({id:['Lead','Back','Inst'][index],samples:audio.getChannelData(0).slice(),sampleRate:audio.sampleRate});}
      const started=performance.now();
      const reference=await new Promise((resolve,reject)=>{const worker=new Worker('/audio/pitch-worker.js');worker.onerror=reject;worker.onmessage=e=>{if(e.data.type==='reference'){worker.terminate();resolve(e.data.reference);}if(e.data.type==='error'){worker.terminate();reject(new Error(e.data.message));}};worker.postMessage({type:'reference',id:1,mode:count===3?'All':count===2?'Vocals':'Lead',tracks},tracks.map(t=>t.samples.buffer));});
      const summary=(begin,end)=>{let count=0,valid=0;for(let i=0;i<reference.frequencies.length;i++){const time=reference.start+i*reference.step;if(time>=begin&&time<=end){count++;if(reference.frequencies[i]>0)valid++;}}return{seconds:valid*reference.step,coveragePercent:count?valid/count*100:0};};
      await context.close();return{duration:reference.duration,analysisSeconds:(performance.now()-started)/1000,full:summary(0,reference.duration),segment38to49:summary(38,49),tracks:reference.tracks.map(t=>({id:t.id,seconds:t.frequencies.filter(f=>f>0).length*reference.step,rawSeconds:t.rawVoicedSeconds,bars:t.notes.length,meanBarSeconds:t.notes.length?t.notes.reduce((sum,n)=>sum+n.end-n.start,0)/t.notes.length:0}))};
    },files.length);
    fs.writeFileSync(path.join(root,'native-app/test-results/scoring-reference.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
