/* Guided first run. Optional desktop installers remain available without blocking entry. */
(() => {
  'use strict';
  if(presentationDevice==='tv'){
    const connect=()=>{if(!window.__voxstageMenuPagesReady){setTimeout(connect,100);return;}showRemotePanel();};
    setTimeout(connect,650);return;
  }
  const mobile=presentationDevice==='phone', en=()=>interfaceLanguage==='en-US';
  const text=(pt,english)=>en()?english:pt;
  const icon=(name)=>playbackControlSvg(name);
  const style=document.createElement('link');style.rel='stylesheet';style.href='onboarding.css?v=2.0.0';document.head.append(style);
  const wizard=document.createElement('div');wizard.id='setupWizard';wizard.className='setup-wizard welcome-wizard';
  wizard.innerHTML=`<section class="setup-wizard-card welcome-card" role="dialog" aria-modal="true" aria-labelledby="setupWizardTitle">
    <header class="welcome-head"><img src="branding/voxstage-animated.svg" width="56" height="56" alt="VoxStage"><div><small>VOXSTAGE</small><h2 id="setupWizardTitle" tabindex="-1">${text('Seu palco começa aqui','Your stage starts here')}</h2></div><button id="setupWizardClose" class="lyrics-close wizard-close" type="button" aria-label="${text('Fechar introdução','Close introduction')}">×</button></header>
    <ol class="welcome-steps" aria-label="${text('Etapas da introdução','Introduction steps')}">${[text('Biblioteca','Library'),'MVSEP',text('Palco','Stage')].map((label,i)=>`<li data-welcome-indicator="${i}"><span>${i+1}</span>${label}</li>`).join('')}</ol>
    <div class="welcome-body">
      <section class="welcome-step" data-welcome-step="0"><h3>${text('A música é sua. O palco também.','Your music. Your stage.')}</h3><p>${text('Adicione uma música, prepare a letra e cante do seu jeito. Você pode começar com o que já tem.','Add a song, prepare the lyrics and sing your way. You can start with what you already have.')}</p>
        <div class="welcome-features"><article>${icon('lyrics')}<h4>${text('Traga suas músicas','Bring your songs')}</h4><p>${text('Importe arquivos ou busque no YouTube em Adicionar música. Capas e letras podem ser escolhidas antes de salvar.','Import files or search YouTube in Add song. Choose covers and lyrics before saving.')}</p></article><article>${icon('sync')}<h4>${text('Letras no seu tempo','Lyrics in your time')}</h4><p>${text('Busque uma letra pronta ou use Sync para marcar linhas e palavras de cada voz.','Find ready lyrics or use Sync to mark lines and words for each voice.')}</p></article><article>${icon('mix')}<h4>${text('Cante à sua maneira','Sing your way')}</h4><p>${text('Ajuste volumes, velocidade e tom. Pontuação e microfone são opcionais.','Adjust volumes, speed and pitch. Scoring and microphone are optional.')}</p></article></div>
      </section>
      <section class="welcome-step" data-welcome-step="1" hidden><h3>${text('Quer separar voz e instrumental?','Want to separate vocals and instrumental?')}</h3><p>${text('O MVSEP faz a separação na nuvem usando sua conta. É opcional: músicas completas e trilhas já separadas podem ser importadas sem chave.','MVSEP separates tracks in the cloud using your account. It is optional: import full songs and ready stems without a key.')}</p>
        <div class="welcome-api"><label for="mobileMvsepToken">${text('Chave da API MVSEP','MVSEP API key')}</label><input id="mobileMvsepToken" type="password" autocomplete="new-password" placeholder="${text('Cole sua chave, se quiser','Paste your key, if you want')}"><small id="mobileMvsepStatus" role="status">${text('A chave fica no armazenamento privado deste aparelho. Separações podem consumir créditos da sua conta.','The key stays in this device’s private storage. Separations may use credits from your account.')}</small><div class="welcome-api-actions"><button id="mobileMvsepHelp" class="btn secondary" type="button">${text('Como obter uma chave','How to get a key')}</button><button id="mobileSaveMvsep" class="btn secondary" type="button">${text('Salvar chave','Save key')}</button></div></div>
        <p class="welcome-note">${text('Você pode configurar isso depois em Configurações → Nuvem.','You can set this up later in Settings → Cloud.')}</p>
      </section>
      <section class="welcome-step" data-welcome-step="2" hidden><h3>${text('Tudo pronto para o seu primeiro palco','Ready for your first stage')}</h3><p>${mobile?text('Adicionar música fica no centro da barra inferior. Em Conectar, você pode enviar músicas para o PC ou a TV.','Add song is in the center of the bottom bar. Use Connect to send songs to your PC or TV.'):text('Adicionar música fica na lateral. Conectar celular permite enviar músicas e usar o telefone como controle ou microfone.','Add song is in the sidebar. Connect phone lets you send songs and use the phone as a remote or microphone.')}</p>
        <aside class="welcome-tip"><strong>${text('Vai usar a pontuação?','Using scoring?')}</strong><span>${text('Ela funciona melhor no PC ou em celulares e TVs onde você pode ouvir a música por fones de ouvido. Isso evita que o som da música encubra sua voz ou seja contado como canto.','It works best on a PC or on phones and TVs where you can listen through headphones. This prevents playback from masking your voice or being counted as singing.')}</span></aside>
        <p>${text('O Guia de uso reúne os próximos passos, dicas de sincronização e explicações dos erros mais comuns. Aparência, fontes e cores das vozes ficam juntas em Visual.','The User guide covers next steps, sync tips and common errors. Appearance, fonts and voice colors are together in Visual.')}</p>
      </section>
    </div>
    <footer class="welcome-footer"><label><input id="setupDontShow" type="checkbox">${text('Não mostrar esta introdução novamente','Do not show this introduction again')}</label><div><button id="setupWizardSkip" class="btn secondary" type="button">${text('Pular por agora','Skip for now')}</button><button id="setupWizardBack" class="btn secondary" type="button" hidden>${text('Voltar','Back')}</button><button id="setupWizardNext" class="btn" type="button">${text('Continuar','Continue')}</button></div></footer>
  </section>`;
  document.body.append(wizard);
  const fitViewport=()=>{const viewport=window.visualViewport;wizard.style.setProperty('--welcome-height',`${viewport?.height||innerHeight}px`);wizard.style.setProperty('--welcome-top',`${viewport?.offsetTop||0}px`);};
  window.visualViewport?.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('scroll',fitViewport);window.addEventListener('resize',fitViewport);fitViewport();
  let step=0,origin=null;
  function setStep(next){
    step=Math.max(0,Math.min(2,next));wizard.dataset.welcomeIndex=String(step);
    wizard.querySelectorAll('[data-welcome-step]').forEach(n=>n.hidden=Number(n.dataset.welcomeStep)!==step);
    wizard.querySelectorAll('[data-welcome-indicator]').forEach(n=>{const active=Number(n.dataset.welcomeIndicator)===step;n.classList.toggle('active',active);if(active)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});
    $('setupWizardBack').hidden=step===0;$('setupWizardNext').textContent=step===2?text('Entrar na biblioteca','Enter library'):step===1?text('Continuar sem configurar','Continue without setup'):text('Continuar','Continue');
    wizard.querySelector('.welcome-body').scrollTop=0;
  }
  function close(complete=false){
    try{if(complete||$('setupDontShow').checked)localStorage.setItem('voxstage-onboarding-hidden','1');sessionStorage.setItem('voxstage-onboarding-skipped','1');}catch{}
    wizard.classList.remove('show');if(origin?.isConnected)origin.focus({preventScroll:true});
  }
  function open(advanced=false,returnTo=null){
    origin=returnTo||document.activeElement;setStep(0);wizard.classList.add('show');$('setupWizardTitle').focus({preventScroll:true});
  }
  $('setupWizardClose').onclick=() => close();$('setupWizardSkip').onclick=()=>close();$('setupWizardBack').onclick=()=>setStep(step-1);$('setupWizardNext').onclick=()=>{if(step===2)close(true);else setStep(step+1);};
  $('mobileMvsepHelp').onclick=showMvsepKeyHelp;
  $('mobileSaveMvsep').onclick=async()=>{
    const input=$('mobileMvsepToken'),status=$('mobileMvsepStatus'),button=$('mobileSaveMvsep'),token=input.value.trim();
    if(!token){status.textContent=text('Cole a chave antes de salvar.','Paste your key before saving.');input.focus();return;}
    button.disabled=true;status.textContent=text('Salvando chave…','Saving key…');
    try{await api('/api/mvsep/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});input.value='';await loadMvsepConfiguration();status.textContent=text('Chave salva neste aparelho. Você já pode continuar.','Key saved on this device. You can continue.');$('setupWizardNext').textContent=text('Continuar','Continue');}
    catch(error){status.textContent=error?.message||text('Não consegui salvar a chave.','Could not save the key.');}
    finally{button.disabled=false;}
  };
  wizard.addEventListener('keydown',event=>{
    event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){const nodes=[...wizard.querySelectorAll('button,input,select,summary,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  window.VoxStageOnboarding={open,close};
  const revisit=document.createElement('button');revisit.id='reopenOnboarding';revisit.type='button';revisit.className='btn secondary';revisit.textContent=text('Rever introdução','Review introduction');
  usageGuide.querySelector('.usage-guide-body>p').after(revisit);
  revisit.onclick=()=>{usageGuideOrigin=null;usageGuide.close();open(false,$('openUsageGuide'));};
  setTimeout(()=>{try{if(localStorage.getItem('voxstage-onboarding-hidden')!=='1'&&sessionStorage.getItem('voxstage-onboarding-skipped')!=='1')open();}catch{open();}},650);
})();
