/* Android phone -> paired PC/TV: pitch/confidence only, never raw audio. */
(() => {
  'use strict';
  if(!window.VoxStageScoreHost?.mobile || window.VoxStageScoreHost.tv)return;
  const area=document.getElementById('pcRemoteControls');if(!area)return;
  const button=document.createElement('button');button.type='button';button.className='btn secondary';button.id='pcUseMicrophone';button.textContent='Usar como microfone';
  const label=document.createElement('small');label.id='pcMicrophoneStatus';label.setAttribute('role','status');
  area.append(button,label);
  let running=false,starting=false,generation=0,input=null,stream=null,context=null,capture=null,worker=null,timer=0,connection=null;
  let session=null,offset=0,busy=false,pending=null,sequence=0,lastSuccess=0,requestSequence=0;
  const sender=crypto.randomUUID();
  const api=body=>window.__TAURI__.core.invoke('mobile_remote_microphone',{...connection,body:body||null});
  function paint(){button.textContent=running||starting?'Parar microfone':'Usar como microfone';button.classList.toggle('active',running);}
  function stop(message='Microfone desligado.') {
    if(starting)window.VoxStageMicrophoneInput?.stop();
    const previous=session,peer=connection;generation++;running=false;starting=false;session=null;pending=null;clearInterval(timer);timer=0;
    input?.stop();input=null;stream?.getTracks().forEach(track=>track.stop());stream=null;
    try{capture?.port.postMessage({type:'stop'});capture?.disconnect();capture?.port.close();}catch{}
    capture=null;void context?.close();context=null;worker?.terminate();worker=null;busy=false;
    if(previous&&peer)void window.__TAURI__.core.invoke('mobile_remote_microphone',{...peer,body:{session:previous.session,epoch:previous.epoch,sender,leave:true}}).catch(()=>{});
    label.textContent=message;paint();
  }
  async function sync() {
    if(!running&&!starting||busy)return;busy=true;const token=generation;
    try {
      const sent=Date.now(),state=await api();const received=Date.now();
      if(token!==generation)return;
      if(!state.active){stop('Escolha Celular conectado e ative a pontuação no PC/TV.');return;}
      const rtt=received-sent;if(rtt>1500){label.textContent='Rede lenta. Aproxime-se do Wi‑Fi.';return;}
      offset=state.serverTime-(sent+received)/2;session=state;lastSuccess=received;
      label.textContent=`Microfone conectado · ${state.title||'VoxStage'} · ${Math.round(rtt)} ms de rede`;
      const frame=pending;pending=null;
      const body={session:state.session,epoch:state.epoch,sender,sequence:++sequence};
      if(frame&&frame.session===state.session&&frame.epoch===state.epoch)Object.assign(body,frame.detected,{capturedAt:frame.capturedAt+offset});
      await api(body);
    }catch(error){if(token===generation){label.textContent=String(error.message||error);if(Date.now()-lastSuccess>5000)stop('Conexão perdida. Reconecte ao QR do PC/TV.');}}
    finally{if(token===generation)busy=false;}
  }
  async function start() {
    if(running||starting){stop();return;}
    if(window.VoxStageScoring?.snapshot().armed){label.textContent='Encerre a pontuação deste celular antes de usá-lo como microfone.';return;}
    try {
      const url=new URL(document.getElementById('pcSyncLink').value.trim()||localStorage.getItem('voxstage-pc-sync-link'));
      connection={baseUrl:url.origin,token:decodeURIComponent(url.hash.slice(1))};if(!connection.token)throw new Error('Leia o QR do PC/TV primeiro.');
      const state=await api();if(!state.active)throw new Error('No PC/TV, escolha Celular conectado e ative a pontuação.');
      session=state;offset=state.serverTime-Date.now();lastSuccess=Date.now();starting=true;const token=++generation;paint();
      worker=new Worker('audio/pitch-worker.js');
      worker.onmessage=event=>{if(token!==generation||event.data.type!=='live')return;const packet=event.data;pending={detected:packet.detected,capturedAt:packet.centerTime,session:session?.session,epoch:packet.epoch};};
      worker.onerror=()=>stop('Falha ao analisar o microfone. Tente novamente.');
      const submit=packet=>{if(token!==generation||!session)return;worker.postMessage({type:'live',sequence:++requestSequence,epoch:session.epoch,centerTime:packet.capturedAt,samples:packet.samples,sampleRate:packet.sampleRate,noiseFloor:.0015},[packet.samples.buffer]);};
      if(window.VoxStageMicrophoneInput?.available())input=await window.VoxStageMicrophoneInput.open(submit,error=>stop(error.message));
      else {
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Use o app Android atualizado para acessar o microfone.');
        const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
        if(token!==generation){acquired.getTracks().forEach(track=>track.stop());return;}
        stream=acquired;const audio=new AudioContext();context=audio;await audio.resume();
        if(token!==generation){void audio.close();return;}
        await audio.audioWorklet.addModule('audio/microphone-worklet.js');
        if(token!==generation){void audio.close();return;}
        capture=new AudioWorkletNode(context,'voxstage-microphone');
        const source=context.createMediaStreamSource(stream),sink=context.createGain();sink.gain.value=0;source.connect(capture);capture.connect(sink);sink.connect(context.destination);
        capture.port.onmessage=event=>submit({...event.data,capturedAt:Date.now()-(context.currentTime-event.data.centerTime)*1000});
        capture.port.postMessage({type:'active',active:true,epoch:0});
      }
      if(token!==generation){input?.stop();input=null;return;}
      starting=false;running=true;paint();timer=setInterval(sync,100);void sync();
    }catch(error){stop(String(error.message||error));}
  }
  button.onclick=start;
  window.addEventListener('pagehide',()=>stop());document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop('Microfone encerrado ao sair do app.');});
  window.VoxStagePhoneMicrophone={stop,snapshot:()=>({running,starting})};
})();
