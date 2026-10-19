const assert=require('node:assert/strict');
const model=require('../../lyrics-model.js');
const row=(id,text,time,words=[])=>({id,text,time,end:time+2000,words});
const voices={version:1,lead:[row('a','Eu canto aqui',1000,[{word:'Eu',start:1,end:1.3},{word:'canto',start:1.3,end:2},{word:'aqui',start:2,end:3}]),row('b','Última frase',9000)],parallel:[row('d','Segunda voz',6000)],backing:[row('c','Oh yeah',2500,[{word:'Oh',start:2.5,end:2.8},{word:'yeah',start:2.8,end:3.5}]),row('e','Resposta',7000)]};
const snapshot=JSON.stringify(voices);
for(const text of ['Nova linha\nOh yeah!\nResposta','Resposta','Oh\nyeah\nResposta','']) {
  const edited=model.normalize(voices);edited.backing=model.reconcile(edited.backing,text,'backing');
  assert.deepEqual(edited.lead,model.normalize(voices).lead,'Editing backing must never mutate lead timestamps or words');
  assert.deepEqual(edited.parallel,model.normalize(voices).parallel,'Editing backing must never mutate Voice 2');
  const roundtrip=model.normalize(model.storage(edited).lyricVoices);
  assert.deepEqual(roundtrip.lead,model.normalize(voices).lead);
}
assert.equal(JSON.stringify(voices),snapshot,'Source data must remain immutable');
const split=model.reconcile(voices.lead,'Eu canto\naqui\nÚltima frase');
assert.equal(split[0].words[0].start,1);assert.equal(split[1].words[0].start,2);assert.equal(split[2].time,9000);
const inserted=model.reconcile(voices.lead,'Nova\nEu canto aqui\nÚltima frase');
assert.equal(inserted[0].time,null);assert.equal(inserted[1].id,'a');assert.equal(inserted[2].time,9000);
const corrected=model.reconcile(voices.lead,'Eu canto, aqui!\nÚltima frase');
assert.deepEqual(corrected[0].words.map(cue=>[cue.start,cue.end]),[[1,1.3],[1.3,2],[2,3]]);
assert.deepEqual(model.parseVoices('Eu canto (oh [eco]) aqui [com você]'),[
  {word:'Eu',voice:'lead',parallel:false,backing:false},{word:'canto',voice:'lead',parallel:false,backing:false},
  {word:'oh',voice:'backing',parallel:false,backing:true},{word:'eco',voice:'parallel',parallel:true,backing:false},
  {word:'aqui',voice:'lead',parallel:false,backing:false},{word:'com',voice:'parallel',parallel:true,backing:false},{word:'você',voice:'parallel',parallel:true,backing:false}]);
const legacy={plainLyrics:'Eu (oh) canto [junto]\n(só backing)\n[só segunda]',backingPlainLyrics:'só backing'};
const migrated=model.fromLegacy(legacy,{lyricLines:[{time:1000,text:'Eu (oh) canto [junto]'},{time:5000,text:'(só backing)'},{time:8000,text:'[só segunda]'}],wordTimings:[{lineIndex:0,words:[{word:'Eu',start:1,end:1.2},{word:'oh',start:1.2,end:1.4},{word:'canto',start:1.4,end:2},{word:'junto',start:1.5,end:2}]}],parallelWordTimings:[{lineIndex:0,words:[{word:'junto',start:1.5,end:2}]}],backingWordTimings:[{lineIndex:1,words:[{word:'só',start:5,end:5.3},{word:'backing',start:5.3,end:6}]}]});
assert.deepEqual(migrated.lead.map(row=>row.text),['Eu canto']);
assert.deepEqual(migrated.backing.map(row=>row.text),['oh','só backing']);
assert.deepEqual(migrated.parallel.map(row=>row.text),['junto','só segunda']);
assert.equal(migrated.backing[0].time,1200);assert.equal(migrated.lead[0].words[1].start,1.4);
const projected=model.project(migrated);assert.equal(projected.lyricLines.find(row=>row.voice==='parallel'&&row.text.includes('segunda')).time,8000);
const extracted=model.extractLegacy(voices,'Eu canto (aqui)\nÚltima frase');
assert.deepEqual(extracted.lead.map(row=>row.text),['Eu canto','Última frase']);
assert.equal(extracted.backing.at(-1).text,'aqui');assert.equal(extracted.backing.at(-1).words[0].start,2);
assert.deepEqual(extracted.parallel,model.normalize(voices).parallel);
assert.deepEqual(extracted.backing.slice(0,2),model.normalize(voices).backing);
const repeated=model.reconcile([row('r1','Oh',1000),row('r2','Oh',5000)],'Oh\nNova\nOh');
assert.equal(repeated[0].time,1000);assert.equal(repeated[1].time,null);assert.equal(repeated[2].time,5000);
console.log('PASS letras: vozes independentes, edição/inserção/remoção, palavras preservadas, migração e extração de ()/[] na mesma linha.');

