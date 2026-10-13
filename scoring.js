/* Local vocal chart and microphone scoring, across desktop and Android/TV. */
(() => {
  'use strict';
  const host = window.VoxStageScoreHost, pitch = window.VoxStagePitch;
  if (!host || !pitch) return;
  const byId = id => document.getElementById(id);
  let settings = {device:host.tv?'phone':'', reference:'Vocals', tolerance:75, acceptOctave:true, noiseDb:-48, offsetMs:0, overlay:true, laneLyrics:host.mobile&&!host.tv};
  try { Object.assign(settings, JSON.parse(localStorage.getItem('voxstage-score-settings') || '{}')); } catch {}
  settings.tolerance = [40,75,100].includes(Number(settings.tolerance)) ? Number(settings.tolerance) : 75;
  settings.offsetMs = Math.max(-300, Math.min(500, Number(settings.offsetMs) || 0));
  settings.noiseDb = Math.max(-80, Math.min(-6, Number.isFinite(Number(settings.noiseDb)) ? Number(settings.noiseDb) : -48));
  if (!['Vocals','All','Lead','Back','Custom'].includes(settings.reference)) settings.reference = 'Vocals';
  let armed = false, preparing = false, epoch = 0, prepareSequence = 0, sequence = 0;
  let stream = null, source = null, capture = null, sink = null, loadedContext = null;
  let liveWorker = null, referenceWorker = null, rejectReference = null, pendingLive = null;
  let reference = null, score = null, songId = null, songTitle = '', inputLatency = 0, customReference = null;
  let lastDetected = null, lastExpected = null, lastSourceTime = 0, activeCapture = false, priorToken = null;
  let history = [], lastResult = null, trail = [], lastDraw = 0, cacheDatabase = null;
  const displaySmoother = new pitch.PitchDisplaySmoother(), graphViews = new WeakMap();
  let displayFrequency = 0;
  let nativeInput=null, phoneSession=null, phoneBusy=false, phoneLastReceived=0;
  try { history = JSON.parse(localStorage.getItem('voxstage-score-history') || '[]').slice(0,20); } catch {}
  const dialog = document.createElement('dialog'); dialog.id = 'scoreDialog'; dialog.className = 'score-dialog';
  dialog.innerHTML = `<header><div><small>VOXSTAGE</small><h2>Pontuação</h2></div><button type="button" id="scoreClose" class="x" aria-label="Fechar pontuação">×</button></header>
    <p>Cante acompanhando as notas. Cada nota acertada soma 1.000 pontos; os pontos conquistados ficam com você.</p>
    <aside class="score-headphone-advice"><b>🎧 Fones de ouvido recomendados</b><span>O som dos alto-falantes pode encobrir sua voz ou ser contado como canto. Use fones ou reduza o volume da música e ajuste o filtro abaixo.</span></aside>
    <div class="score-fields"><label>Microfone<select id="scoreDevice"><option value="">Microfone deste aparelho</option>${!host.mobile||host.tv?'<option value="phone">Celular conectado</option>':''}</select><button type="button" id="scoreConnectPhone" class="btn secondary" ${host.mobile&&!host.tv?'hidden':''}>Conectar celular</button></label>
    <label>Melodia de referência<select id="scoreReference"><option value="Vocals">Ambos os vocais · principal + backing</option><option value="All">3 trilhas · vocais + instrumental</option><option value="Lead">Vocais principais</option><option value="Back">Backing vocals</option><option value="Custom">Outro arquivo vocal…</option></select><small id="scoreReferenceHint"></small></label>
    <label>Tolerância<select id="scoreTolerance"><option value="100">Fácil · 100 cents</option><option value="75">Normal · 75 cents</option><option value="40">Precisa · 40 cents</option></select></label>
    <label>Ajuste extra de atraso <output id="scoreOffsetValue">0 ms</output><input id="scoreOffset" type="range" min="-300" max="500" step="10"><small>Positivo compara sua voz com um trecho anterior. O atraso informado pelo dispositivo já é compensado.</small></label>
    <label>Filtro de sons baixos <output id="scoreNoiseValue">−48 dB</output><input id="scoreNoise" type="range" min="-80" max="-6" step="1"><small>Próximo de 0 dB: rejeita mais sons fracos. Mais negativo: capta sons mais fracos. Você pode ajustar durante o canto.</small><small id="scoreNoiseLive" role="status">Nível do microfone aparece durante a reprodução.</small></label>
    <label class="score-check"><input id="scoreOctave" type="checkbox"> Aceitar outra oitava</label>
    <label class="score-check"><input id="scoreOverlayToggle" type="checkbox"> Mostrar notas no palco</label>
    <label class="score-check"><input id="scoreLaneLyricsToggle" type="checkbox"> Letras abaixo da barra de canto<small id="scoreLaneLyricsHint"></small></label></div>
    <label id="scoreCustomLabel" hidden>Arquivo vocal alternativo<input id="scoreCustomFile" type="file" accept="audio/*"><small id="scoreCustomName">Escolha um vocal isolado, com o mesmo início da música.</small></label>
    <div id="scoreStatus" role="status">Escolha uma música com vocais separados para começar.</div>
    <p id="scoreReferenceSummary" hidden></p>
    <div class="score-progress"><span id="scoreDialogStars" class="score-stars"></span><strong id="scoreDialogPoints">0</strong><span id="scoreDialogHits">0 notas acertadas</span></div>
    <details class="score-diagnostics"><summary>Afinação e mapa vocal</summary><div class="score-readings"><span>Referência <b id="scoreExpected">—</b></span><span>Sua voz <b id="scoreActual">—</b></span><span>Diferença <b id="scoreCents">—</b></span><span>Nível <b id="scoreLevel">—</b></span></div>
    <canvas id="scorePreview" width="680" height="180" aria-label="Barras de notas esperadas e tom suavizado do microfone"></canvas><small class="score-legend">Principal em verde · backing em amarelo · instrumental em cinza. Azul: sua voz.</small></details>
    <div class="score-result" id="scoreResult" hidden></div>
    <footer><button class="btn secondary" type="button" id="scoreRefreshDevices">Atualizar microfones</button><button class="btn secondary" type="button" id="scoreReset">Nova tentativa</button><button class="btn" type="button" id="scoreStart">Ativar pontuação</button></footer>
    <details><summary>Últimas apresentações</summary><div id="scoreHistory"></div></details>`;
  document.body.append(dialog);
  const overlay = document.createElement('section'); overlay.id = 'scoreOverlay'; overlay.hidden = true;
  overlay.setAttribute('aria-label', 'Faixa de canto');
  overlay.innerHTML = `<div class="score-lane-heading"><div id="scoreOverlayNotes">Prepare os vocais</div><span id="scoreStars" class="score-stars"></span><button type="button" id="scoreOpenOverlay" title="Configurar pontuação"><span>PONTOS</span><b id="scorePoints">0</b></button></div><canvas id="scoreGraph" width="1100" height="150" aria-label="Notas chegando da direita até o cursor fixo de canto à esquerda"></canvas><div id="scoreLaneLyrics" aria-label="Letras da faixa de canto" hidden></div>`;
  byId('display').append(overlay);
  const button = document.createElement('button'); button.id = 'scoreOpen'; button.className = 'hud-btn'; button.textContent = '♪ Pontuar';
  host.transport.append(button);
  const section = document.createElement('section'); section.className = 'processing-section';
  section.innerHTML = '<b>Pontuação</b><button type="button" class="btn secondary" id="scoreOpenSettings">Configurar microfone e canto</button>';
  byId('settingsPaneDebug').append(section);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function status(message) { byId('scoreStatus').textContent = message; }
  function saveSettings() { try { localStorage.setItem('voxstage-score-settings', JSON.stringify(settings)); } catch {} }
  const lyricHome=byId('lyrics').parentElement, lyricAnchor=document.createComment('stage lyrics');
  lyricHome.insertBefore(lyricAnchor,byId('lyrics'));
  function portrait() { return host.mobile&&!host.tv&&matchMedia('(orientation: portrait)').matches; }
  function lyricsAllowed() {
    const song=host.state().song;
    return portrait() || [song?.wordTimings,song?.backingWordTimings].some(rows=>Array.isArray(rows)&&rows.some(row=>row.words?.some(cue=>cue.start!=null&&cue.end!=null&&Number.isFinite(Number(cue.start))&&Number(cue.end)>Number(cue.start))));
  }
  function layoutLyrics() {
    const vertical=portrait(), allowed=lyricsAllowed(), row=byId('scoreLaneLyrics'), lyrics=byId('lyrics');
    byId('scoreLaneLyricsToggle').disabled=!allowed;
    byId('scoreLaneLyricsToggle').checked=allowed&&settings.laneLyrics;
    byId('scoreLaneLyricsHint').textContent=allowed?'': 'Sincronize as palavras em Sync para usar as letras na faixa.';
    const visible=armed&&settings.overlay&&allowed&&settings.laneLyrics&&!host.state().manualSync;
    row.hidden=!visible;
    byId('display').classList.toggle('score-lane-portrait',vertical);
    byId('display').classList.toggle('score-lane-with-lyrics',visible);
    if(vertical&&visible) {
      if(lyrics.parentElement!==row){row.replaceChildren(lyrics);lyricSignature='';}
    } else if(lyrics.parentElement!==lyricHome) {lyricAnchor.after(lyrics);row.replaceChildren();lyricSignature='';}
  }
  function syncSettings() {
    byId('scoreDevice').value = settings.device; byId('scoreReference').value = settings.reference;
    byId('scoreTolerance').value = settings.tolerance; byId('scoreOffset').value = settings.offsetMs;
    byId('scoreNoise').value = settings.noiseDb; byId('scoreOctave').checked = settings.acceptOctave;
    byId('scoreOverlayToggle').checked = settings.overlay;
    layoutLyrics();
    byId('scoreOffsetValue').textContent = `${settings.offsetMs} ms`; byId('scoreNoiseValue').textContent = `${settings.noiseDb} dB`;
    byId('scoreCustomLabel').hidden = settings.reference !== 'Custom';
    byId('scoreReferenceHint').textContent = settings.reference === 'All' ? 'Prioriza os vocais; procura no instrumental quando não reconhece voz. Instrumentos podem ser confundidos com o cantor.' : settings.reference === 'Vocals' ? 'Analisa os dois stems separadamente e aceita a melodia reconhecida em qualquer vocal.' : '';
  }
  function lockControls() {
    for (const id of ['scoreDevice','scoreReference','scoreTolerance','scoreOctave','scoreCustomFile']) byId(id).disabled = armed || preparing;
    byId('scoreNoise').disabled = preparing;
    byId('scoreStart').textContent = preparing ? 'Cancelar preparação' : armed ? 'Encerrar pontuação' : 'Ativar pontuação';
    byId('scoreReset').disabled = preparing;
    overlay.hidden = !(armed && settings.overlay);
    byId('display').classList.toggle('score-lane-active', !overlay.hidden);
    byId('display').classList.toggle('score-lane-with-lyrics', !overlay.hidden && settings.laneLyrics);
    button.classList.toggle('active', armed);
    layoutLyrics();
  }
  async function refreshDevices() {
    try {
      const devices = window.VoxStageMicrophoneInput?.available() ? [] : await navigator.mediaDevices?.enumerateDevices() || [];
      byId('scoreDevice').innerHTML = '<option value="">Microfone deste aparelho</option>'+(!host.mobile||host.tv?'<option value="phone">Celular conectado</option>':'');
      for (const device of devices.filter(item => item.kind === 'audioinput' && item.deviceId && item.deviceId !== 'default' && item.deviceId !== 'communications')) {
        byId('scoreDevice').add(new Option(device.label || `Microfone ${byId('scoreDevice').options.length}`, device.deviceId));
      }
      byId('scoreDevice').value = settings.device;
      if (byId('scoreDevice').selectedIndex < 0) { settings.device = ''; byId('scoreDevice').value = ''; saveSettings(); }
    } catch { if (!armed) status('Não consegui listar os microfones. Confira a permissão no aparelho.'); }
  }
  function showDialog() {
    const parent = document.fullscreenElement || document.body;
    if (dialog.parentElement !== parent) parent.append(dialog);
    if (!dialog.open) { dialog.showModal(); dialog.scrollTop = 0; }
    syncSettings(); lockControls(); renderHistory(); void refreshDevices();
  }
  for (const id of ['scoreOpen','scoreOpenSettings','scoreOpenOverlay']) byId(id).onclick = showDialog;
  byId('scoreClose').onclick = () => dialog.close();
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  byId('scoreRefreshDevices').onclick = refreshDevices;
  byId('scoreConnectPhone').onclick=()=>{dialog.close();host.connectPhone();};
  navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
  for (const [id, key] of [['scoreDevice','device'],['scoreReference','reference'],['scoreTolerance','tolerance'],['scoreOffset','offsetMs'],['scoreNoise','noiseDb'],['scoreOctave','acceptOctave'],['scoreOverlayToggle','overlay'],['scoreLaneLyricsToggle','laneLyrics']]) {
    byId(id).addEventListener(id === 'scoreOffset' || id === 'scoreNoise' ? 'input' : 'change', event => {
      settings[key] = event.target.type === 'checkbox' ? event.target.checked : ['tolerance','offsetMs','noiseDb'].includes(key) ? Number(event.target.value) : event.target.value;
      saveSettings(); syncSettings(); lockControls(); if (key === 'offsetMs' || key === 'noiseDb') { score?.resetTimeline(); updateCapture(true); }
    });
  }
  byId('scoreCustomFile').onchange = () => { customReference = byId('scoreCustomFile').files[0] || null; byId('scoreCustomName').textContent = customReference?.name || 'Escolha um vocal isolado, com o mesmo início da música.'; reference = null; };
  async function database() {
    if (!cacheDatabase) cacheDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open('voxstage-score-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('maps', {keyPath:'key'});
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }).catch(() => null);
    return cacheDatabase;
  }
  async function cachedMap(key, value) {
    const db = await database(); if (!db) return null;
    return new Promise(resolve => {
      try {
        const transaction = db.transaction('maps', value ? 'readwrite' : 'readonly'), store = transaction.objectStore('maps');
        const request = value ? store.put({key, reference:value, savedAt:Date.now()}) : store.get(key);
        request.onsuccess = () => resolve(value || request.result?.reference || null);
        request.onerror = () => resolve(null); transaction.onabort = () => resolve(null);
        if (value) {
          const all = store.getAll(); all.onsuccess = () => all.result.sort((a,b) => b.savedAt-a.savedAt).slice(12).forEach(item => store.delete(item.key));
        }
      } catch { resolve(null); }
    });
  }
  async function prepareMap(song, context, generation) {
    const mode = settings.reference;
    const keys = mode === 'Vocals' ? ['Lead','Back'] : mode === 'All' ? ['Lead','Back','Inst'] : [mode];
    const buffers = mode === 'Custom'
      ? (customReference ? [{id:'Custom', buffer:await context.decodeAudioData(await customReference.arrayBuffer())}] : [])
      : keys.filter(id => song.buffers?.[id]).map(id => ({id, buffer:song.buffers[id]}));
    if (!buffers.length) throw new Error(mode === 'Custom' ? 'Escolha um arquivo vocal alternativo.' : 'Esta música não tem esse stem vocal. Separe os vocais ou escolha outro arquivo de referência.');
    if (generation !== prepareSequence) throw new Error('Preparação cancelada.');
    const tracks = [], hashes = [];
    for (const {id, buffer} of buffers) {
      // Analyze stems independently: mixing lead/back would hide simultaneous notes.
      // Use the stronger channel; stereo cancellation must not erase the reference.
      let channel = 0, strongest = -1;
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        const data = buffer.getChannelData(i); let energy = 0;
        for (let j = 0; j < data.length; j += 100) energy += data[j] ** 2;
        if (energy > strongest) { strongest = energy; channel = i; }
      }
      const original=buffer.getChannelData(channel);
      const samples = buffer.sampleRate===pitch.RATE ? original.slice() : pitch.resample(original,buffer.sampleRate);
      const hash = await crypto.subtle.digest('SHA-256', samples.buffer);
      tracks.push({id, samples, sampleRate:pitch.RATE});
      hashes.push(`${id}:${pitch.RATE}:` + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join(''));
      if (generation !== prepareSequence) throw new Error('Preparação cancelada.');
    }
    const key = `yin5-notes:${mode}:${hashes.join(':')}`;
    const cached = await cachedMap(key);
    if (generation !== prepareSequence) throw new Error('Preparação cancelada.');
    if (cached) { status('Mapa vocal recuperado deste computador.'); return cached; }
    const result = await new Promise((resolve, reject) => {
      rejectReference = reject; referenceWorker = new Worker('audio/pitch-worker.js');
      referenceWorker.onerror = () => reject(new Error('Não consegui analisar o arquivo vocal.'));
      referenceWorker.onmessage = event => {
        if (event.data.type === 'progress') status(`Preparando mapa vocal… ${Math.round(event.data.progress * 100)}%`);
        if (event.data.type === 'reference') resolve(event.data.reference);
        if (event.data.type === 'error') reject(new Error(event.data.message));
      };
      referenceWorker.postMessage({type:'reference', id:generation, mode, tracks}, tracks.map(track => track.samples.buffer));
    });
    referenceWorker?.terminate(); referenceWorker = null; rejectReference = null;
    if (generation !== prepareSequence) throw new Error('Preparação cancelada.');
    await cachedMap(key, result); return result;
  }
  function updateCapture(force = false) {
    const state = host.state();
    const active = armed && state.playing && state.song?.id === songId && !state.manualSync;
    if (force || active !== activeCapture || state.token !== priorToken) {
      activeCapture = active; priorToken = state.token; epoch++; pendingLive = null;
      displaySmoother.reset();
      score?.resetTimeline(); capture?.port.postMessage({type:'active', active, epoch});
    }
    return state;
  }
  function acceptLive(data) {
    if (data.type === 'error') { stopScoring('error'); status('Falha na análise do microfone. Tente ativar novamente.'); return; }
    if (data.type !== 'live' || !pendingLive || data.sequence !== pendingLive.sequence) return;
    const packet = pendingLive; pendingLive = null;
    const state = host.state();
    if (!armed || !state.playing || packet.epoch !== epoch || data.epoch !== epoch || state.song?.id !== songId) return;
    lastSourceTime = packet.time; lastDetected = data.detected;
    if (packet.excluded) { score.resetTimeline(); lastExpected = null; }
    else lastExpected = score.add(packet.time, data.detected, {...settings, transpose:packet.transpose});
    displayFrequency = displaySmoother.add(packet.time / state.speed, packet.excluded ? null : data.detected);
    trail.push({time:packet.time, frequency:displayFrequency, transpose:packet.transpose, epoch});
    if (trail.length > 240) trail.shift();
    updateReadings();
  }
  function receiveCapture(event) {
    const data = event.data, state = updateCapture();
    if (!activeCapture || data.epoch !== epoch || pendingLive) return;
    const outputLatency = Number(state.context.outputLatency || state.context.baseLatency || 0);
    const time = state.base + (data.centerTime - state.startTime - state.latency - outputLatency - inputLatency - settings.offsetMs / 1000) * state.speed;
    if (time < state.base || time >= state.song.buffers.Inst.duration) { score?.resetTimeline(); return; }
    pendingLive = {sequence:++sequence, epoch, time, transpose:state.transpose, excluded:state.song.profanityMuted};
    liveWorker.postMessage({type:'live', sequence, epoch, centerTime:data.centerTime, samples:data.samples,
      sampleRate:data.sampleRate, noiseFloor:10 ** (settings.noiseDb / 20)}, [data.samples.buffer]);
  }
  async function startScoring() {
    if (armed || preparing) { stopScoring(preparing ? 'cancel' : 'partial'); return; }
    const state = host.state();
    if (!state.song?.buffers?.Inst) { status('Abra uma música e aguarde o carregamento do áudio.'); return; }
    if (state.manualSync) { status('Termine a sincronização de letras antes de pontuar.'); return; }
    if (settings.device!=='phone' && !window.VoxStageMicrophoneInput?.available() && !navigator.mediaDevices?.getUserMedia) { status('O microfone não está disponível nesta janela.'); return; }
    const generation = ++prepareSequence;
    host.pause();
    preparing = true; byId('scoreResult').hidden = true; lockControls(); status('Preparando a referência vocal…');
    try {
      await host.ensureAudio();
      window.VoxStagePhoneMicrophone?.stop();
      reference = await prepareMap(state.song, host.state().context, generation);
      if (generation !== prepareSequence || host.state().song?.id !== state.song.id) return;
      const voiced = reference.frequencies.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
      if (voiced * reference.step < 2) throw new Error('Não encontrei pelo menos 2 segundos de melodia confiável. Escolha um vocal isolado diferente.');
      liveWorker = new Worker('audio/pitch-worker.js'); liveWorker.onmessage = event => acceptLive(event.data);
      liveWorker.onerror = () => { stopScoring('error'); status('Falha na análise do microfone. Tente ativar novamente.'); };
      if(settings.device==='phone') {
        await host.api('/api/remote/host-info');
        phoneSession=crypto.randomUUID();
        await publishPhoneSession();
        status('No app Android, conecte pelo QR e toque em Usar como microfone. Aguardando celular…');
        const deadline=Date.now()+30000;
        while(generation===prepareSequence && Date.now()<deadline) {
          const response=await host.api('/api/remote/microphone/frames');
          if(response.ready)break;
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        if(generation!==prepareSequence)return;
        const response=await host.api('/api/remote/microphone/frames');
        if(!response.ready)throw new Error('Celular não conectado. Leia o QR e ative Usar como microfone no app Android.');
        phoneLastReceived=Date.now();
      } else if(window.VoxStageMicrophoneInput?.available()) {
        status('Aguardando permissão do microfone…');
        nativeInput=await window.VoxStageMicrophoneInput.open(packet=>{
          const state=updateCapture();
          if(!activeCapture||pendingLive)return;
          const outputLatency=Number(state.context.outputLatency||state.context.baseLatency||0);
          const time=state.position-(packet.ageMs/1000+outputLatency+settings.offsetMs/1000)*state.speed;
          if(time<0||time>=state.song.buffers.Inst.duration)return;
          pendingLive={sequence:++sequence,epoch,time,transpose:state.transpose,excluded:state.song.profanityMuted};
          liveWorker.postMessage({type:'live',sequence,epoch,samples:packet.samples,sampleRate:packet.sampleRate,noiseFloor:10**(settings.noiseDb/20)},[packet.samples.buffer]);
        },error=>{if(generation===prepareSequence){stopScoring('error');status(error.message);}});
      } else {
      status('Aguardando acesso ao microfone…');
      const acquired = await navigator.mediaDevices.getUserMedia({audio:{deviceId:settings.device ? {exact:settings.device} : undefined,
        channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false}, video:false});
      if (generation !== prepareSequence || host.state().song?.id !== state.song.id) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      const context = host.state().context;
      if (loadedContext !== context) { await context.audioWorklet.addModule('audio/microphone-worklet.js'); loadedContext = context; }
      if (generation !== prepareSequence) { acquired.getTracks().forEach(track => track.stop()); return; }
      inputLatency = Math.max(0, Math.min(.5, Number(stream.getAudioTracks()[0].getSettings().latency) || 0));
      capture = new AudioWorkletNode(context, 'voxstage-microphone', {numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1]});
      capture.port.onmessage = receiveCapture;
      source = context.createMediaStreamSource(stream); sink = context.createGain(); sink.gain.value = 0;
      source.connect(capture); capture.connect(sink); sink.connect(context.destination);
      stream.getAudioTracks()[0].onended = () => { if (armed) { stopScoring('error'); status('O microfone foi desconectado. Escolha outro e tente novamente.'); } };
      }
      if(generation!==prepareSequence || host.state().song?.id!==state.song.id){nativeInput?.stop();nativeInput=null;return;}
      songId = state.song.id; songTitle = state.song.title || 'Música'; score = new pitch.Score(reference); trail = [];
      lastDetected = null; lastExpected = null; lastResult = null; lastSourceTime = 0; displayFrequency = 0; displaySmoother.reset(); armed = true; preparing = false;
      updateCapture(true); lockControls(); await refreshDevices();
      if (generation !== prepareSequence || !armed || host.state().song?.id !== songId) return;
      const referencePercent = voiced * reference.step / reference.duration * 100;
      byId('scoreReferenceSummary').hidden = false;
      const noteCount = reference.tracks.reduce((count,track)=>count+(track.notes?.length||0),0);
      byId('scoreReferenceSummary').textContent = `Mapa vocal: ${noteCount} ${noteCount===1?'barra':'barras'} · ${(voiced * reference.step).toFixed(1)} s reconhecidos (${referencePercent.toFixed(0)}% da faixa). ${referencePercent < 10 ? 'Pouca melodia reconhecida: confira a referência ou escolha outro vocal.' : 'Confira se as barras acompanham o cantor.'}`;
      status(`Pronto · ${(voiced * reference.step).toFixed(1)} s de referência vocal (${referencePercent.toFixed(0)}% da faixa). Cante acompanhando a música desde o início.`);
      host.restart();
      dialog.close();byId('processingDialog').classList.remove('show');byId('display').classList.add('show');
      if(host.mobile&&!host.tv&&!portrait()&&!byId('display').classList.contains('mobile-controls-hidden')) byId('mobileControlsToggle').click();
    } catch (error) {
      if (generation !== prepareSequence) return;
      stopScoring('error');
      const message = error.name === 'NotAllowedError' ? 'Acesso ao microfone negado. Libere-o nas permissões do aparelho e tente novamente.'
        : error.name === 'NotFoundError' || error.name === 'OverconstrainedError' ? 'Microfone não encontrado. Atualize a lista e escolha outro.' : error.message;
      status(message || 'Não consegui iniciar a pontuação.');
    } finally { if (generation === prepareSequence) { preparing = false; lockControls(); } }
  }
  function stopScoring(reason = 'partial') {
    const wasArmed = armed,wasPreparing=preparing; armed = false; preparing = false; prepareSequence++; epoch++; pendingLive = null;
    referenceWorker?.terminate(); referenceWorker = null; rejectReference?.(new Error('Preparação cancelada.')); rejectReference = null;
    liveWorker?.terminate(); liveWorker = null;
    displaySmoother.reset();
    try { capture?.port.postMessage({type:'stop'}); capture?.disconnect(); capture?.port.close(); } catch {}
    try { source?.disconnect(); sink?.disconnect(); } catch {}
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream = null; capture = null; source = null; sink = null; activeCapture = false;
    nativeInput?.stop();nativeInput=null;if(wasPreparing&&settings.device!=='phone')window.VoxStageMicrophoneInput?.stop();
    if(phoneSession){phoneSession=null;void host.api('/api/remote/microphone/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:null})}).catch(()=>{});}
    lockControls();
    if (wasArmed && score && !['reset','unload','error'].includes(reason)) {
      const result = {...score.result(), title:songTitle, endedAt:Date.now(), partial:reason !== 'finish', tolerance:settings.tolerance, acceptOctave:settings.acceptOctave, referenceMode:reference?.mode || settings.reference};
      if (result.seconds >= 2) {
        lastResult = result; history.unshift(result); history = history.slice(0,20);
        try { localStorage.setItem('voxstage-score-history', JSON.stringify(history)); } catch {}
        renderResult(result); renderHistory();
        host.toast(`Pontuação${result.partial ? ' parcial' : ''}: ${result.points.toLocaleString('pt-BR')} · ${result.hitNotes}/${result.totalNotes} notas`);
        if (reason === 'finish') showDialog();
      } else { status('Menos de 2 segundos avaliados. Cante um trecho maior para obter uma pontuação.'); }
    } else if (reason === 'cancel') status('Preparação cancelada.');
  }
  function renderResult(result) {
    byId('scoreResult').hidden = false;
    byId('scoreResult').innerHTML = `<small>${result.partial ? 'RESULTADO PARCIAL' : 'APRESENTAÇÃO CONCLUÍDA'}</small><div class="score-stars${result.gold?' gold':''}">${starsMarkup(result)}</div><strong>${result.points.toLocaleString('pt-BR')} <span>pontos</span></strong><p>${escape(result.title)} · ${result.hitNotes}/${result.totalNotes} notas (${result.accuracy.toFixed(1)}%).</p><small>5 estrelas: 45% · douradas: 55%. Uma nota conta ao cantar pelo menos 35% dela dentro da tolerância. Partes sem referência ficam fora do mapa.</small>`;
  }
  function renderHistory() {
    byId('scoreHistory').innerHTML = history.length ? history.map(result => `<p><b>${Number(result.points).toLocaleString('pt-BR')} ${result.hitNotes==null?'/ 10.000 · avaliação anterior':'pontos'}</b> · ${escape(result.title)}${result.partial ? ' · parcial' : ''}<br><small>${new Date(result.endedAt).toLocaleString('pt-BR')}${result.hitNotes!=null?` · ${result.hitNotes}/${result.totalNotes} notas`:''}</small></p>`).join('') : '<p>Nenhuma apresentação pontuada neste aparelho.</p>';
  }
  function starsMarkup(result) {return Array.from({length:5},(_,index)=>`<span class="${index<(result?.stars||0)?'earned':''}" aria-hidden="true">★</span>`).join('');}
  function updateReadings() {
    const actual = displayFrequency;
    const expected = lastExpected?.frequency || 0;
    const cents = pitch.centsDifference(actual, expected, settings.acceptOctave);
    const trackLabel = {Lead:'Principal',Back:'Backing',Inst:'Instrumental',Custom:'Arquivo'}[lastExpected?.track];
    byId('scoreExpected').textContent = pitch.noteName(expected); byId('scoreExpected').title = trackLabel || '';
    byId('scoreActual').textContent = pitch.noteName(actual);
    byId('scoreCents').textContent = cents === null ? '—' : `${cents > 0 ? '+' : ''}${Math.round(cents)} cents`;
    byId('scoreLevel').textContent = lastDetected?.rms > 0 ? `${Math.round(20 * Math.log10(lastDetected.rms))} dB` : '—';
    byId('scoreNoiseLive').textContent = lastDetected?.rms > 0 ? `Microfone: ${byId('scoreLevel').textContent} · ${lastDetected.rms >= 10**(settings.noiseDb/20) ? 'acima do filtro' : 'abaixo do filtro; não pontua'}` : 'Aguardando som do microfone durante a reprodução.';
    const result = score?.result();
    byId('scorePoints').textContent = (result?.points||0).toLocaleString('pt-BR');
    byId('scoreDialogPoints').textContent = byId('scorePoints').textContent;
    for(const id of ['scoreStars','scoreDialogStars']){const node=byId(id);node.innerHTML=starsMarkup(result);node.classList.toggle('gold',Boolean(result?.gold));node.setAttribute('aria-label',`${result?.stars||0} de 5 estrelas${result?.gold?' douradas':''}`);}
    byId('scoreDialogHits').textContent=`${result?.hitNotes||0}/${result?.totalNotes||0} notas acertadas`;
    byId('scoreOverlayNotes').textContent = !host.state().playing ? 'Pausado' : expected ? actual ? Math.abs(cents) <= settings.tolerance ? 'Na melodia' : 'Acompanhe as notas' : 'Sua vez de cantar' : 'Intervalo';
  }
  let lyricRefreshAt = 0, lyricCues = [], lyricSignature = '';
  function drawLaneLyrics(state, time, x, width) {
    const row = byId('scoreLaneLyrics');
    if (!settings.laneLyrics || row.hidden || portrait()) return;
    if (performance.now() - lyricRefreshAt > 90) {
      lyricRefreshAt = performance.now();
      lyricCues = (host.lyricCues?.(time - .9, time + 7.1) || []).filter(cue=>!cue.line);
      const signature = JSON.stringify(lyricCues);
      if (signature !== lyricSignature) {
        lyricSignature = signature;
        row.innerHTML = lyricCues.map(cue => `<span class="score-lane-word${cue.backing ? ' backing' : ''}${cue.censored ? ' censored' : ''}"${cue.censored ? '' : ` title="${escape(cue.text)}"`}>${escape(cue.censored ? '•••' : cue.text)}</span>`).join('');
      }
      row.classList.toggle('score-lyrics-empty', !lyricCues.length);
      row.setAttribute('aria-label', lyricCues.length ? 'Letras adicionais sincronizadas' : 'Letras adicionais: esta parte não tem letra sincronizada');
    }
    const scale = row.clientWidth / width;
    lyricCues.forEach((cue, index) => {
      const node = row.children[index]; if (!node) return;
      // A line-only lyric stays readable at the cursor; explicit word cues scroll.
      const left = cue.line && cue.start <= time && cue.end > time ? x(time) : x(cue.start);
      const next = lyricCues.slice(index+1).find(other => other.backing === cue.backing);
      const limit = cue.line ? width : Math.min(width, x(Math.max(cue.end, next?.start ?? cue.end)) - 6);
      node.style.left = `${left * scale}px`;
      node.style.maxWidth = `${Math.max(12, (limit-left)*scale)}px`;
      node.classList.toggle('active', cue.start <= time && cue.end > time);
    });
  }
  function drawGraph(canvas, state) {
    const lane = canvas.id === 'scoreGraph';
    if (lane) {
      const size = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(size.width * ratio), pixelHeight = Math.round(size.height * ratio);
      if (!pixelWidth || !pixelHeight) return;
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    }
    const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
    ctx.clearRect(0,0,width,height); ctx.fillStyle = lane ? '#111521d9' : '#101218'; ctx.fillRect(0,0,width,height);
    if (!reference) return;
    const time = armed ? state.position : lastSourceTime, cursor = lane ? width * .12 : width / 2;
    const behind = lane ? .96 : 4, ahead = lane ? 7.04 : 4;
    const first = Math.max(0, Math.floor((time - behind - reference.start) / reference.step));
    const last = Math.min(reference.frequencies.length, Math.ceil((time + ahead - reference.start) / reference.step));
    const bars=[];
    for (const track of reference.tracks || []) for (const note of track.notes || []) {
      const begin=Math.max(first,note.startIndex), end=Math.min(last,note.endIndex);
      if (begin>=end) continue;
      if (track.id!=='Inst') { bars.push({begin,end,note:note.midi+state.transpose,id:track.id}); continue; }
      // Split instrumental bars around reliable vocals, exactly as scoring does.
      let open=-1;
      for(let index=begin;index<=end;index++) {
        const visible=index<end && pitch.referenceCandidates(reference,index).some(candidate=>candidate.track==='Inst');
        if(visible && open<0)open=index;
        if(!visible && open>=0){bars.push({begin:open,end:index,note:note.midi+state.transpose,id:track.id});open=-1;}
      }
    }
    const pitches=bars.map(bar=>bar.note), low=pitches.length?Math.min(...pitches):48, high=pitches.length?Math.max(...pitches):72;
    const target=(low+high)/2, span=Math.max(lane ? 14 : 24,high-low+6);
    let view=graphViews.get(canvas);
    if(!view || view.reference!==reference || Math.abs(time-view.time)>1) view={reference,center:target,span,time};
    else { const smoothing=1-Math.exp(-Math.max(0,time-view.time)*2);view.center+=(target-view.center)*smoothing;view.span+=(span-view.span)*smoothing;view.time=time; }
    graphViews.set(canvas,view);
    const center=view.center;
    const x = t => cursor + (t - time) * width / 8;
    if(lane) canvas.dataset.cursorRatio = '.12';
    const noteY = note => height / 2 - (note-center)*height/view.span;
    const y = frequency => noteY(pitch.midi(frequency));
    ctx.strokeStyle = '#ffffff15'; ctx.lineWidth = 1;
    for (let note = Math.ceil(center-view.span/2); note<=center+view.span/2; note+=lane ? 4 : 2) { const yy=noteY(note);ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(width,yy);ctx.stroke(); }
    let connected = false, previousBar = null, connectors = 0;
    for (const bar of bars) {
      const color={Lead:lane ? '#68d8ff' : '#d4fb69',Back:'#ffd166',Inst:'#c0c5d0',Custom:lane ? '#68d8ff' : '#d4fb69'}[bar.id] || '#d4fb69';
      const begin=Math.max(0,x(reference.start+(bar.begin-.5)*reference.step)),end=Math.min(width,x(reference.start+(bar.end-.5)*reference.step));
      const yy=noteY(bar.note),band=Math.max(3,settings.tolerance/100*height/view.span);
      if(lane && previousBar?.id===bar.id && previousBar.end===bar.begin && Math.abs(previousBar.note-bar.note)<=7) {
        const junction=x(reference.start+(bar.begin-.5)*reference.step), ramp=Math.min(width*.008,(end-begin)/3);
        ctx.strokeStyle=color;ctx.lineWidth=height*.055;ctx.beginPath();ctx.moveTo(junction-ramp,noteY(previousBar.note));ctx.lineTo(junction+ramp,yy);ctx.stroke();connectors++;
      }
      ctx.fillStyle=color+'20';ctx.fillRect(begin,yy-band,Math.max(1,end-begin),band*2);
      ctx.strokeStyle=color;ctx.lineWidth=lane ? height*.055 : 4;ctx.lineCap='butt';ctx.beginPath();ctx.moveTo(begin,yy);ctx.lineTo(Math.max(begin+1,end-1),yy);ctx.stroke();
      if(lane && begin<cursor && end>cursor && displayFrequency && lastExpected?.track===bar.id && Math.abs(pitch.centsDifference(displayFrequency,pitch.frequencyForNote(bar.note),settings.acceptOctave))<=settings.tolerance) {
        ctx.strokeStyle='#d4fb69';ctx.beginPath();ctx.moveTo(begin,yy);ctx.lineTo(cursor,yy);ctx.stroke();
      }
      previousBar=bar;
    }
    if(lane) {
      canvas.dataset.connectors=String(connectors);
      ctx.fillStyle='#090d1880';ctx.fillRect(0,0,cursor,height);
      ctx.strokeStyle='#82dfff';ctx.lineWidth=2;ctx.shadowColor='#66d4ff';ctx.shadowBlur=10;
      ctx.beginPath();ctx.moveTo(cursor,0);ctx.lineTo(cursor,height);ctx.stroke();
      const point=trail[trail.length-1];
      let frequency=point?.frequency && Math.abs(point.time-time)<.35 && point.epoch===epoch ? point.frequency : 0;
      if(frequency && settings.acceptOctave) {
        const expected=pitch.referenceAt(reference,point.time,point.transpose,frequency,true)?.frequency;
        if(expected)frequency*=2**Math.round(Math.log2(expected/frequency));
      }
      const yy=frequency ? Math.max(10,Math.min(height-10,y(frequency))) : height/2, size=height*.075;
      ctx.fillStyle=frequency ? '#e7faff' : '#7795a9';ctx.beginPath();ctx.moveTo(cursor+size,yy);ctx.lineTo(cursor-size,yy-size*.65);ctx.lineTo(cursor-size,yy+size*.65);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
      drawLaneLyrics(state,time,x,width);
      return;
    }
    ctx.strokeStyle = '#66d4ff'; ctx.lineWidth = 2; connected = false; ctx.beginPath();
    let trailEpoch=null;
    for (const point of trail) {
      if(point.epoch!==trailEpoch){connected=false;trailEpoch=point.epoch;}
      if (!point.frequency || Math.abs(point.time - time) > 4) { connected = false; continue; }
      let frequency = point.frequency;
      const expected = pitch.referenceAt(reference, point.time, point.transpose, point.frequency, settings.acceptOctave)?.frequency;
      if (expected && settings.acceptOctave) frequency *= 2 ** Math.round(Math.log2(expected / frequency));
      const xx = x(point.time), yy = y(frequency);
      if (connected) ctx.lineTo(xx,yy); else ctx.moveTo(xx,yy); connected = true;
    }
    ctx.stroke();
    const currentPoint=trail[trail.length-1];
    if(currentPoint?.frequency && Math.abs(currentPoint.time-time)<.35 && currentPoint.epoch===epoch) {
      let frequency=currentPoint.frequency;
      const expected=pitch.referenceAt(reference,currentPoint.time,currentPoint.transpose,frequency,settings.acceptOctave)?.frequency;
      if(expected && settings.acceptOctave)frequency*=2**Math.round(Math.log2(expected/frequency));
      ctx.fillStyle='#66d4ff';ctx.beginPath();ctx.arc(x(currentPoint.time),y(frequency),3,0,Math.PI*2);ctx.fill();
    }
    ctx.strokeStyle = '#ffffff70'; ctx.beginPath(); ctx.moveTo(width / 2,0); ctx.lineTo(width / 2,height); ctx.stroke();
  }
  byId('scoreStart').onclick = startScoring;
  byId('scoreReset').onclick = () => {
    if (armed) { score = new pitch.Score(reference); trail = []; lastDetected = null; lastExpected = null; lastSourceTime = 0; displayFrequency = 0; displaySmoother.reset(); host.restart(); status('Nova tentativa iniciada desde o começo.'); }
    else { lastResult = null; byId('scoreResult').hidden = true; void startScoring(); }
    updateReadings();
  };
  window.addEventListener('voxstage-score-playback', event => {
    if (event.detail.type === 'finish' || event.detail.type === 'stop') {
      if (armed || preparing) stopScoring(event.detail.type);
      if (event.detail.type === 'stop') { reference = null; customReference = null; byId('scoreCustomFile').value = ''; byId('scoreReferenceSummary').hidden = true; }
    } else {
      updateCapture(true);
      if (armed) status(event.detail.type === 'pause' ? 'Pausado · a pontuação não avança.' : 'Cante acompanhando a melodia.');
    }
  });
  window.addEventListener('pagehide', () => stopScoring('unload'));
  window.addEventListener('resize',()=>{layoutLyrics();fitStageLyrics();});
  let phonePublishedAt=0;
  async function publishPhoneSession() {
    if(!phoneSession)return;
    phonePublishedAt=Date.now();
    await host.api('/api/remote/microphone/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:phoneSession,epoch,title:host.state().song?.title||'',active:armed||preparing})});
  }
  async function pollPhone() {
    if(!phoneSession||(!armed&&!preparing)||phoneBusy)return;
    phoneBusy=true;const session=phoneSession;
    try {
      if(Date.now()-phonePublishedAt>250)await publishPhoneSession();
      if(!armed)return;
      const response=await host.api('/api/remote/microphone/frames');
      if(session!==phoneSession||!armed)return;
      const state=updateCapture();
      for(const frame of response.frames||[]) {
        if(frame.session!==session||frame.epoch!==epoch||Date.now()-frame.capturedAt>1500)continue;
        phoneLastReceived=Date.now();
        if(!activeCapture)continue;
        const outputLatency=Number(state.context.outputLatency||state.context.baseLatency||0);
        const time=state.position+((frame.capturedAt-Date.now())/1000-outputLatency-settings.offsetMs/1000)*state.speed;
        if(time<0||time>=state.song.buffers.Inst.duration)continue;
        pendingLive={sequence:++sequence,epoch,time,transpose:state.transpose,excluded:state.song.profanityMuted};
        const detected=frame.rms>=10**(settings.noiseDb/20)?frame:{frequency:0,confidence:0,rms:frame.rms};
        acceptLive({type:'live',sequence,epoch,detected});
      }
      if(Date.now()-phoneLastReceived>8000){host.pause();stopScoring('error');host.toast('Microfone do celular desconectado. Volte ao app e ative novamente.');}
      else if(Date.now()-phoneLastReceived>1800){displayFrequency=0;byId('scoreOverlayNotes').textContent='Aguardando microfone do celular…';}
    } catch { if(Date.now()-phoneLastReceived>8000){host.pause();stopScoring('error');host.toast('Conexão com o microfone interrompida.');} }
    finally{phoneBusy=false;}
  }
  setInterval(pollPhone,80);
  setInterval(() => {
    const state = updateCapture();
    if (armed && state.song?.id !== songId) stopScoring('stop');
    if (armed && state.manualSync) status('Pontuação suspensa durante a sincronização de letras.');
    if (performance.now() - lastDraw < 90) return; lastDraw = performance.now();
    if (dialog.open && dialog.querySelector('.score-diagnostics').open) drawGraph(byId('scorePreview'), state);
    layoutLyrics();
  }, 100);
  // Only animate the highway while it is on screen; the capture/scoring clock is independent.
  let laneFrame = 0;
  let laneDrawAt=0;
  function animateLane() {
    laneFrame = 0;
    if (document.hidden || overlay.hidden || !byId('display').classList.contains('show')) return;
    const state=host.state(),now=performance.now();
    if(now-laneDrawAt>(state.playing?(host.mobile?33:15):150)){laneDrawAt=now;drawGraph(byId('scoreGraph'),state);}
    laneFrame = requestAnimationFrame(animateLane);
  }
  const wakeLane = () => { if (!laneFrame && !document.hidden && !overlay.hidden && byId('display').classList.contains('show')) laneFrame = requestAnimationFrame(animateLane); };
  function fitStageLyrics() {
    const stage=byId('display');
    if(overlay.hidden || !stage.classList.contains('show')) return;
    const controls=stage.querySelector('.display-bottom');
    const compact=host.mobile&&!host.tv&&!portrait();
    const top=overlay.getBoundingClientRect().bottom+(compact?12:24);
    const bottom=stage.classList.contains('mobile-controls-hidden') ? (compact?12:40) : controls.getBoundingClientRect().height+32;
    stage.style.setProperty('--score-lane-space',`${top}px`);
    stage.style.setProperty('--score-controls-space',`${bottom}px`);
  }
  new ResizeObserver(fitStageLyrics).observe(overlay);
  new ResizeObserver(fitStageLyrics).observe(byId('display').querySelector('.display-bottom'));
  new MutationObserver(() => {fitStageLyrics();wakeLane();}).observe(byId('display'), {attributes:true, attributeFilter:['class']});
  document.addEventListener('visibilitychange',wakeLane);
  syncSettings(); lockControls(); renderHistory();
  // Read-only diagnostics for the Windows test build and regression suite.
  window.VoxStageScoring = {snapshot:() => ({armed, preparing, epoch, reference, result:score?.result(), lastResult,
    lastDetected, lastExpected, displayFrequency, settings:{...settings}, hasStream:Boolean(stream||nativeInput||(armed&&phoneSession)), inputLatency}), open:showDialog, stop:() => stopScoring('partial')};
})();
