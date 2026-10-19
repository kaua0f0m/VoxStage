// TV uses the same library and audio engine, with navigation for a D-pad.
if (presentationDevice==='tv') (() => {
  document.body.classList.add('android-tv-app');
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'android-tv.css?v=1.1-rc-3'; document.head.append(css);
  try { window.VoxStageMedia?.setOrientation('landscape'); } catch {}
  const stage = $('display'); stage.classList.add('mobile-stage-tv');
  let libraryFocusId = null, previousLayer = null;
  const rememberedFocus=new WeakMap(),returnFocus=new WeakMap();
  const selector='button,input:not([type="file"]):not([type="hidden"]),select,textarea,a[href],summary,[tabindex],[role="button"]';
  const visible=element=>Boolean(element&&!element.disabled&&element.getAttribute('aria-disabled')!=='true'&&!element.closest('[hidden],[inert],[aria-hidden="true"]')&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none'&&(Number(getComputedStyle(element).opacity)!==0||element.matches('input[type="range"]')));
  function isPopover(node){try{return node.matches(':popover-open');}catch{return false;}}
  function layer(){
    const modal=[...document.querySelectorAll('dialog[open]')].filter(visible).at(-1);if(modal)return modal;
    const popover=[...document.querySelectorAll('[popover]')].filter(node=>isPopover(node)&&visible(node)).at(-1);if(popover)return popover;
    const transform=$('playbackTransformPopup');if(visible(transform))return transform;
    const songMenu=[...document.querySelectorAll('.track-menu:not([hidden])')].filter(visible).at(-1);if(songMenu)return songMenu;
    const dialogs=[...document.querySelectorAll('[role="dialog"],.remote-panel.show,.setup-wizard.show,.manual-sync-dialog.show,.lyrics-dialog.show,.artwork-dialog.show,.processing-dialog.show,.profanity-picker-dialog.show,.pc-qr-scanner:not([hidden])')].filter(node=>visible(node)&&!node.closest('.menu-remote-inline,.menu-add-inline,.menu-settings-inline,.menu-phone-connection-inline'));
    const z=element=>{let max=0;for(let node=element;node;node=node.parentElement)max=Math.max(max,parseInt(getComputedStyle(node).zIndex)||0);return max;};
    dialogs.sort((a,b)=>z(a)-z(b));return dialogs.at(-1)||(stage.classList.contains('show')?stage:document.body);
  }
  function targets(root=layer()){
    return [...root.querySelectorAll(selector)].filter(node=>visible(node)&&node.tabIndex>=0&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);
  }
  function focus(element){
    if(!visible(element))return;
    element.focus({preventScroll:true});element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    rememberedFocus.set(layer(),element);
  }
  function preferred(root){
    if(root===stage)return stage.classList.contains('mobile-controls-hidden')?mobileControlsToggle:$('dispPlay');
    if(root===document.body){
      if(window.VoxStageMenu?.page==='connection')return $('remoteQrRefresh');
      if(window.VoxStageMenu?.page==='settings')return settingsTabs.querySelector('[aria-selected="true"]');
      if(window.VoxStageMenu?.page==='add')return $('modal').querySelector('.menu-source-choice')||$('titleInput');
      return visible($('menuTvSing'))?$('menuTvSing'):document.querySelector('[data-play]');
    }
    return root.querySelector('input:not([type="hidden"]):not([type="file"]),select,textarea')||targets(root)[0];
  }
  function ensureFocus(){
    const root=layer(),choices=targets(root),active=document.activeElement;
    if(root!==previousLayer){
      const prior=previousLayer;previousLayer=root;
      const opener=active!==document.body&&!root.contains(active)?active:prior&&rememberedFocus.get(prior);
      if(visible(opener)&&!root.contains(opener))returnFocus.set(root,opener);
      if(prior&&(!visible(prior)||prior===stage&&!stage.classList.contains('show'))){const restored=returnFocus.get(prior);if(choices.includes(restored)){focus(restored);return;}}
    }
    if(!choices.includes(document.activeElement)){
      const saved=rememberedFocus.get(root),initial=preferred(root);
      focus(choices.includes(saved)?saved:choices.includes(initial)?initial:choices[0]);
    }
  }
  document.addEventListener('focusin',event=>{if(visible(event.target))rememberedFocus.set(layer(),event.target);});
  const syncButton = $('syncPcLibrary') || $('remoteOpen');
  syncButton.textContent = interfaceLanguage === 'en-US' ? 'Connect to phone' : 'Conectar com o celular';
  syncButton.onclick = showRemotePanel;
  remotePanel.querySelector('.remote-howto').textContent = interfaceLanguage === 'en-US'
    ? 'On the same Wi-Fi, scan the QR with your phone camera to control this TV. In the Android app, tap “Connect to VoxStage”. You can also send songs and your MVSEP API key from your phone.'
    : 'Na mesma rede Wi-Fi, leia o QR com a câmera do celular para controlar esta TV. No app Android, toque em “Conectar ao VoxStage”. Você também pode enviar músicas e sua chave MVSEP do celular para esta TV.';
  remotePanel.querySelector('.remote-panel-note').textContent = interfaceLanguage === 'en-US' ? 'Songs already in the library enter the queue automatically. Songs saved only on the phone are copied to the TV. Only new songs need approval.' : 'Músicas da biblioteca entram automaticamente na fila. Faixas salvas só no celular são copiadas para a TV. Apenas músicas novas precisam de aprovação.';
  // A request approval is explicit and should dismiss the QR before playback.
  const requestDecision = decideRemoteRequest;
  decideRemoteRequest = async (id, decision) => { await requestDecision(id, decision); if (decision === 'approve' && playing) closeRemotePanel(); };

  window.addEventListener('voxstage-tv-song-started',()=>{
    if(manualSyncState||manualSyncDialog.classList.contains('show')||stage.classList.contains('show'))return;
    libraryFocusId=current?.id;returnFocus.set(stage,document.activeElement);
    if(window.VoxStageMenu?.page)window.VoxStageMenu.showLibrary();
    if(remotePanel.classList.contains('show'))closeRemotePanel();
    stage.classList.add('show','mobile-stage-tv');setStageControlsHidden(false);focus($('dispPlay'));
  });
  function returnToLibrary() {
    stage.classList.remove('show');
    const button = libraryFocusId && document.querySelector(`[data-play="${CSS.escape(libraryFocusId)}"]`);
    focus(visible(button) ? button : document.querySelector('[data-play]') || $('addTop'));
  }
  window.addEventListener('voxstage-tv-song-ended', returnToLibrary);
  window.addEventListener('voxstage-tv-library', returnToLibrary);

  function restoreAfterClose(root){
    const opener=returnFocus.get(root);requestAnimationFrame(()=>{if(visible(opener))focus(opener);else ensureFocus();});
  }
  function back(){
    const root=layer();
    if(root.id==='stageMoreMenu'){window.VoxStageStage?.closeMore();return;}
    if(root.tagName==='DIALOG'){
      const cancel=new Event('cancel',{cancelable:true});if(root.dispatchEvent(cancel))root.close();restoreAfterClose(root);return;
    }
    if(root.matches('.track-menu')){root.hidden=true;document.querySelectorAll('[data-menu-toggle]').forEach(button=>button.setAttribute('aria-expanded','false'));restoreAfterClose(root);return;}
    if(isPopover(root)||root.classList.contains('playback-transform-popup')){
      if(isPopover(root))root.hidePopover();root.classList.remove('popup-fallback-open');restoreAfterClose(root);return;
    }
    if(root!==stage&&root!==document.body){
      root.querySelector('.x,.lyrics-close,#closeManualSync,#closeProcessing,#remotePanelClose,.wizard-close,[data-close],button[aria-label*="Fechar"]')?.click();restoreAfterClose(root);return;
    }
    const page=window.VoxStageMenu?.page,opener=page==='settings'?$('settingsTop'):page==='add'?$('addTop'):syncButton;
    if(window.VoxStageMenuBack?.()){requestAnimationFrame(()=>{if(visible(opener))focus(opener);});return;}
    if(stage.classList.contains('show')){
      if(stage.querySelector('.display-bottom.mix-open')){$('mobileMixToggle').click();focus($('mobileMixToggle'));return;}
      $('closeDisplay').click();restoreAfterClose(stage);return;
    }
    try{window.VoxStageMedia?.exitToLauncher();}catch{}
  }
  function changeSelect(element,direction){
    const options=[...element.options].filter(option=>!option.disabled&&!option.closest('optgroup[disabled]'));
    if(!options.length)return;const index=options.indexOf(element.selectedOptions[0]);
    element.value=options[(index+direction+options.length)%options.length].value;
    element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function move(key,active,root){
    const all=targets(root),horizontal=key==='ArrowLeft'||key==='ArrowRight',positive=key==='ArrowRight'||key==='ArrowDown';
    const group=active.closest('.menu-navigation,.menu-utilities,.menu-lyric-filters,.menu-import-steps,.settings-tabs,.palco-playback,.track-menu,.palco-more-menu');
    if(group){
      const vertical=group.matches('.settings-tabs,.track-menu,.palco-more-menu');
      if(horizontal!==vertical){const peers=targets(group),index=peers.indexOf(active),next=index+(positive?1:-1);if(peers[next]){focus(peers[next]);return;}if(vertical&&peers.length>1){focus(peers[positive?0:peers.length-1]);return;}}
    }
    const rect=active.getBoundingClientRect(),cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
    let best=null,bestScore=Infinity;
    for(const item of all){
      if(item===active)continue;const box=item.getBoundingClientRect(),dx=box.x+box.width/2-cx,dy=box.y+box.height/2-cy;
      const primary=(horizontal?dx:dy)*(positive?1:-1),perpendicular=Math.abs(horizontal?dy:dx);if(primary<2)continue;
      const overlap=horizontal?Math.min(rect.bottom,box.bottom)-Math.max(rect.top,box.top):Math.min(rect.right,box.right)-Math.max(rect.left,box.left);
      const score=primary+perpendicular*2+(overlap>0?0:80);
      if(score<bestScore){best=item;bestScore=score;}
    }
    // Sparse pages and the end of a scrollable list still have a way out.
    if(!best&&all.length>1){const index=all.indexOf(active);best=all[(index+(positive?1:-1)+all.length)%all.length];}
    focus(best);
  }
  function handleKey(key){
    if(key==='Back'||key==='Escape'){back();return true;}
    if(['MediaPlayPause','MediaPlay','MediaPause'].includes(key)){
      if(key==='MediaPlayPause'||key==='MediaPlay'&&!playing||key==='MediaPause'&&playing)toggle();return true;
    }
    if(key==='MediaTrackNext'||key==='MediaTrackPrevious'){navigateSong(key==='MediaTrackNext'?1:-1);return true;}
    if(key!=='Enter'&&!key.startsWith('Arrow'))return false;
    ensureFocus();const active=document.activeElement,root=layer();if(!targets(root).includes(active))return false;
    if(key==='Enter'){
      if(manualSyncState&&root===stage&&!active.closest('#syncToolbar,.stage-control-panel,.stage-hud')){markManualSyncInput();return true;}
      if(active.matches('select')){changeSelect(active,1);return true;}
      if(active.matches('summary'))active.parentElement.open=!active.parentElement.open;else active.click();return true;
    }
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key))return false;
    if(root===stage&&stage.classList.contains('mobile-controls-hidden')){mobileControlsToggle.click();focus($('dispPlay'));return true;}
    if(active.matches('select')&&['ArrowLeft','ArrowRight'].includes(key)){changeSelect(active,key==='ArrowRight'?1:-1);return true;}
    if(active.matches('input[type="range"]')&&['ArrowLeft','ArrowRight'].includes(key)){
      const duration=current?.buffers?.Inst?.duration;
      const step=active.matches('#seek,#dispSeek')&&duration?5000/duration:Number(active.step)||1;
      active.value=String(Math.max(Number(active.min)||0,Math.min(Number(active.max)||100,Number(active.value)+(key==='ArrowRight'?step:-step))));
      active.dispatchEvent(new Event('input',{bubbles:true}));if(active.hasAttribute('data-playback-speed'))active.dispatchEvent(new Event('change',{bubbles:true}));return true;
    }
    if(active.matches('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="radio"])')&&['ArrowLeft','ArrowRight'].includes(key))return false;
    move(key,active,root);return true;
  }
  window.voxstageTvKey = handleKey;
  document.addEventListener('keydown', event => { if (handleKey(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  // Keep focus inside a popup and recover it after library rendering.
  let scheduled = false;
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; ensureFocus(); }); } })
    .observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
  ensureFocus();
})();