const paragraphs=model.reconcile(voices.lead,'\nEu canto aqui\n \n\nÚltima frase\n');
assert.equal(paragraphs.length,2,'Blank lines are boundaries, never lyric rows');
assert.equal(paragraphs[1].breakBefore,true);
assert.deepEqual(paragraphs[0].words.map(({word,start,end})=>({word,start,end})),voices.lead[0].words,'Adding a blank line never changes saved timings');
assert.equal(model.editorText(paragraphs),'Eu canto aqui\n\nÚltima frase');
const storedParagraphs=model.storage({...voices,lead:paragraphs});
assert.equal(storedParagraphs.plainLyrics,'Eu canto aqui\n\nÚltima frase');
assert.equal(model.fromLegacy(storedParagraphs,model.project(storedParagraphs.lyricVoices)).lead[1].breakBefore,true);
const plainParagraphs=model.fromLegacy({plainLyrics:'One\n\nTwo'},{lyricLines:[]});
assert.equal(plainParagraphs.lead[1].breakBefore,true,'Pasted legacy paragraphs preserve their gap');
const removeGap=model.reconcile(paragraphs,'Eu canto aqui\nÚltima frase');
assert.equal(removeGap[1].breakBefore,undefined,'Removing the blank line removes the automatic pause');

const contextRow={id:'context',text:'look through my eyes',time:1000,end:5000,words:['look','through','my','eyes'].map((word,index)=>({word,index,start:index+1,end:index+2}))};
const masked=model.reconcile([contextRow],'look through [my eyes]','parallel');
assert.equal(masked[0].text,'look through my eyes');assert.deepEqual(masked[0].activeWordIndices,[2,3]);
assert.equal(masked[0].time,3000);assert.equal(masked[0].end,5000);
assert.deepEqual(masked[0].words,contextRow.words,'Context clocks remain intact for reversible masking');
assert.equal(model.editorText(masked),'look through [my eyes]');
const unmasked=model.reconcile(masked,'look through my eyes','parallel');
assert.equal(unmasked[0].activeWordIndices,undefined);assert.equal(unmasked[0].time,1000);
const groups=model.voiceTextRows('[look] through [my eyes]','parallel');assert.deepEqual(groups[0].activeWordIndices,[0,2,3]);
assert.equal(model.editorText(groups),'[look] through [my eyes]');

const hyphen='a bicharada e o caçado-o-or agora';
assert.deepEqual(model.words(hyphen),['a','bicharada','e','o','caçado','o','or','agora']);
assert.equal(model.joinEntries(model.wordEntries(hyphen)),hyphen,'Keep visible hyphens without inserting spaces');
assert.deepEqual(model.words('bem-estar caçado‐o‐or caçado‑o‑or fim — começo'),['bem','estar','caçado','o','or','caçado','o','or','fim','—','começo'],'Hyphens split; sentence dashes stay separate');
const oldHyphen={id:'old-hyphen',text:'caçado-o-or o',time:1000,end:6000,activeWordIndices:[0],words:[{word:'caçado-o-or',index:0,start:1,end:4},{word:'o',index:1,start:5,end:6}]};
const normalizedHyphen=model.normalize({parallel:[oldHyphen]}).parallel[0];
assert.deepEqual(normalizedHyphen.words.map(cue=>[cue.word,cue.index,cue.start,cue.end]),[['caçado',0,1,2],['o',1,2,3],['or',2,3,4],['o',3,5,6]],'Old compound cue splits without shifting a repeated following word');
assert.deepEqual(normalizedHyphen.activeWordIndices,[0,1,2],'Old Voice 2 masks migrate to every part of the selected word');
assert.equal(normalizedHyphen.wordSegmentation,'hyphen-v1');
assert.equal(model.editorText([normalizedHyphen]),'[caçado-o-or] o');
assert.deepEqual(model.normalize({parallel:[normalizedHyphen]}).parallel[0],normalizedHyphen,'Repeated normalization never re-splits timings or masks');
assert.deepEqual(oldHyphen.activeWordIndices,[0],'Migration never mutates saved input');
const newHyphen=model.reconcile([normalizedHyphen],'caçado-[o-or] o','parallel');
assert.deepEqual(newHyphen[0].activeWordIndices,[1,2]);
assert.equal(model.editorText(newHyphen),'caçado-[o-or] o');
assert.deepEqual(model.storage({parallel:newHyphen}).lyricVoices.parallel[0].activeWordIndices,[1,2]);
assert.equal(newHyphen[0].words.at(-1).start,5);
const legacyHyphen=model.fromLegacy({plainLyrics:'a [caçado-o-or] (oh-oh)'},{lyricLines:[]});
assert.equal(legacyHyphen.parallel[0].text,'caçado-o-or');assert.equal(legacyHyphen.backing[0].text,'oh-oh');
const extractedHyphen=model.extractLegacy({lead:[{...oldHyphen,activeWordIndices:undefined}]},'caçado-[o-or] o');
assert.equal(extractedHyphen.parallel[0].text,'o-or');
console.log('PASS hífens: partes independentes, separadores preservados, charts antigos, palavras repetidas e máscaras da Voz 2.');
