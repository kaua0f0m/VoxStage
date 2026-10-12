if (typeof androidTv !== 'undefined' && androidTv) {
  setTimeout(showRemotePanel, 650);
} else if (typeof mobileNative !== 'undefined' && mobileNative) {
  const en = interfaceLanguage === 'en-US';
  const text = (pt, english) => en ? english : pt;
  const wizard = document.createElement('div');
  wizard.className = 'setup-wizard';
  wizard.innerHTML = `<section class="setup-wizard-card mobile-setup-card" role="dialog" aria-modal="true" aria-labelledby="mobileSetupTitle">
    <header class="setup-wizard-header"><div><span class="processing-kicker">VOXSTAGE · ${text('CONFIGURAÇÃO INICIAL','MOBILE SETUP')}</span><h2 id="mobileSetupTitle">${text('Conecte sua conta MVSep','Connect your MVSep account')}</h2><p>${text('Adicione sua chave da API para separar músicas pelo serviço MVSep. Você também pode configurar isso depois em Configurações → Nuvem.','Add your API key to separate songs with MVSep. You can also set this up later in Settings → Cloud.')}</p></div><button class="lyrics-close" type="button" aria-label="${text('Fechar','Close')}" id="mobileSetupClose">×</button></header>
    <article class="setup-feature mobile-yt-setup"><div class="setup-feature-title"><div><span class="setup-feature-icon">♫</span><h3>MVSep · ${text('separação online','online separation')}</h3></div><span class="setup-status">API</span></div>
      <label class="mobile-mvsep-label" for="mobileMvsepToken">${text('Chave da API','API key')}</label><input id="mobileMvsepToken" class="mobile-mvsep-token" type="password" autocomplete="new-password" placeholder="${text('Cole sua chave MVSep','Paste your MVSep key')}">
      <small id="mobileMvsepStatus" class="mobile-mvsep-status" aria-live="polite">${text('A chave será salva no armazenamento privado deste aparelho.','Your key will be saved in this device’s private storage.')}</small>
      <button type="button" class="btn secondary" id="mobileMvsepHelp">${text('Como obter uma chave MVSEP','How to get an MVSEP key')}</button>
      <button type="button" class="btn mobile-import-downloaded" id="mobileSaveMvsep">${text('Salvar chave','Save key')}</button>
    </article>
    <footer class="setup-wizard-footer"><label><input id="mobileSetupDontShow" type="checkbox"> ${text('Não mostrar automaticamente novamente','Do not show automatically again')}</label><button class="btn secondary" id="mobileSetupSkip" type="button">${text('Pular por agora','Skip for now')}</button></footer>
  </section>`;
  const mobileStyle = document.createElement('style');
  mobileStyle.textContent = `.mobile-setup-card{width:min(620px,100%)}.mobile-yt-setup{margin-top:18px}.mobile-yt-setup>p{min-height:0}.mobile-mvsep-label{display:block;margin:14px 0 6px;color:#ccc;font-size:12px}.mobile-mvsep-token{box-sizing:border-box;width:100%;height:46px;padding:0 13px;border:1px solid #424249;border-radius:11px;background:#111113;color:#f2f2f4;font:14px 'DM Sans',sans-serif}.mobile-mvsep-status{display:block;min-height:30px;margin:9px 0;color:#aaa;font-size:10px;line-height:1.5}.mobile-import-downloaded{min-height:42px;padding:9px 14px;font-size:12px}`;
  mobileStyle.textContent += `.mobile-native-app .setup-wizard{position:fixed;inset:0;z-index:230;display:none;place-items:center;padding:calc(14px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom));background:#08090bdf;backdrop-filter:blur(12px)}.mobile-native-app .setup-wizard.show{display:grid}.mobile-native-app .setup-wizard-card{max-height:85dvh;overflow:auto;box-sizing:border-box;padding:20px;border:1px solid #3b3b41;border-radius:19px;background:#1b1c21;box-shadow:0 24px 90px #000c;color:#f3f2ef}.mobile-native-app .setup-wizard-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.mobile-native-app .setup-wizard-header h2{margin:8px 0;font:750 21px/1.3 Manrope,sans-serif}.mobile-native-app .setup-wizard-header p{margin:0;color:#a5a5ab;font:13px/1.5 'DM Sans',sans-serif}.mobile-native-app .setup-feature{padding:14px;border:1px solid #38383e;border-radius:13px;background:#141518}.mobile-native-app .setup-feature-title,.mobile-native-app .setup-feature-title>div{display:flex;align-items:center;gap:9px}.mobile-native-app .setup-feature-title{justify-content:space-between}.mobile-native-app .setup-feature-title h3{margin:0;font:700 13px Manrope,sans-serif}.mobile-native-app .setup-status{padding:4px 8px;border:1px solid #41443b;border-radius:20px;color:var(--lime);font-size:11px}.mobile-native-app .setup-wizard-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin-top:18px;padding-top:14px;border-top:1px solid #34343a}.mobile-native-app .setup-wizard-footer label{display:flex;align-items:center;gap:7px;color:#a6a6ac;font-size:11px}.mobile-native-app .setup-wizard-footer input{accent-color:var(--lime)}`;
  document.head.append(mobileStyle);
  document.body.append(wizard);
  document.getElementById('mobileMvsepHelp').onclick = showMvsepKeyHelp;
  const close = () => wizard.classList.remove('show');
  document.getElementById('mobileSetupClose').onclick = close;
  document.getElementById('mobileSetupSkip').onclick = () => {
    try { if (document.getElementById('mobileSetupDontShow').checked) localStorage.setItem('voxstage-onboarding-hidden', '1'); sessionStorage.setItem('voxstage-onboarding-skipped', '1'); } catch {}
    close();
  };
  wizard.addEventListener('click', event => { if (event.target === wizard) close(); });
  document.getElementById('mobileSaveMvsep').onclick = async () => {
    const token = document.getElementById('mobileMvsepToken').value.trim();
    const status = document.getElementById('mobileMvsepStatus');
    if (!token) { status.textContent = text('Cole a chave da API MVSep antes de salvar.','Paste your MVSep API key before saving.'); return; }
    const button = document.getElementById('mobileSaveMvsep'); button.disabled = true; status.textContent = text('Salvando chave…','Saving key…');
    try {
      await api('/api/mvsep/config', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      document.getElementById('mobileMvsepToken').value = '';
      await loadMvsepConfiguration();
      status.textContent = text('Chave salva neste aparelho.','Key saved on this device.');
      setTimeout(close, 650);
    } catch (error) { status.textContent = error?.message || text('Não consegui salvar a chave.','Could not save the key.'); }
    finally { button.disabled = false; }
  };
  setTimeout(() => {
    try { if (localStorage.getItem('voxstage-onboarding-hidden') !== '1' && sessionStorage.getItem('voxstage-onboarding-skipped') !== '1') wizard.classList.add('show'); }
    catch { wizard.classList.add('show'); }
  }, 650);
} else {
// Optional feature setup wizard. Package installation stays in a separate
// Python environment where needed and runs only after the user asks for it.
const setupWizard = document.createElement('div');
setupWizard.id = 'setupWizard';
setupWizard.className = 'setup-wizard';
setupWizard.innerHTML = `<section class="setup-wizard-card" role="dialog" aria-modal="true" aria-labelledby="setupWizardTitle">
  <header class="setup-wizard-header"><div><span class="processing-kicker">VOXSTAGE · CONFIGURAÇÃO INICIAL</span><h2 id="setupWizardTitle">Prepare os recursos opcionais</h2><p>Escolha o que quer instalar neste computador. Você pode pular e configurar depois.</p></div><button id="setupWizardClose" class="lyrics-close" type="button" aria-label="Fechar">×</button></header>
  <div class="setup-wizard-cards">
    <article class="setup-feature" data-setup-feature="local-audio"><div class="setup-feature-title"><div><span class="setup-feature-icon">♫</span><h3>Separação local de áudio</h3></div><span class="setup-status" id="setupStatusAudio">Verificando…</span></div><p>Cria instrumental e vocal combinado sem enviar o áudio para um serviço. O download das bibliotecas ocupa vários GB; o modelo de separação baixa na primeira música.</p><label class="setup-backend-label" for="setupAudioBackend">Onde processar</label><select id="setupAudioBackend" class="mvsep-model-select"><option value="cpu">CPU · mais compatível</option><option value="directml">GPU DirectML · experimental para AMD/Intel</option></select><button type="button" class="btn secondary setup-install" data-install-feature="local-audio">Instalar separação local</button><div class="setup-job" id="setupJobAudio" hidden></div></article>
    <article class="setup-feature" data-setup-feature="lyrics-align"><div class="setup-feature-title"><div><span class="setup-feature-icon">♫</span><h3>Sincronização automática de letras</h3></div><span class="setup-status" id="setupStatusLyrics">Verificando…</span></div><p>Alinha letras existentes palavra por palavra. A instalação é grande; ao usar, o modelo pode consumir vários GB de memória. Em placas AMD, o alinhamento roda na CPU.</p><button type="button" class="btn secondary setup-install" data-install-feature="lyrics-align">Instalar alinhador de letras</button><div class="setup-job" id="setupJobLyrics" hidden></div></article>
    <article class="setup-feature" data-setup-feature="youtube"><div class="setup-feature-title"><div><span class="setup-feature-icon">↧</span><h3>Importação do YouTube</h3></div><span class="setup-status" id="setupStatusYoutube">Verificando…</span></div><p>Habilita pesquisa e importação pelo yt-dlp. Precisa de internet; Deno é opcional e pode melhorar a compatibilidade com o YouTube.</p><button type="button" class="btn secondary setup-install" data-install-feature="youtube">Instalar importador</button><div class="setup-job" id="setupJobYoutube" hidden></div></article>
  </div>
  <footer class="setup-wizard-footer"><label><input id="setupDontShow" type="checkbox"> Não mostrar automaticamente novamente</label><button class="btn secondary" id="setupWizardSkip" type="button">Pular por agora</button></footer>
</section>`;

const setupStyle = document.createElement('style');
setupStyle.textContent = `.setup-wizard{position:fixed;inset:0;z-index:20000;display:none;place-items:center;padding:18px;background:#08090bdf;backdrop-filter:blur(12px)}.setup-wizard.show{display:grid}.setup-wizard-card{width:min(760px,100%);max-height:min(90vh,900px);overflow:auto;padding:24px;border:1px solid #3b3b41;border-radius:19px;background:linear-gradient(145deg,#222226,#151517);box-shadow:0 24px 90px #000c;color:#f3f2ef}.setup-wizard-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.setup-wizard-header h2{margin:7px 0 5px;font:750 21px Manrope,sans-serif}.setup-wizard-header p{margin:0;color:#a5a5ab;font:12px/1.5 'DM Sans',sans-serif}.setup-wizard-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin-top:20px}.setup-feature{min-width:0;padding:14px;border:1px solid #38383e;border-radius:13px;background:#19191c}.setup-feature[data-setup-feature=youtube]{grid-column:1/-1}.setup-feature-title,.setup-feature-title>div{display:flex;align-items:center;gap:9px}.setup-feature-title{justify-content:space-between}.setup-feature-title h3{margin:0;font:700 12px Manrope,sans-serif}.setup-feature-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#30331f;color:var(--lime);font-size:15px}.setup-status{padding:4px 7px;border:1px solid #3f4135;border-radius:20px;background:#25271f;color:#cfef84;font:600 9px 'DM Sans',sans-serif;white-space:nowrap}.setup-status.missing,.setup-status.checking{border-color:#4a3838;background:#291f20;color:#e9aaa5}.setup-feature p{min-height:50px;margin:10px 0;color:#a4a4aa;font:10px/1.55 'DM Sans',sans-serif}.setup-backend-label{display:block;margin:0 0 5px;color:#bbb;font-size:9px}.setup-feature .mvsep-model-select{display:block;width:100%;margin-bottom:8px}.setup-install{min-height:32px;padding:7px 10px;font-size:10px}.setup-job{margin-top:9px;padding:8px;border:1px solid #36363b;border-radius:8px;background:#111113;color:#c7c7cc;font-size:9px;line-height:1.45;overflow-wrap:anywhere}.setup-job[hidden]{display:none}.setup-job progress{display:block;width:100%;height:6px;margin-bottom:6px;accent-color:var(--lime)}.setup-job pre{max-height:94px;overflow:auto;margin:5px 0 0;color:#9999a1;white-space:pre-wrap;font:9px/1.4 Consolas,monospace}.setup-wizard-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid #34343a}.setup-wizard-footer label{display:flex;align-items:center;gap:7px;color:#a6a6ac;font-size:10px}.setup-wizard-footer input{accent-color:var(--lime)}@media(max-width:620px){.setup-wizard{padding:9px}.setup-wizard-card{padding:17px}.setup-wizard-cards{grid-template-columns:1fr}.setup-feature[data-setup-feature=youtube]{grid-column:auto}.setup-feature p{min-height:0}.setup-wizard-footer{align-items:flex-start;flex-direction:column-reverse}}`;
document.head.append(setupStyle);
document.body.append(setupWizard);

const setupStatusIds = { 'local-audio': 'setupStatusAudio', 'lyrics-align': 'setupStatusLyrics', youtube: 'setupStatusYoutube' };
const setupJobIds = { 'local-audio': 'setupJobAudio', 'lyrics-align': 'setupJobLyrics', youtube: 'setupJobYoutube' };
let setupWizardBusy = false;
function setSetupStatus(feature, installed, detail = '') {
  const node = document.getElementById(setupStatusIds[feature]);
  if (!node) return;
  node.textContent = installed ? 'Pronto neste computador' : detail || 'Não instalado';
  node.classList.toggle('missing', !installed);
  node.classList.toggle('checking', detail === 'Verificando…');
}

async function refreshSetupStatuses() {
  setSetupStatus('local-audio', false, 'Verificando…');
  setSetupStatus('lyrics-align', false, 'Verificando…');
  setSetupStatus('youtube', false, 'Verificando…');
  const backend = document.getElementById('setupAudioBackend').value;
  const checks = await Promise.allSettled([
    api(`/api/local-audio/status?backend=${encodeURIComponent(backend)}`),
    api('/api/align/status'),
    api('/api/youtube/status')
  ]);
  if (checks[0].status === 'fulfilled') setSetupStatus('local-audio', checks[0].value.installed, checks[0].value.detail ? `Falha ao verificar: ${checks[0].value.detail}` : 'Não instalado');
  else setSetupStatus('local-audio', false, 'Não foi possível verificar');
  if (checks[1].status === 'fulfilled') setSetupStatus('lyrics-align', Boolean(checks[1].value.installed && checks[1].value.mmsFaAvailable), checks[1].value.error || 'Não instalado');
  else setSetupStatus('lyrics-align', false, 'Não foi possível verificar');
  if (checks[2].status === 'fulfilled') setSetupStatus('youtube', checks[2].value.installed, checks[2].value.denoAvailable ? 'yt-dlp + Deno prontos' : 'Não instalado');
  else setSetupStatus('youtube', false, 'Não foi possível verificar');
  return checks;
}

function openSetupWizard() {
  setupWizard.classList.add('show');
  refreshSetupStatuses().catch(error => console.error('Falha ao verificar recursos opcionais', error));
}
function closeSetupWizard() { setupWizard.classList.remove('show'); }
document.getElementById('setupWizardClose').onclick = closeSetupWizard;
document.getElementById('setupWizardSkip').onclick = () => {
  try {
    if (document.getElementById('setupDontShow').checked) localStorage.setItem('voxstage-onboarding-hidden', '1');
    sessionStorage.setItem('voxstage-onboarding-skipped', '1');
  } catch {}
  closeSetupWizard();
};
setupWizard.addEventListener('click', event => { if (event.target === setupWizard) closeSetupWizard(); });
document.getElementById('setupAudioBackend').value = processingSettings.localAudioBackend || 'cpu';
document.getElementById('setupAudioBackend').onchange = () => refreshSetupStatuses();

async function installSetupFeature(feature) {
  const button = setupWizard.querySelector(`[data-install-feature="${feature}"]`);
  const jobNode = document.getElementById(setupJobIds[feature]);
  if (setupWizardBusy || !button || !jobNode) return;
  setupWizardBusy = true;
  setupWizard.querySelectorAll('.setup-install').forEach(item => item.disabled = true);
  button.textContent = 'Preparando instalação…';
  jobNode.hidden = false;
  jobNode.replaceChildren();
  const progress = document.createElement('progress'); progress.max = 100; progress.value = 1;
  const message = document.createElement('div'); message.textContent = 'Iniciando…';
  const detail = document.createElement('pre');
  jobNode.append(progress, message, detail);
  try {
    const body = { feature };
    if (feature === 'local-audio') body.backend = document.getElementById('setupAudioBackend').value;
    const started = await api('/api/setup/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let job;
    do {
      await new Promise(resolve => setTimeout(resolve, 1200));
      job = await api(`/api/setup/jobs/${encodeURIComponent(started.id)}`);
      progress.value = Number(job.progress || 0);
      message.textContent = job.message || 'Instalando…';
      detail.textContent = job.detail || '';
    } while (!['done', 'error', 'missing'].includes(job.stage));
    if (job.stage !== 'done') throw new Error(job.message || 'A instalação não foi concluída.');
    message.textContent = 'Instalação concluída.';
    if (feature === 'local-audio') {
      processingSettings.localAudioBackend = body.backend;
      localStorage.setItem('voxstage-processing-settings', JSON.stringify(processingSettings));
      settingsDialog.querySelectorAll('input[name="localAudioBackend"]').forEach(input => input.checked = input.value === body.backend);
      await updateLocalAudioStatus();
    }
    await refreshSetupStatuses();
  } catch (error) {
    message.textContent = `Falha: ${error.message}`;
  } finally {
    setupWizardBusy = false;
    setupWizard.querySelectorAll('.setup-install').forEach(item => item.disabled = false);
    button.textContent = feature === 'local-audio' ? 'Instalar novamente' : feature === 'lyrics-align' ? 'Instalar alinhador de letras' : 'Instalar importador';
  }
}
setupWizard.querySelectorAll('[data-install-feature]').forEach(button => button.onclick = () => installSetupFeature(button.dataset.installFeature));

const openSetupButton = document.createElement('button');
openSetupButton.id = 'openSetupWizard';
openSetupButton.className = 'btn secondary';
openSetupButton.type = 'button';
openSetupButton.textContent = 'Configurar recursos opcionais';
settingsDialog.querySelector('.processing-card footer').prepend(openSetupButton);
openSetupButton.onclick = openSetupWizard;

// Android is a playback/import client. PC-only installers call endpoints that
// do not exist in the packaged mobile app, so keep that setup wizard out of its UI.
if (typeof mobileNative !== 'undefined' && mobileNative) {
  openSetupButton.hidden = true;
  setupWizard.remove();
}

setTimeout(() => {
  try {
    if (!(typeof mobileNative !== 'undefined' && mobileNative) && localStorage.getItem('voxstage-onboarding-hidden') !== '1' && sessionStorage.getItem('voxstage-onboarding-skipped') !== '1') openSetupWizard();
  } catch { if (!(typeof mobileNative !== 'undefined' && mobileNative)) openSetupWizard(); }
}, 650);
}
