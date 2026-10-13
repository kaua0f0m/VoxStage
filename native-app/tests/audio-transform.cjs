const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
fs.mkdirSync(path.join(root,'native-app/test-results'),{recursive:true});
const server = http.createServer((req,res)=>{
  if(req.url==='/'){res.end('<!doctype html><title>Audio tests</title>');return;}
  const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(filename,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':'text/javascript'});res.end(error?'Missing':data);});
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results=await page.evaluate(async()=>{
      const results=[];
      const cases=[.75,1,1.25].flatMap(speed=>[-4,0,4].map(pitch=>({speed,pitch,sampleRate:48000,duration:1.8})));
      cases.push({speed:.75,pitch:-4,sampleRate:44100,duration:20},{speed:1.25,pitch:4,sampleRate:44100,duration:20});
      for(const {speed,pitch,sampleRate,duration} of cases){
        const context=new OfflineAudioContext(2,Math.ceil(sampleRate*(duration/speed+1)),sampleRate);
        await context.audioWorklet.addModule('/audio/vendor/soundtouch-processor.js');
        const node=new AudioWorkletNode(context,'soundtouch-processor',{outputChannelCount:[2]});
        node.parameters.get('playbackRate').value=speed;
        node.parameters.get('pitchSemitones').value=pitch;
        const buffer=context.createBuffer(2,sampleRate*duration,sampleRate);
        for(let channel=0;channel<2;channel++){
          const samples=buffer.getChannelData(channel), frequency=channel?660:440;
          for(let i=0;i<samples.length;i++)samples[i]=.2*Math.sin(2*Math.PI*frequency*i/sampleRate)*Math.min(1,i/1000,(samples.length-i)/1000);
        }
        const source=context.createBufferSource(); source.buffer=buffer; source.playbackRate.value=speed;
        const bus=context.createGain(); source.connect(bus); bus.connect(node); node.connect(context.destination); source.start(.1);
        const rendered=await context.startRendering();
        const frequencies=[]; let dropouts=0, jump=0, jumpAt=0, jumpSamples=[];
        for(let channel=0;channel<2;channel++){
          const samples=rendered.getChannelData(channel), first=Math.round(sampleRate*.6), last=Math.round(sampleRate*1.1);
          let crossings=0;
          for(let i=first+1;i<last;i++)if(samples[i-1]<=0 && samples[i]>0)crossings++;
          frequencies.push(crossings*sampleRate/(last-first));
          for(let i=first;i<sampleRate*(.1+duration/speed-.2);i+=480){
            let energy=0;
            for(let j=i;j<i+480;j++){energy+=samples[j]**2;const difference=Math.abs(samples[j]-samples[j-1]);if(difference>jump){jump=difference;jumpAt=j/sampleRate;jumpSamples=Array.from(samples.slice(j-3,j+3));}}
            if(Math.sqrt(energy/480)<.025)dropouts++;
          }
        }
        const samples=rendered.getChannelData(0);
        let first=0,last=samples.length-1;
        while(first<samples.length && Math.abs(samples[first])<.001)first++;
        while(last>first && Math.abs(samples[last])<.001)last--;
        results.push({speed,pitch,sampleRate,sourceDuration:duration,frequencies,dropouts,jump,jumpAt,jumpSamples,duration:(last-first)/sampleRate});
        node.port.close();
      }
      return results;
    });
    fs.writeFileSync(path.join(root,'native-app/test-results/audio-transform.json'),JSON.stringify(results,null,2));
    for(const result of results){
      const shift=2**(result.pitch/12);
      for(const [channel,frequency] of result.frequencies.entries())assert.ok(Math.abs(frequency-(channel?660:440)*shift)<5,JSON.stringify(result));
      assert.equal(result.dropouts,0,JSON.stringify(result));
      assert.ok(result.jump<.05,JSON.stringify(result));
      assert.ok(Math.abs(result.duration-result.sourceDuration/result.speed)<.075,JSON.stringify(result));
    }
    fs.writeFileSync(path.join(root,'native-app/test-results/audio-transform.json'),JSON.stringify(results,null,2));
    console.log('PASS DSP: 9 combinações e 2 trechos de 20s em 44.1/48kHz; frequência estéreo, duração, continuidade e ausência de dropouts após aquecimento.');
  }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1});
