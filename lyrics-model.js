(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.VoxStageLyrics = model;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const tracks = ['lead', 'parallel', 'backing'];
  let sequence = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = value => value != null && Number.isFinite(Number(value));
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function wordEntries(text) {
    const result=[];
    for(const token of String(text||'').match(/\S+/g)||[]){
      const parts=token.split(/(?<=[\p{L}\p{N}])([-\u2010\u2011])(?=[\p{L}\p{N}])/u);
      for(let index=0;index<parts.length;index+=2)result.push(index?{word:parts[index],joiner:parts[index-1]}:{word:parts[index]});
    }
    return result;
  }
  const words = text => wordEntries(text).map(entry=>entry.word);
  const joinEntries = entries => entries.map((entry,index)=>(index?entry.joiner||' ':'')+entry.word).join('');
  const lineKey = text => words(text).map(key).join(' ');
  const id = track => `${track}-${Date.now().toString(36)}-${++sequence}`;
  const empty = () => ({version:1, lead:[], parallel:[], backing:[]});
  const textLines = text => String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  function textRows(text) {
    const result=[];let gap=false;
    for(const raw of String(text||'').split(/\r?\n/)) {
      const text=raw.trim();
      if(!text){if(result.length)gap=true;continue;}
      result.push({text,breakBefore:gap});gap=false;
    }
    return result;
  }
  function voiceTextRows(text,track='lead') {
    return textRows(text).map(row=>{
      const format=wordEntries(row.text).some(entry=>entry.joiner)?{wordSegmentation:'hyphen-v1'}:{};
      if(track!=='parallel'||!row.text.includes('[')||!row.text.includes(']'))return {...row,...format};
      let clean='',depth=0;const selectedOffsets=new Set();
      for(const character of row.text){
        if(character==='['){depth++;continue;}
        if(character===']'&&depth){depth--;continue;}
        if(depth)for(let offset=0;offset<character.length;offset++)selectedOffsets.add(clean.length+offset);
        clean+=character;
      }
      const selected=[];let cursor=0;
      wordEntries(clean).forEach((entry,index)=>{
        const start=clean.indexOf(entry.word,cursor),end=start+entry.word.length;
        for(let offset=start;offset<end;offset++)if(selectedOffsets.has(offset)){selected.push(index);break;}
        cursor=end;
      });
      return selected.length?{...row,...format,text:clean.trim(),activeWordIndices:selected}:row;
    });
  }
  function editorLineText(row) {
    if(!Array.isArray(row.activeWordIndices))return row.text;
    const active=new Set(row.activeWordIndices),tokens=wordEntries(row.text);
    return tokens.map((entry,index)=>(index?entry.joiner||' ':'')+(active.has(index)&&!active.has(index-1)?'[':'')+entry.word+(active.has(index)&&!active.has(index+1)?']':'')).join('');
  }
  const editorText = rows => rows.map((row,index)=>(index&&row.breakBefore?'\n':'')+editorLineText(row)).join('\n');

  function parseVoices(text,voice='lead') {
    const entries=[],value=String(text||'');let cursor=0;
    const add=(segment,track)=>wordEntries(segment).forEach(entry=>entries.push({...entry,voice:track,parallel:track==='parallel',backing:track==='backing'}));
    for(let index=0;index<value.length;index++) {
      if(value[index]!=='('&&value[index]!=='[')continue;
      const stack=[value[index]==='('?')':']'];let end=index+1;
      for(;end<value.length&&stack.length;end++) {
        if(value[end]==='(')stack.push(')');else if(value[end]==='[')stack.push(']');
        else if(value[end]===stack.at(-1))stack.pop();
      }
      if(stack.length)continue;
      add(value.slice(cursor,index),voice);
      entries.push(...parseVoices(value.slice(index+1,end-1),value[index]==='('?'backing':'parallel'));
      cursor=end;index=end-1;
    }
    add(value.slice(cursor),voice);return entries;
  }
  function normalize(value) {
    const result = empty(), ids = new Set();
    for (const track of tracks) result[track] = (Array.isArray(value?.[track]) ? value[track] : []).filter(row => String(row?.text || '').trim()).map(row => {
      let rowId = typeof row.id === 'string' && row.id ? row.id : id(track);
      if (ids.has(rowId)) rowId = id(track);
      ids.add(rowId);
      const text = row.text.trim(), tokens = words(text);
      const cues=(row.words || []).filter(cue => finite(cue.start) && finite(cue.end) && Number(cue.end)>Number(cue.start)).map(cue => ({...cue,word:String(cue.word || ''),start:Number(cue.start),end:Number(cue.end)}));
      const result={...clone(row),id:rowId,text,time:finite(row.time) && Number(row.time)>=0 ? Number(row.time) : null,end:finite(row.end) ? Number(row.end) : null,words:cues};
      if(wordEntries(text).some(entry=>entry.joiner)&&row.wordSegmentation!=='hyphen-v1'){
        // Older charts recorded a hyphenated word as one cue. Keep its total
        // interval and all following word clocks while exposing its inner parts.
        result.words=[...cuePositions({text,words:cues})].map(([index,cue])=>({...cue,word:tokens[index],index}));
        if(Array.isArray(row.activeWordIndices)){
          const selected=new Set(row.activeWordIndices);let cursor=0;result.activeWordIndices=[];
          (text.match(/\S+/g)||[]).forEach((token,index)=>{for(const part of words(token)){if(selected.has(index))result.activeWordIndices.push(cursor);cursor++;}});
        }
        result.wordSegmentation='hyphen-v1';
      }
      result.words=result.words.filter(cue=>tokens.some(token=>key(token)===key(cue.word)));
      return result;
    });
    return result;
  }
  // LCS preserves repeated occurrences and unchanged suffixes when lines are inserted.
  function match(source, target) {
    let prefix=0,suffix=0;
    while(prefix<source.length&&prefix<target.length&&source[prefix]===target[prefix])prefix++;
    while(suffix<source.length-prefix&&suffix<target.length-prefix&&source[source.length-1-suffix]===target[target.length-1-suffix])suffix++;
    if(prefix||suffix) {
      return [...Array.from({length:prefix},(_,index)=>[index,index]),
        ...match(source.slice(prefix,source.length-suffix),target.slice(prefix,target.length-suffix)).map(([a,b])=>[a+prefix,b+prefix]),
        ...Array.from({length:suffix},(_,index)=>[source.length-suffix+index,target.length-suffix+index])];
    }
    if(!source.length||!target.length)return [];
    const lengths = Array.from({length:source.length+1}, () => new Uint16Array(target.length+1));
    for (let i=source.length-1;i>=0;i--) for (let j=target.length-1;j>=0;j--)
      lengths[i][j] = source[i] && source[i]===target[j] ? lengths[i+1][j+1]+1 : Math.max(lengths[i+1][j],lengths[i][j+1]);
    const pairs=[];let i=0,j=0;
    while(i<source.length && j<target.length) {
      if(source[i] && source[i]===target[j]) {pairs.push([i++,j++]);}
      else if(lengths[i+1][j]>=lengths[i][j+1]) i++; else j++;
    }
    return pairs;
  }
  function cuePositions(row) {
    const tokens=words(row.text),positions=new Map();let cursor=0;
    for(const cue of row.words||[]){
      const parts=words(cue.word);
      for(let offset=0;offset<parts.length;offset++){
        const word=parts[offset];
        const explicit=parts.length===1&&Number.isInteger(cue.index)&&cue.index>=cursor&&key(tokens[cue.index])===key(word)?cue.index:-1;
        const index=explicit>=0?explicit:tokens.findIndex((token,index)=>index>=cursor&&key(token)===key(word));
        if(index<0)continue;
        const duration=(Number(cue.end)-Number(cue.start))/parts.length;
        const part=parts.length===1?cue:{...cue,word,index,start:Number(cue.start)+duration*offset,end:offset===parts.length-1?Number(cue.end):Number(cue.start)+duration*(offset+1)};
        positions.set(index,part);cursor=index+1;
      }
    }
    return positions;
  }

  function reconcile(source, text, track='lead') {
    source=source.map(row=>wordEntries(row.text).some(entry=>entry.joiner)&&row.wordSegmentation!=='hyphen-v1'?normalize({[track]:[row]})[track][0]:row);
    const parsed=voiceTextRows(text,track),lines=parsed.map(row=>row.text), oldKeys=source.map(row=>lineKey(row.text)), newKeys=lines.map(lineKey);
    const pairs=match(oldKeys,newKeys), mapped=new Map(pairs.map(([a,b])=>[b,a]));
    const anchors=[[-1,-1],...pairs,[source.length,lines.length]];
    for(let index=1;index<anchors.length;index++) {
      const [a,b]=anchors[index-1],[c,d]=anchors[index];
      // A one-for-one correction keeps the phrase clock. Never fan a removed line
      // into several new lines, or borrow a different voice's timestamps.
      if(c-a===d-b) for(let offset=1;offset<c-a;offset++) mapped.set(b+offset,a+offset);
    }
    const target=lines.map((text,index)=>{
      const original=source[mapped.get(index)];
      const row=original ? {...clone(original),text,words:[]} : {id:id(track),text,time:null,end:null,words:[]};
      delete row.breakBefore;if(parsed[index].breakBefore)row.breakBefore=true;
      if(parsed[index].wordSegmentation)row.wordSegmentation=parsed[index].wordSegmentation;
      if(track==='parallel'){delete row.activeWordIndices;if(parsed[index].activeWordIndices)row.activeWordIndices=parsed[index].activeWordIndices;}
      return row;
    });
    const oldTokens=source.flatMap((row,line)=>{const cues=cuePositions(row);return words(row.text).map((word,index)=>({word,line,index,cue:cues.get(index)}));});
    const newTokens=target.flatMap((row,line)=>words(row.text).map((word,index)=>({word,line,index})));
    // Unchanged words keep their exact times even when a phrase is split/merged.
    for(const [a,b] of match(oldTokens.map(token=>key(token.word)),newTokens.map(token=>key(token.word)))) {
      const before=oldTokens[a],after=newTokens[b];
      if(before.cue) target[after.line].words.push({...before.cue,word:after.word,index:after.index});
    }
    target.forEach((row,index)=>{
      const before=source[mapped.get(index)];
      if(track==='parallel'&&(Array.isArray(row.activeWordIndices)||Array.isArray(before?.activeWordIndices))){
        const cues=cuePositions(row),active=row.activeWordIndices||words(row.text).map((_,index)=>index);
        const selected=active.map(position=>cues.get(position)).filter(Boolean);
        // Context-word clocks are retained so removing brackets is reversible.
        if(selected.length){row.time=Math.min(...selected.map(cue=>cue.start))*1000;row.end=Math.max(...selected.map(cue=>cue.end))*1000;}
      }
      if(row.time==null && row.words.length) row.time=Math.min(...row.words.map(cue=>cue.start))*1000;
      if(row.end==null && row.words.length) row.end=Math.max(...row.words.map(cue=>cue.end))*1000;
    });
    return target;
  }
  function fromLegacy(song, unified, entriesForText) {
    if(song.lyricVoices?.version===1) return normalize(song.lyricVoices);
    const result=empty(), lines=(unified.lyricLines || []).map(row=>({...row}));
    let annotationCursor=0;
    for(const text of textLines(song.plainLyrics)) {
      if(!/[[(]/.test(text))continue;
      const tokens=parseVoices(text).map(entry=>key(entry.word)).join(' ');
      const index=lines.findIndex((row,index)=>index>=annotationCursor&&parseVoices(row.text).map(entry=>key(entry.word)).join(' ')===tokens);
      if(index>=0){lines[index].text=text;annotationCursor=index+1;}
    }
    lines.forEach((line,index)=>{
      const backing=/^\s*\(.*\)\s*$/.test(line.text);
      const entries=parseVoices(line.text), cues=(backing?unified.backingWordTimings:unified.wordTimings)?.find(row=>Number(row.lineIndex)===index)?.words || [];
      const legacyPositions=cuePositions({text:joinEntries(entries),words:cues});
      const separate=track=>{
        const selected=entries.filter(entry=>entry.voice===track);
        if(!selected.length)return;
        const text=joinEntries(selected), explicitCues=track==='parallel'?unified.parallelWordTimings?.find(row=>Number(row.lineIndex)===index)?.words:null;
        const row={id:`legacy-${track}-${index}`,text,time:Number(line.time),end:(backing?unified.backingLineEnds:track==='lead'?unified.lyricLineEnds:[])?.[index]??null,words:[]};
        const explicitPositions=explicitCues?.length?cuePositions({text,words:explicitCues}):null;
        selected.forEach((entry,position)=>{
          const cue=explicitPositions?explicitPositions.get(position):legacyPositions.get(entries.indexOf(entry));
          if(cue)row.words.push({...cue,word:entry.word,index:position});
        });
        if(track==='parallel'||track==='backing'&&!backing) {
          const start=unified.parallelLineStarts?.[index];
          if(track==='parallel'&&finite(start)) row.time=Number(start);
          else if(row.words.length) row.time=Math.min(...row.words.map(cue=>cue.start))*1000;
          else {
            const prefix=entries.findIndex(entry=>entry.voice===track),next=lines.slice(index+1).find(candidate=>!/^\s*\(.*\)\s*$/.test(candidate.text));
            row.time+=(Math.max(1,(next?.time??line.time+5000)-line.time))*Math.max(0,prefix)/Math.max(1,entries.length);
          }
        }
        if(row.end==null&&row.words.length)row.end=Math.max(...row.words.map(cue=>cue.end))*1000;
        if(song.lyricAdjustments?.[index])row.adjustment=clone(song.lyricAdjustments[index]);
        result[track].push(row);
      };
      tracks.forEach(separate);
    });
    // Unsynced lyrics are editable too. Import punctuation markers once; they
    // are not needed in any of the three independent text fields afterwards.
    const plain={lead:[],parallel:[],backing:[]};
    for(const line of textLines(song.plainLyrics)) {
      const entries=parseVoices(line);
      for(const track of tracks) {
        const selected=entries.filter(entry=>entry.voice===track);
        if(selected.length)plain[track].push(joinEntries(selected));
      }
    }
    const inlineCounts=new Map(),explicitCounts=new Map();
    plain.backing.forEach(text=>inlineCounts.set(lineKey(text),(inlineCounts.get(lineKey(text))||0)+1));
    for(const text of textLines(song.backingPlainLyrics).map(line=>line.replace(/^\s*\(|\)\s*$/g,'').trim())) {
      const k=lineKey(text),count=(explicitCounts.get(k)||0)+1;explicitCounts.set(k,count);
      if(count>(inlineCounts.get(k)||0))plain.backing.push(text);
    }
    for(const track of tracks) {
      const counts=new Map();result[track].forEach(row=>counts.set(lineKey(row.text),(counts.get(lineKey(row.text))||0)+1));
      for(const text of plain[track]) {
        const k=lineKey(text),count=counts.get(k)||0;
        if(count){counts.set(k,count-1);continue;}
        result[track].push({id:id(track),text,time:null,end:null,words:[]});
      }
    }
    for(const track of tracks) {
      const field=track==='lead'?'plainLyrics':track+'PlainLyrics';
      const annotated=textRows(song[field]||song.plainLyrics).flatMap(row=>{
        const entries=parseVoices(row.text),selected=entries.filter(entry=>song[field]&&track!=='lead'?true:entry.voice===track);
        return selected.length?[{text:joinEntries(selected),breakBefore:row.breakBefore}]:[];
      });
      for(const [a,b] of match(annotated.map(row=>lineKey(row.text)),result[track].map(row=>lineKey(row.text))))
        if(annotated[a].breakBefore)result[track][b].breakBefore=true;
    }
    return normalize(result);
  }
  const encode = (text,track) => track==='backing'?`(${text})`:track==='parallel'?`[${text}]`:text;
  const decode = (text,track) => track==='backing'?text.replace(/^\s*\(|\)\s*$/g,'').trim():track==='parallel'?text.replace(/^\s*\[|\]\s*$/g,'').trim():text.trim();
  function formatTime(ms) {
    const value=Math.max(0,Math.round(ms/10));
    return `${String(Math.floor(value/6000)).padStart(2,'0')}:${String(Math.floor(value/100)%60).padStart(2,'0')}.${String(value%100).padStart(2,'0')}`;
  }
  function project(value) {
    const voices=normalize(value),lyricLines=tracks.flatMap(track=>voices[track].filter(row=>finite(row.time)).map(row=>({time:row.time,text:encode(row.text,track),source:track,voiceId:row.id,voice:track,end:row.end,words:row.words,activeWordIndices:row.activeWordIndices,adjustment:row.adjustment}))).sort((a,b)=>a.time-b.time);
    const result={lyricVoices:voices,lyricLines,wordTimings:[],parallelWordTimings:[],backingWordTimings:[],lyricLineEnds:[],parallelLineEnds:[],backingLineEnds:[],parallelLineStarts:[],lyricAdjustments:{}};
    lyricLines.forEach((row,index)=>{
      const field=row.voice==='backing'?'backingWordTimings':row.voice==='parallel'?'parallelWordTimings':'wordTimings';
      if(row.words.length)result[field].push({lineIndex:index,words:clone(row.words)});
      const ends=row.voice==='backing'?'backingLineEnds':row.voice==='parallel'?'parallelLineEnds':'lyricLineEnds';
      if(finite(row.end))result[ends][index]=row.end;
      if(row.voice==='parallel')result.parallelLineStarts[index]=row.time;
      if(row.adjustment)result.lyricAdjustments[index]=clone(row.adjustment);
    });
    result.syncedLyrics=lyricLines.map(row=>`[${formatTime(row.time)}]${row.text}`).join('\n');
    result.plainLyrics=editorText(voices.lead);
    return result;
  }
  function storage(value) {
    const voices=normalize(value),result={lyricVoices:voices};
    for(const track of tracks) {
      const prefix=track==='lead'?'':track==='parallel'?'parallel':'backing', timed=voices[track].filter(row=>finite(row.time));
      const field=name=>prefix?prefix+name[0].toUpperCase()+name.slice(1):name;
      result[field('syncedLyrics')]=timed.map(row=>`[${formatTime(row.time)}]${encode(row.text,track)}`).join('\n');
      result[field('plainLyrics')]=editorText(voices[track]);
      result[field('wordTimings')]=timed.flatMap((row,lineIndex)=>row.words.length?[{lineIndex,words:clone(row.words)}]:[]);
      result[track==='lead'?'lyricLineEnds':`${track}LineEnds`]=timed.map(row=>row.end);
    }
    result.parallelLineStarts=voices.parallel.filter(row=>finite(row.time)).map(row=>row.time);
    return result;
  }
  function extractLegacy(value,text) {
    const result=normalize(value),source=reconcile(result.lead,text,'lead');result.lead=[];
    for(const row of source) {
      const entries=parseVoices(row.text),positions=cuePositions({text:joinEntries(entries),words:row.words});
      for(const track of tracks) {
        const selected=entries.filter(entry=>entry.voice===track);if(!selected.length)continue;
        const extracted={...clone(row),id:track==='lead'?row.id:`${row.id}:${track}`,text:joinEntries(selected),words:[]};
        selected.forEach((entry,index)=>{const cue=positions.get(entries.indexOf(entry));if(cue)extracted.words.push({...cue,word:entry.word,index});});
        if(track!=='lead') {
          delete extracted.adjustment;
          if(extracted.words.length){extracted.time=extracted.words[0].start*1000;extracted.end=Math.max(...extracted.words.map(cue=>cue.end))*1000;}
        }
        if(track==='lead'||!result[track].some(existing=>lineKey(existing.text)===lineKey(extracted.text)&&existing.time===extracted.time))result[track].push(extracted);
      }
    }
    return result;
  }
  return {tracks,empty,textRows,voiceTextRows,editorText,normalize,reconcile,fromLegacy,project,storage,encode,decode,words,wordEntries,joinEntries,key,cuePositions,match,parseVoices,extractLegacy};
});
