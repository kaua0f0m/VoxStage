const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function main(){
  const {createBuildInfo,readBuildInfo}=await import('../scripts/build-info.mjs');
  const artifacts=path.resolve(__dirname,'../test-results');fs.mkdirSync(artifacts,{recursive:true});
  const root=fs.mkdtempSync(path.join(artifacts,'build-version-'));
  assert.ok(path.resolve(root).startsWith(artifacts+path.sep));
  try {
    fs.writeFileSync(path.join(root,'BUILD-SEQUENCE.json'),JSON.stringify({'1.1':2}));
    const first=createBuildInfo(root,'1.1.0-test.1');
    assert.equal(first.label,'1.1 snapshot 3');
    const second=createBuildInfo(root,'1.1.0-test.1');
    assert.equal(second.label,'1.1 snapshot 4');assert.notEqual(first.buildId,second.buildId);
    assert.deepEqual(readBuildInfo(root,'1.1.0-test.1'),second,'Packaging can reuse the number allocated by compilation');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'BUILD-SEQUENCE.json')))['1.1'],4);
    assert.match(fs.readFileSync(path.join(root,'build-info.js'),'utf8'),/1\.1 snapshot 4/);
    assert.throws(()=>readBuildInfo(root,'1.0.2'),/does not match/);
    assert.equal(createBuildInfo(root,'1.0.2').label,'1.0.2 · build 1');
    assert.equal(createBuildInfo(root,'1.2.0-test.1').label,'1.2 snapshot 1');
    assert.equal(createBuildInfo(root,'1.1.0-rc.1').label,'1.1 RC-1');
    fs.writeFileSync(path.join(root,'.build-sequence.lock'),'');
    assert.throws(()=>createBuildInfo(root,'1.2.0-test.1'),/Another build/);
    assert.throws(()=>createBuildInfo(root,'invalid'),/Invalid build/);
    console.log('PASS build identity: snapshots advance per deploy, release/minor sequences, reuse, validation and concurrent-build lock.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
