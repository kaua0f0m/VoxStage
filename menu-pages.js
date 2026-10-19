/* Guided imports and platform-specific settings reuse the existing forms and engine. */
(() => {
  'use strict';
  const menu=window.VoxStageMenu;if(!menu)return;
  const {device,icon}=menu,txt=(pt,en)=>{englishUiCopy[pt]=en;return menu.txt(pt,en);},main=document.querySelector('.main'),modal=$('modal'),card=modal.querySelector('.modal');
  const css=document.createElement('link');css.rel='stylesheet';css.href='menu-pages.css?v=2.0.0';document.head.append(css);
  const make=(tag,cls,html='')=>{const node=document.createElement(tag);node.className=cls;node.innerHTML=html;return node;};
  const action=(id,label,handler,primary=false)=>{const b=make('button',`btn${primary?'':' secondary'}`);b.type='button';b.id=id;b.textContent=label;b.onclick=handler;return b;};
  const label=(text,input)=>{const node=make('label','menu-field-label');node.append(document.createTextNode(text),input);return node;};
  const heading=card.querySelector('.modal-head'),intro=card.querySelector(':scope > p'),footer=card.querySelector('.modal-actions');
  const title=heading.querySelector('h2');title.id='menuAddTitle';title.tabIndex=-1;
  intro.textContent=txt('Escolha a origem, ajuste os detalhes e confira antes de salvar.','Choose a source, edit the details and review before saving.');
  card.querySelector(':scope > p.small')?.remove();
  modal.classList.add('menu-add-page');card.classList.add('menu-page-card');main.append(modal);
  modal.setAttribute('aria-labelledby',title.id);modal.setAttribute('role','region');
  $('closeModal').setAttribute('aria-label',txt('Voltar à biblioteca','Back to library'));
  const steps=make('nav','menu-import-steps');steps.setAttribute('aria-label',txt('Etapas da importação','Import steps'));
  const stepLabels=[txt('Origem','Source'),txt('Detalhes','Details'),txt('Revisar e salvar','Review and save')];
  stepLabels.forEach((name,i)=>steps.append(action('menuImportStep'+i,`${i+1}  ${name}`,()=>setStep(i))));intro.after(steps);
  const source=make('section','menu-import-source'),details=make('section','menu-import-details'),review=make('section','menu-import-review');
  source.id='menuImportSource';details.id='menuImportDetails';review.id='menuImportReview';
  footer.before(source,details,review);
  const sourceHeading=make('div','menu-page-section-heading',`<h3>${txt('De onde vem a sua música?','Where is your music coming from?')}</h3><p>${txt('Você pode começar com uma música completa ou com as faixas já separadas.','Start with a complete song or separate tracks.')}</p>`);
  const choices=make('div','menu-source-choices');
  const sources=[['youtube','play',txt('Buscar no YouTube','Search YouTube'),txt('Pesquise pelo título ou cole um link.','Search by title or paste a link.')],['files','upload',txt('Escolher arquivos','Choose files'),txt('Áudio, capa e vídeo do seu dispositivo.','Audio, artwork and video from your device.')],['phone','phone',device==='phone'?txt('Receber de outro dispositivo','Receive from another device'):txt('Receber do celular','Receive from your phone'),txt('Conecte os aparelhos pela mesma rede Wi-Fi.','Connect the devices to the same Wi-Fi network.')]];
  if(device==='tv')sources.unshift(sources.splice(2,1)[0]);
  for(const [value,glyph,name,description]of sources){
    const b=make('button','menu-source-choice',`${icon(glyph)}<strong>${name}</strong><span>${description}</span>`);b.type='button';b.dataset.importSource=value;
    b.onclick=()=>{const draft=captureUploadDraft();draft.importSource=value;draft.importStep=value==='files'?1:0;persistUploadDrafts();if(value==='phone'){if(device==='phone')($('syncPcLibrary')||$('remoteOpen')).click();else showRemotePanel();return;}setStep(draft.importStep);if(value==='youtube')$('youtubeQuery').focus();else picker.click();};choices.append(b);
  }
  if(device==='tv'){
    const phoneChoice=choices.querySelector('[data-import-source="phone"]');phoneChoice.classList.add('menu-tv-phone-import');
    phoneChoice.innerHTML=`<div class="menu-tv-phone-copy"><span class="menu-tv-recommended">${txt('RECOMENDADO NA TV','RECOMMENDED ON TV')}</span><strong>${txt('Traga sua música pelo celular','Bring your music from your phone')}</strong><span>${txt('Escaneie o QR com o celular, na mesma rede Wi-Fi. Escolha a música por lá e envie para esta TV.','Scan the QR code with your phone on the same Wi-Fi network. Choose a song there and send it to this TV.')}</span><span class="menu-tv-phone-cta">${icon('phone')}${txt('Conectar celular','Connect phone')} <span aria-hidden="true">→</span></span></div><div class="menu-tv-phone-qr"><canvas id="menuTvImportQr" role="img" aria-label="${txt('QR para conectar o celular','QR code to connect your phone')}"></canvas><small id="menuTvImportAddress"></small></div>`;
    phoneChoice.querySelector('canvas').hidden=true;
  }
  source.append(sourceHeading,choices,youtubeImport);
  youtubeImport.querySelector('h3').textContent=txt('Encontre sua música','Find your song');
  youtubeImport.querySelector(':scope > p').textContent=txt('Escolha um resultado para baixar o áudio. A separação pelo MVSEP pode usar créditos da sua conta.','Choose a result to download the audio. MVSEP separation may use account credits.');
  const videoToggle=make('label','menu-video-toggle',`<input id="menuAlsoDownloadVideo" type="checkbox"><span><strong>${txt('Também baixar vídeo','Also download video')}</strong><small>${txt('Usar o vídeo escolhido como fundo mudo.','Use the selected video as a muted background.')}</small></span>`);
  $('includeNormalYoutube').closest('label').after(videoToggle);
  videoToggle.querySelector('input').onchange=event=>{captureUploadDraft().downloadVideo=event.target.checked;persistUploadDrafts();};
  // Keep the established download worker/status; the separate download form is retired.
  youtubeVideoDownload.hidden=true;
  const transfer=make('section','menu-import-transfer');transfer.setAttribute('aria-label',txt('Progresso do envio','Transfer progress'));
  transfer.append($('youtubeStatus'),$('youtubeProgress'),$('mvsepQueue'),$('youtubeVideoDownloadStatus'),$('youtubeVideoProgress'));
  const metadata=make('section','menu-import-metadata',`<h3>${txt('Como ela aparece na biblioteca','How it appears in your library')}</h3>`);
  metadata.append(label(txt('Nome da música','Song title'),$('titleInput')),label(txt('Artista','Artist'),$('artistInput')));
  const filesHeading=manualImport.querySelector('h3');filesHeading.textContent=txt('Arquivos da música','Song files');
  manualImport.querySelector(':scope > small').textContent=txt('Confira o papel de cada arquivo. Uma música completa já pode tocar sozinha.','Check each file’s role. A complete song can play on its own.');
  const decoration=make('div','menu-import-decoration');
  const coverSection=make('section','menu-import-cover',`<div class="menu-cover-preview" id="menuDraftCover"></div><div><h3>${txt('Capa','Artwork')}</h3><p>${txt('Busque na internet ou escolha uma imagem.','Search online or choose an image.')}</p><div class="menu-decoration-actions"></div></div>`);
  const coverFile=document.createElement('input');coverFile.type='file';coverFile.accept='image/*';coverFile.id='menuCoverFile';coverFile.hidden=true;
  const coverChoose=action('menuChooseCover',txt('Escolher imagem','Choose image'),()=>coverFile.click());
  artworkSearchButton.textContent=txt('Buscar capa','Search artwork');
  coverSection.querySelector('.menu-decoration-actions').append(artworkSearchButton,coverChoose,coverFile);
  coverFile.onchange=()=>{const file=coverFile.files?.[0];if(!file)return;chosenFiles=chosenFiles.filter(item=>item.role!=='cover');chosenFiles.push({file,role:'cover'});coverFile.value='';drawAssignments();};
  const lyricsSection=make('section','menu-import-lyrics',`<h3>${txt('Letra','Lyrics')}</h3><p>${txt('Busque uma versão sincronizada, cole ou edite o texto. Você pode sincronizar depois.','Find timed lyrics, paste or edit text. You can sync later.')}</p>`);
  decoration.append(coverSection,lyricsSection);details.append(metadata,decoration);
  $('draftLyricsButton').textContent=txt('Buscar ou editar letra','Find or edit lyrics');lyricsSection.append(uploadLyrics);
  const oldLyricsOpen=$('draftLyricsButton').onclick;
  $('draftLyricsButton').onclick=()=>{oldLyricsOpen();if(!draftLyrics&&editingSong)$('lyricsPasteInput').value=editingSong.plainLyrics||'';};
  details.append(manualImport);
  review.innerHTML=`<div class="menu-page-section-heading"><h3>${txt('Tudo pronto para salvar?','Ready to save?')}</h3><p>${txt('Capa e letra são opcionais. Você pode alterar qualquer detalhe aqui.','Artwork and lyrics are optional. You can change any detail here.')}</p></div><div class="menu-review-summary"><div id="menuReviewCover" class="menu-cover-preview"></div><div><h3 id="menuReviewTitle"></h3><p id="menuReviewArtist"></p><p id="menuReviewFiles"></p></div></div><div class="menu-review-actions"></div><p id="menuReviewLyrics"></p>`;
  review.querySelector('.menu-review-actions').append(action('menuReviewEdit',txt('Editar detalhes','Edit details'),()=>setStep(1)),action('menuReviewArtwork',txt('Alterar capa','Change artwork'),()=>{setStep(1);artworkSearchButton.click();}),action('menuReviewLyric',txt('Alterar letra','Change lyrics'),()=>{setStep(1);$('draftLyricsButton').click();}));
  const validation=make('p','menu-import-validation');validation.id='menuImportValidation';validation.setAttribute('role','status');
  footer.before(source,details,review,transfer,validation);
  card.querySelector('.input-methods')?.remove();
  const back=action('menuImportBack',txt('Voltar','Back'),()=>setStep(Math.max(0,currentStep-1)));
  const next=action('menuImportNext',txt('Continuar','Continue'),()=>setStep(currentStep+1),true);
  footer.prepend(back);footer.append(next);$('cancelModal').textContent=txt('Voltar à biblioteca','Back to library');
  let currentStep=0,coverObjectUrl='',coverFileIdentity=null;
  const validAudio=()=>{
    const count=role=>chosenFiles.filter(f=>f.role===role).length;
    return (count('source')===1&&!['inst','lead','back'].some(count)||!count('source')&&count('inst')===1&&count('lead')===1)&&['cover','back','background','video'].every(role=>count(role)<=1);
  };
  function updateDraftView(){
    const draft=uploadDrafts.get(activeUploadDraftId)||{},selected=chosenFiles.find(f=>f.role==='cover');
    if(selected?.file!==coverFileIdentity){if(coverObjectUrl)URL.revokeObjectURL(coverObjectUrl);coverObjectUrl='';coverFileIdentity=selected?.file;if(coverFileIdentity)coverObjectUrl=URL.createObjectURL(coverFileIdentity);}
    const url=coverObjectUrl||(selected?.name?mediaUrl(selected.name):'');
    for(const id of ['menuDraftCover','menuReviewCover']){const node=$(id);if(node.dataset.url!==url){node.dataset.url=url;node.replaceChildren();if(url){const img=document.createElement('img');img.src=url;img.alt='';node.append(img);}else node.innerHTML=icon('library');}}
    $('menuReviewTitle').textContent=$('titleInput').value||txt('Sem título','Untitled');$('menuReviewArtist').textContent=$('artistInput').value||txt('Artista não informado','Artist not specified');
    const used=chosenFiles.filter(f=>f.role!=='ignore');$('menuReviewFiles').textContent=txt(`${used.length} arquivo(s) selecionado(s)`,`${used.length} selected file(s)`);
    const lyric=draftLyrics||editingSong;
    const hasLyrics=Boolean(lyric?.plainLyrics||lyric?.syncedLyrics||lyric?.lyricVoices?.lead?.length);
    $('menuReviewLyrics').textContent=hasLyrics?txt('Letra adicionada. Você pode revisar o texto antes de salvar.','Lyrics added. You can review the text before saving.'):txt('Sem letra por enquanto. Você pode adicionar depois.','No lyrics yet. You can add them later.');
    const busy=youtubeProcessing||videoDownloadBusy||draft.pendingAttachments||draft.saving;
    $('saveSong').disabled=Boolean(busy)||!validAudio();
    $('saveSong').textContent=editingSong?txt('Salvar alterações','Save changes'):txt('Salvar música','Save song');
    $('saveSong').title='';
    validation.textContent=currentStep===0?'':busy?txt('Os arquivos ainda estão chegando. Você pode ajustar capa e letra enquanto espera.','Files are still arriving. You can edit artwork and lyrics while waiting.'):!validAudio()?txt('Escolha uma música completa ou marque um instrumental e um vocal principal. Use no máximo um arquivo de cada papel.','Choose one complete song, or assign one instrumental and one lead vocal. Use at most one file per role.'):'';
    transfer.hidden=!(draft.importSource==='youtube'||youtubeProcessing||videoDownloadBusy||$('youtubeVideoDownloadStatus').textContent.trim());
  }
  function setStep(value,focus=true){
    currentStep=Math.max(0,Math.min(2,value));const draft=captureUploadDraft();draft.importStep=currentStep;persistUploadDrafts();
    $('menuAlsoDownloadVideo').checked=Boolean(draft.downloadVideo);
    source.hidden=currentStep!==0;details.hidden=currentStep!==1;review.hidden=currentStep!==2;
    youtubeImport.hidden=draft.importSource!=='youtube';
    choices.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.importSource===draft.importSource)));
    [...steps.children].forEach((b,i)=>{b.setAttribute('aria-current',i===currentStep?'step':'false');b.classList.toggle('complete',i<currentStep);});
    back.hidden=currentStep===0;next.hidden=currentStep===2||currentStep===0&&!draft.importSource;next.textContent=currentStep===1?txt('Revisar e salvar','Review and save'):txt('Continuar','Continue');
    $('saveSong').hidden=currentStep!==2;updateDraftView();
    if(device==='tv'&&currentStep===0)void updateTvImportQr(true);
    if(focus){
      const target=device==='tv'?(currentStep===0?choices.querySelector('button'):currentStep===1?artworkSearchButton:$('saveSong').disabled?$('menuReviewEdit'):$('saveSong')):title;
      target.focus({preventScroll:true});modal.scrollIntoView({block:'start'});
    }
  }
  let qrLoading=false;
  async function updateTvImportQr(refresh=false){
    if(qrLoading)return;
    qrLoading=true;
    try{
      if(refresh||!remoteInfo?.url)await refreshRemoteInfo();
      if(!remoteInfo?.url){$('menuTvImportAddress').textContent=txt('Conecte a TV ao Wi-Fi para mostrar o QR.','Connect the TV to Wi-Fi to show the QR code.');return;}
      const url=new URL(remoteInfo.url);url.searchParams.set('lang',interfaceLanguage);
      window.drawVoxstageQr($('menuTvImportQr'),url.toString());$('menuTvImportQr').hidden=false;
      $('menuTvImportAddress').textContent=url.toString().split('#')[0];
    }catch{$('menuTvImportAddress').textContent=txt('Conecte os aparelhos à mesma rede Wi-Fi.','Connect both devices to the same Wi-Fi network.');}
    finally{qrLoading=false;}
  }
  if(device==='tv')new MutationObserver(()=>{if(menu.page==='add'&&currentStep===0)void updateTvImportQr();}).observe($('remoteUrl'),{childList:true,characterData:true,subtree:true});
  const oldShow=showModal,oldHide=hideModal;
  showModal=function(){
    menu.openPage('add',editingSong?txt('Editar música','Edit song'):txt('Adicionar música','Add song'),$('addTop'));
    modal.classList.add('menu-add-inline');oldShow();
    const draft=captureUploadDraft();$('menuAlsoDownloadVideo').checked=Boolean(draft.downloadVideo);
    setStep(editingSong?1:draft.importStep??(chosenFiles.length?1:0));
  };
  hideModal=function(){oldHide();if(menu.page==='add')menu.showLibrary();};
  modal.onclick=()=>{};
  const oldDraw=drawAssignments;drawAssignments=function(){oldDraw();updateDraftView();};
  picker.addEventListener('change',()=>{
    const audio=chosenFiles.filter(f=>f.file?.type.startsWith('audio/'));
    if(audio.length===1&&audio[0].role==='ignore'&&!chosenFiles.some(f=>['source','inst','lead','back'].includes(f.role))){audio[0].role='source';drawAssignments();}
    if(menu.page==='add')setStep(1,false);
  });
  for(const id of ['titleInput','artistInput'])$(id).addEventListener('input',updateDraftView);
  new MutationObserver(()=>updateDraftView()).observe($('draftLyricsStatus'),{childList:true,subtree:true,characterData:true});
  new MutationObserver(()=>{if(modal.classList.contains('show'))updateDraftView();}).observe(transfer,{childList:true,subtree:true,characterData:true});
  const busyObserver=new MutationObserver(()=>{if(modal.classList.contains('show'))updateDraftView();});
  for(const id of ['youtubeSearch','youtubeVideoDownloadButton'])busyObserver.observe($(id),{attributes:true,attributeFilter:['disabled']});
  const oldReset=resetSongForm;resetSongForm=function(){oldReset();if(menu.page==='add')setStep(0,false);};
  const oldDownload=downloadYoutubeAudio,oldSeparate=startYoutubeSeparation;
  function withVideo(item,start){
    if(youtubeProcessing)return;
    const draft=captureUploadDraft(),wantVideo=Boolean(draft.downloadVideo);
    const result=start(item);
    if(wantVideo&&!videoDownloadBusy){$('youtubeVideoUrl').value=item.url;void downloadYoutubeVideo();}
    if(menu.page==='add')setStep(1);
    return result;
  }
  downloadYoutubeAudio=function(item){return withVideo(item,oldDownload);};
  startYoutubeSeparation=function(item){if(!mvsepConfigured)return oldSeparate(item);return withVideo(item,oldSeparate);};

  // Settings retain their controls and save handlers; navigation changes by device.
  main.append(settingsDialog);settingsDialog.classList.add('menu-settings-page');settingsCard.classList.add('menu-page-card');
  const settingsTitle=settingsCard.querySelector('header h2');settingsTitle.tabIndex=-1;
  settingsCard.setAttribute('aria-labelledby',settingsTitle.id);
  const languagePane=make('div','settings-pane');languagePane.id='settingsPaneLanguage';languagePane.dataset.settingsPane='language';languagePane.setAttribute('role','tabpanel');languagePane.setAttribute('aria-labelledby','settingsTabLanguage');languagePane.hidden=true;languagePane.append(languageSection);
  settingsPanes.language=languagePane;settingsFooter.before(languagePane);
  const langTab=make('button','');langTab.type='button';langTab.id='settingsTabLanguage';langTab.dataset.settingsTab='language';langTab.textContent=txt('Idioma','Language');langTab.setAttribute('role','tab');langTab.setAttribute('aria-controls',languagePane.id);settingsTabs.querySelector('[data-settings-tab="about"]').before(langTab);
  const descriptions={playback:txt('Palavras, censura e controles de reprodução.','Words, censorship and playback controls.'),lyrics:txt('Cores, vozes e sobreposição das letras.','Colors, voices and lyric overlap.'),visual:txt('Tema, fontes, tamanho das letras e cores das vozes.','Theme, fonts, lyric size and voice colors.'),cloud:txt('Chave da API e modelo de separação.','API key and separation model.'),data:txt('Exportar, importar e levar sua biblioteca.','Export, import and move your library.'),language:txt('Idioma dos menus e mensagens.','Language for menus and messages.'),about:txt('Versão, autoria e atribuições.','Version, creator and credits.'),debug:txt('Diagnóstico desta versão de testes.','Diagnostics for this test version.')};
  const order=['playback','visual','cloud','data','language','about','debug'];
  const paneTitle=make('div','menu-settings-pane-heading');paneTitle.innerHTML='<h3></h3><p></p>';settingsTabs.after(paneTitle);
  const settingsBack=action('menuSettingsBack',txt('Todos os ajustes','All settings'),()=>showSettingsHome());settingsCard.querySelector('header').after(settingsBack);
  const home=make('div','menu-settings-home');home.id='menuSettingsHome';settingsBack.after(home);
  const groups=[[txt('Para cantar','Singing'),['playback','visual']],[txt('Suas músicas','Your music'),['cloud','data']],[txt('Aplicativo','Application'),['language','about','debug']]];
  for(const [name,keys]of groups){const section=make('section','menu-settings-group',`<h3>${name}</h3>`);home.append(section);for(const key of keys){const tab=settingsTabs.querySelector(`[data-settings-tab="${key}"]`);if(!tab)continue;const b=make('button','menu-settings-topic',`${icon(key==='data'?'upload':key==='lyrics'?'library':'gear')}<span><strong>${esc(tab.textContent)}</strong><small>${descriptions[key]}</small></span><span aria-hidden="true">›</span>`);b.type='button';b.dataset.settingsTopic=key;b.onclick=()=>selectSettingsTab(key);section.append(b);}}
  for(const key of order){const tab=settingsTabs.querySelector(`[data-settings-tab="${key}"]`);if(tab)settingsTabs.append(tab);}
  const oldSelect=selectSettingsTab;let settingsHome=false;
  function refreshSettingsTopics(){home.querySelectorAll('[data-settings-topic]').forEach(b=>{const tab=settingsTabs.querySelector(`[data-settings-tab="${b.dataset.settingsTopic}"]`);b.hidden=tab.hidden;});}
  function showSettingsHome(){settingsHome=true;settingsTabs.hidden=device==='phone';home.hidden=device!=='phone';settingsBack.hidden=true;paneTitle.hidden=true;Object.values(settingsPanes).forEach(p=>p.hidden=true);settingsFooter.hidden=true;settingsTitle.focus({preventScroll:true});refreshSettingsTopics();}
  selectSettingsTab=function(name){
    oldSelect(name);settingsHome=false;home.hidden=true;settingsTabs.hidden=device==='phone';settingsBack.hidden=device!=='phone';settingsFooter.hidden=false;paneTitle.hidden=false;
    const selected=settingsTabs.querySelector(`[data-settings-tab="${activeSettingsTab}"]`);paneTitle.querySelector('h3').textContent=selected?.textContent||'';paneTitle.querySelector('p').textContent=descriptions[activeSettingsTab]||'';
  };
  settingsTabs.querySelectorAll('[data-settings-tab]').forEach(tab=>tab.onclick=()=>selectSettingsTab(tab.dataset.settingsTab));
  new MutationObserver(refreshSettingsTopics).observe(settingsTabs,{attributes:true,subtree:true,attributeFilter:['hidden']});
  settingsTabs.setAttribute('aria-orientation','vertical');
  settingsTabs.addEventListener('keydown',event=>{
    if(device==='tv'||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const tabs=[...settingsTabs.querySelectorAll('button')].filter(b=>!b.hidden),index=tabs.indexOf(document.activeElement);if(index<0)return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowDown'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();
  });
  let settingsWasOpen=false;
  function mountSettings(){
    if(!settingsDialog.classList.contains('show'))return;
    settingsWasOpen=true;
    if(!$('display').classList.contains('show')){menu.openPage('settings',txt('Configurações','Settings'),$('settingsTop'));settingsDialog.classList.add('menu-settings-inline');settingsCard.setAttribute('role','region');settingsCard.removeAttribute('aria-modal');}
    else{settingsDialog.classList.remove('menu-settings-inline');settingsCard.setAttribute('role','dialog');settingsCard.setAttribute('aria-modal','true');}
    if(device==='phone')showSettingsHome();else selectSettingsTab(activeSettingsTab);settingsTitle.focus({preventScroll:true});
  }
  const oldSettings=openProcessingSettings;openProcessingSettings=function(){oldSettings();mountSettings();};$('settingsTop').onclick=openProcessingSettings;
  new MutationObserver(()=>{
    const showing=settingsDialog.classList.contains('show');
    if(showing&&!settingsWasOpen)mountSettings();
    if(!showing){settingsWasOpen=false;if(menu.page==='settings')menu.showLibrary();}
  }).observe(settingsDialog,{attributes:true,attributeFilter:['class']});
  window.addEventListener('voxstage-menu-page',event=>{
    if(event.detail!=='add'){if(modal.classList.contains('show'))captureUploadDraft();modal.classList.remove('show');}
    if(event.detail!=='settings')settingsDialog.classList.remove('show','menu-settings-inline');
  });
  // Escape/back leaves a page, but nested cover/lyrics dialogs get the first chance.
  window.VoxStageMenuBack=()=>{
    if(menu.page==='connection'){menu.showLibrary();return true;}
    if(menu.page==='settings'){if(device==='phone'&&!settingsHome)showSettingsHome();else settingsDialog.classList.remove('show');return true;}
    if(menu.page==='add'){if(currentStep>0)setStep(currentStep-1);else hideModal();return true;}return false;
  };
  if(device==='phone'&&$('pcSyncDialog')){
    const sync=$('pcSyncDialog'),syncCard=sync.querySelector('.modal'),connect=$('syncPcLibrary'),openNative=connect.onclick,closeNative=$('pcSyncClose').onclick;
    const connectionPage=make('section','menu-phone-connection-page');connectionPage.id='menuPhoneConnectionPage';connectionPage.hidden=true;connectionPage.setAttribute('aria-labelledby','pcSyncTitle');main.append(connectionPage);connectionPage.append(sync);
    sync.classList.add('menu-phone-connection-inline');syncCard.setAttribute('role','region');syncCard.removeAttribute('aria-modal');
    function closeConnection(){closeNative();connectionPage.hidden=true;if(menu.page==='connection')menu.showLibrary();}
    connect.onclick=()=>{menu.openPage('connection',txt('Conectar','Connect'),connect);connectionPage.hidden=false;openNative();window.scrollTo(0,0);};
    $('pcSyncClose').onclick=$('pcSyncCancel').onclick=closeConnection;
    sync.addEventListener('click',event=>{if(event.target===sync)event.stopImmediatePropagation();},true);
    new MutationObserver(()=>{if(!sync.classList.contains('show')&&!connectionPage.hidden){connectionPage.hidden=true;closeNative();if(menu.page==='connection')menu.showLibrary();}}).observe(sync,{attributes:true,attributeFilter:['class']});
    window.addEventListener('voxstage-menu-page',event=>{if(event.detail!=='connection'&&!connectionPage.hidden){closeNative();connectionPage.hidden=true;}});
  }
  if(device!=='tv')window.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||$('display').classList.contains('show'))return;
    const nested=[...document.querySelectorAll('[role="dialog"],dialog[open]')].some(n=>n!==settingsCard&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
    if(nested)return;
    if(window.VoxStageMenuBack()){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  // Pop-ups share the menu finish without changing their handlers or the stage.
  function popupShell(popup,header,footer=null){
    popup.classList.add('vox-popup');header.classList.add('vox-popup-head');
    if(popup.tagName!=='DIALOG'){popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','true');}
    const content=make('div','vox-popup-body');
    for(const node of [...popup.childNodes])if(node!==header&&node!==footer)content.append(node);
    popup.append(content);
    if(footer){footer.classList.add('vox-popup-foot');popup.append(footer);}
    return content;
  }
  const artworkBody=popupShell(artworkDialog.querySelector('.artwork-card'),artworkDialog.querySelector('header'));
  artworkBody.classList.add('artwork-popup-body');
  const artworkToolbar=make('div','artwork-popup-toolbar');artworkBody.querySelector('p').after(artworkToolbar);
  artworkToolbar.append(artworkBody.querySelector('.artwork-provider'),artworkBody.querySelector('.artwork-search'));
  new MutationObserver(()=>{
    $('artworkResults').querySelectorAll('.artwork-result').forEach(result=>{
      const actions=result.querySelector(':scope > .artwork-meta > .artwork-actions');if(actions)result.append(actions);
    });
  }).observe($('artworkResults'),{childList:true});
  const lyricCard=$('lyricsDialog').querySelector('.lyrics-dialog-card');
  const lyricBody=popupShell(lyricCard,lyricCard.querySelector('.lyrics-dialog-head'));lyricBody.classList.add('lyrics-popup-body');
  const lyricEntry=make('div','lyrics-entry-switch');lyricEntry.setAttribute('role','group');lyricEntry.setAttribute('aria-label',txt('Como adicionar a letra','How to add lyrics'));
  for(const [value,name]of [['search',txt('Buscar letra','Find lyrics')],['manual',txt('Colar ou editar','Paste or edit')]]){
    const b=action('lyricsEntry'+value,name,()=>{setLyricEntry(value);if(value==='manual')$('lyricsPasteInput').focus();});b.dataset.lyricEntry=value;lyricEntry.append(b);
  }
  lyricBody.querySelector('.lyrics-dialog-copy').after(lyricEntry);
  function setLyricEntry(value){lyricBody.dataset.lyricEntry=value;lyricEntry.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lyricEntry===value)));}
  setLyricEntry('search');
  let lyricsWereOpen=false;
  new MutationObserver(()=>{const open=$('lyricsDialog').classList.contains('show');if(open&&!lyricsWereOpen)setLyricEntry($('lyricsPasteInput').value.trim()?'manual':'search');lyricsWereOpen=open;}).observe($('lyricsDialog'),{attributes:true,attributeFilter:['class']});
  const scorePopup=$('scoreDialog');
  if(scorePopup){
    popupShell(scorePopup,scorePopup.querySelector('header'),scorePopup.querySelector('footer'));
    const fields=scorePopup.querySelector('.score-fields');fields.classList.add('score-popup-groups');
    function scoreGroup(name,ids,extraClass=''){
      const group=make('fieldset',`score-popup-group ${extraClass}`,`<legend>${name}</legend>`);fields.append(group);
      for(const id of ids){const control=$(id);if(control)group.append(control.closest('label'));}
      return group;
    }
    scoreGroup(txt('Seu microfone','Your microphone'),['scoreDevice','scoreNoise','scoreOffset']);
    const reference=scoreGroup(txt('Como pontuar','Scoring reference'),['scoreReference','scoreTolerance','scoreOctave']);reference.append($('scoreCustomLabel'));
    scoreGroup(txt('No palco','On stage'),['scoreOverlayToggle','scoreLaneLyricsToggle'],'score-popup-stage');
  }
  window.__voxstageMenuPagesReady=true;
})();
