/* Foreground native microphone adapter, shared by local and phone scoring. */
(() => {
  'use strict';
  let active=null;
  window.VoxStageMicrophoneInput={
    available:()=>Boolean(window.VoxStageNativeMic),
    open(onFrame,onError) {
      if(!window.VoxStageNativeMic)return Promise.reject(new Error('Atualize o app Android para usar o microfone.'));
      active?.stop();
      const id=crypto.randomUUID();let ready=false,stopped=false,resolveReady,rejectReady,timer;
      const promise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
      const stop=error=>{if(stopped)return;stopped=true;clearTimeout(timer);window.removeEventListener('voxstage-native-microphone',receive);window.removeEventListener('voxstage-microphone-background',background);if(active?.id===id){window.VoxStageNativeMic.stop();active=null;}if(!ready)rejectReady(error||new Error('Captura cancelada.'));};
      const background=()=>{stop();onError(new Error('Microfone encerrado ao sair do app. Volte e ative novamente.'));};
      function receive(event) {
        const packet=event.detail;if(packet?.id!==id)return;
        if(packet.type==='ready'){ready=true;clearTimeout(timer);resolveReady({stop});}
        else if(packet.type==='error'){const error=new Error(packet.message);stop(error);onError(error);}
        else if(packet.type==='frame' && ready){
          const bytes=Uint8Array.from(atob(packet.pcm),character=>character.charCodeAt(0)),view=new DataView(bytes.buffer);
          const samples=Float32Array.from({length:bytes.length/2},(_,index)=>view.getInt16(index*2,true)/32768);
          const ageMs=Math.max(0,Number(packet.ageMs)||0);
          if(ageMs>500)return;
          onFrame({samples,sampleRate:packet.sampleRate,capturedAt:Date.now()-ageMs,ageMs});
        }
      }
      active={id,stop};window.addEventListener('voxstage-native-microphone',receive);window.addEventListener('voxstage-microphone-background',background);
      timer=setTimeout(()=>{stop();onError(new Error('O microfone não respondeu. Tente novamente.'));},30000);
      window.VoxStageNativeMic.start(id);return promise;
    },
    stop:()=>active?.stop()
  };
})();
