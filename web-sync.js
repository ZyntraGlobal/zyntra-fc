(async function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  const CHAVE = 'zyntra_v9';
  const base = location.href.replace(/\/[^/]*$/, '/');
  const DATA_URL = base + 'data.json';

  async function sincronizar() {
    try {
      const resp = await fetch(DATA_URL + '?t=' + Date.now());
      if (!resp.ok) return false;
      const remoto = await resp.json();
      if (!remoto || !remoto.fc) return false;

      let local = null;
      try { local = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) {}

      const nRemoto = (remoto.fc || []).length;
      const nLocal  = (local && local.fc) ? local.fc.length : 0;

      if (nRemoto >= nLocal) {
        localStorage.setItem(CHAVE, JSON.stringify(remoto));
        localStorage.removeItem('zyntra_sess');
        return true;
      }
      return false;
    } catch (e) { return false; }
  }

  const atualizou = await sincronizar();
  if (atualizou) {
    const jaLogado = localStorage.getItem('zyntra_sess');
    if (jaLogado && typeof carregarDados === 'function') carregarDados();
    else if (jaLogado) window.dispatchEvent(new CustomEvent('zyntra-sync'));
  }

  setInterval(sincronizar, 120000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/zyntra-fc/sw.js', { scope: '/zyntra-fc/' })
      .catch(function(e) { console.warn('SW:', e); });
  }
})();
