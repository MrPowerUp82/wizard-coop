import { registerSW } from 'virtual:pwa-register';

/** @param {{ isIdle: () => boolean }} options */
export function setupPwa({ isIdle }) {
  const status = document.getElementById('pwaStatus');
  const install = document.getElementById('installBtn');
  const update = document.getElementById('updateBtn');
  const hint = document.getElementById('installHint');
  let ready = false;
  let failed = false;
  /** @type {(Event & { prompt: () => Promise<void>, userChoice: Promise<{ outcome: string }> }) | null} */
  let installEvent = null;
  const supported = 'serviceWorker' in navigator && window.isSecureContext;
  const render = () => {
    status.textContent = !import.meta.env.PROD ? 'O acesso sem internet fica disponível na versão de produção.'
      : !supported ? 'Para preparar o jogo offline, abra em HTTPS ou localhost em um navegador compatível.'
        : ready ? `${navigator.onLine ? 'Pronto para jogar sem internet.' : 'Sem internet. Jogo solo e desafio diário disponíveis.'} Co-op exige conexão.`
          : failed ? 'Não foi possível preparar o acesso offline. Conecte-se e reabra o jogo para tentar novamente.'
            : 'Preparando acesso sem internet… aguarde antes de desconectar.';
  };
  const standalone = matchMedia('(display-mode: standalone)');
  const hideInstalled = () => {
    if (standalone.matches) { hint.classList.add('hidden'); install.classList.add('hidden'); }
  };
  hideInstalled();
  standalone.addEventListener('change', hideInstalled);
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = /** @type {typeof installEvent} */ (event);
    install.classList.remove('hidden');
  });
  install.onclick = async () => {
    const pending = installEvent;
    if (!pending) return;
    installEvent = null;
    install.classList.add('hidden');
    try { await pending.prompt(); await pending.userChoice; }
    catch { hint.textContent = 'Use o menu do navegador para instalar o jogo.'; }
  };
  addEventListener('appinstalled', () => {
    installEvent = null;
    install.classList.add('hidden');
    hint.classList.add('hidden');
  });
  addEventListener('online', render);
  addEventListener('offline', render);
  render();
  if (!import.meta.env.PROD || !supported) return;

  // A waiting worker is activated only by the player, never during a run.
  const applyUpdate = registerSW({
    immediate: true,
    onOfflineReady() { ready = true; render(); },
    onNeedRefresh() { ready = true; render(); update.classList.remove('hidden'); },
    onRegisteredSW(_url, registration) {
      if (registration?.active && navigator.serviceWorker.controller) { ready = true; render(); }
      addEventListener('online', () => { registration?.update().catch(() => {}); });
    },
    onRegisterError() { failed = true; render(); }
  });
  update.onclick = async () => {
    if (!isIdle()) return;
    update.setAttribute('disabled', '');
    try { await applyUpdate(true); }
    catch { update.removeAttribute('disabled'); status.textContent = 'Não foi possível atualizar. Tente novamente com internet.'; }
  };
}
