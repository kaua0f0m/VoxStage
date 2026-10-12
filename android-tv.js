// TV uses the same library and audio engine, with navigation for a D-pad.
if (androidTv) (() => {
  document.body.classList.add('android-tv-app');
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'android-tv.css?v=20261011-1'; document.head.append(css);
  try { window.VoxStageMedia?.setOrientation('landscape'); } catch {}
  const stage = $('display'); stage.classList.add('mobile-stage-tv');
  let libraryFocusId = null;
  let previousLayer = null;
  const visible = element => element && !element.disabled && !element.closest('[hidden],[inert]') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  function layer() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"],.remote-panel.show,.setup-wizard.show')).filter(visible);
    const z = element => { let max = 0; for (let node = element; node; node = node.parentElement) max = Math.max(max, Number.parseInt(getComputedStyle(node).zIndex) || 0); return max; };
    dialogs.sort((a,b) => z(a) - z(b));
    return dialogs.at(-1) || (stage.classList.contains('show') ? stage : document.body);
  }
  function targets(root = layer()) {
    return Array.from(root.querySelectorAll('button,input:not([type="file"]),select,textarea,a[href],[tabindex]')).filter(element => visible(element) && element.tabIndex >= 0);
  }
  function focus(element) {
    if (!element) return;
    element.focus({preventScroll:true}); element.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function ensureFocus() {
    const root = layer(); if (!root) return;
    if (root !== previousLayer || !root.contains(document.activeElement) || !visible(document.activeElement)) {
      previousLayer = root;
      const preferred = root === stage ? (stage.classList.contains('mobile-controls-hidden') ? mobileControlsToggle : $('dispPlay')) : root.querySelector('[data-play]');
      focus(visible(preferred) ? preferred : targets(root)[0]);
    }
  }
  const syncButton = $('syncPcLibrary');
  syncButton.textContent = interfaceLanguage === 'en-US' ? 'Connect to phone' : 'Conectar com o celular';
  syncButton.onclick = showRemotePanel;
  remotePanel.querySelector('.remote-howto').textContent = interfaceLanguage === 'en-US'
    ? 'On the same Wi-Fi, scan the QR with your phone camera to control this TV. In the Android app, tap “Connect to VoxStage”. You can also send songs and your MVSEP API key from your phone.'
    : 'Na mesma rede Wi-Fi, leia o QR com a câmera do celular para controlar esta TV. No app Android, toque em “Conectar ao VoxStage”. Você também pode enviar músicas e sua chave MVSEP do celular para esta TV.';
  remotePanel.querySelector('.remote-panel-note').textContent = interfaceLanguage === 'en-US' ? 'Songs already in the library enter the queue automatically. Songs saved only on the phone are copied to the TV. Only new songs need approval.' : 'Músicas da biblioteca entram automaticamente na fila. Faixas salvas só no celular são copiadas para a TV. Apenas músicas novas precisam de aprovação.';
  $('remoteTransferList').previousElementSibling.hidden = true; $('remoteTransferList').hidden = true;
  // A request approval is explicit and should dismiss the QR before playback.
  const requestDecision = decideRemoteRequest;
  decideRemoteRequest = async (id, decision) => { await requestDecision(id, decision); if (decision === 'approve' && playing) closeRemotePanel(); };

  window.addEventListener('voxstage-tv-song-started', () => {
    libraryFocusId = current?.id;
    if (stage.classList.contains('show')) return;
    stage.classList.add('show','mobile-stage-tv');
    setStageControlsHidden(false);
    closeRemotePanel(); focus($('dispPlay'));
  });
  function returnToLibrary() {
    stage.classList.remove('show');
    const button = libraryFocusId && document.querySelector(`[data-play="${CSS.escape(libraryFocusId)}"]`);
    focus(visible(button) ? button : document.querySelector('[data-play]') || $('addTop'));
  }
  window.addEventListener('voxstage-tv-song-ended', returnToLibrary);
  window.addEventListener('voxstage-tv-library', returnToLibrary);

  function back() {
    const root = layer();
    if (root !== stage && root !== document.body) {
      const close = root.querySelector('.x,.lyrics-close,#closeManualSync,#closeProcessing,#remotePanelClose,.wizard-close,[data-close]');
      if (close) close.click();
      else if (root.closest('.setup-wizard')) root.closest('.setup-wizard').classList.remove('show');
      return;
    }
    if (stage.classList.contains('show')) {
      if (stage.classList.contains('mix-open')) { $('mobileMixToggle').click(); return; }
      $('closeDisplay').click(); return;
    }
    const openMenu = document.querySelector('.track-menu:not([hidden])');
    if (openMenu) { openMenu.hidden = true; focus(openMenu.previousElementSibling); return; }
    // Back at the root returns to Android's launcher, not a browser history page.
    try { window.VoxStageMedia?.exitToLauncher(); } catch {}
  }
  function handleKey(key) {
    if (key === 'Back' || key === 'Escape') { back(); return true; }
    ensureFocus();
    const active = document.activeElement;
    if (key === 'Enter') {
      if (manualSyncState && layer() === stage && !active.closest('#syncToolbar,.stage-control-panel,.stage-hud')) { markManualSyncInput(); return true; }
      active?.click(); return true;
    }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)) return false;
    if (stage.classList.contains('show') && stage.classList.contains('mobile-controls-hidden') && layer() === stage) {
      mobileControlsToggle.click(); focus($('dispPlay')); return true;
    }
    if (active?.matches('input[type="range"]') && ['ArrowLeft','ArrowRight'].includes(key)) {
      const step = Number(active.step) || 1;
      active.value = String(Math.max(Number(active.min) || 0, Math.min(Number(active.max) || 100, Number(active.value) + (key === 'ArrowRight' ? step : -step))));
      active.dispatchEvent(new Event('input',{bubbles:true})); return true;
    }
    if (active?.matches('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="radio"])') && ['ArrowLeft','ArrowRight'].includes(key)) return false;
    const rect = active.getBoundingClientRect(); const cx = rect.x + rect.width/2, cy = rect.y + rect.height/2;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight', positive = key === 'ArrowRight' || key === 'ArrowDown';
    let best = null, bestScore = Infinity;
    for (const item of targets()) {
      if (item === active) continue;
      const box = item.getBoundingClientRect(); const dx = box.x+box.width/2-cx, dy = box.y+box.height/2-cy;
      const primary = horizontal ? dx : dy, perpendicular = Math.abs(horizontal ? dy : dx);
      if ((positive ? primary : -primary) < 4) continue;
      // Prefer controls in the same row or column before a diagonal jump.
      const score = Math.abs(primary) + perpendicular*3;
      if (score < bestScore) { best = item; bestScore = score; }
    }
    focus(best); return true;
  }
  window.voxstageTvKey = handleKey;
  document.addEventListener('keydown', event => { if (handleKey(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  // Keep focus inside a popup and recover it after library rendering.
  let scheduled = false;
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; ensureFocus(); }); } })
    .observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
  ensureFocus();
})();
