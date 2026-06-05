(async function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  const CHAVE = 'zyntra_v9';
  const base = location.href.replace(/\/[^/]*$/, '/');
  const DATA_URL = base + 'data.json';

  // Mostra notificação via Service Worker com o que mudou
  async function _notifSync(titulo, corpo) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(titulo, {
        body: corpo,
        icon: '/zyntra-fc/icon-192.png',
        badge: '/zyntra-fc/icon-192.png',
        tag: 'zyntra-fc-sync',
        requireInteraction: false
      });
    } catch(e) {}
  }

  // Compara DB antigo vs novo e retorna texto descrevendo as mudanças
  function _diffFC(antigo, novo) {
    if (!antigo) return null; // primeira sync — não notifica
    const partes = [];

    // Novos lançamentos FC
    const idsAntFC = new Set((antigo.fc || []).map(f => f.id));
    const novosFC  = (novo.fc || []).filter(f => !idsAntFC.has(f.id));
    if (novosFC.length > 0) {
      const nomes = novosFC.slice(0, 3).map(f => f.desc || f.cat || '?').join(', ');
      partes.push(novosFC.length + ' lançamento(s): ' + nomes + (novosFC.length > 3 ? '...' : ''));
    }

    // Novas vendas
    const idsAntVND = new Set((antigo.vnd || []).map(v => v.id));
    const novosVND  = (novo.vnd || []).filter(v => !idsAntVND.has(v.id));
    if (novosVND.length > 0) {
      const nomes = novosVND.slice(0, 3).map(v => v.produto || v.plat || '?').join(', ');
      partes.push(novosVND.length + ' venda(s): ' + nomes + (novosVND.length > 3 ? '...' : ''));
    }

    return partes.length > 0 ? partes.join(' · ') : null;
  }

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
        const diff = _diffFC(local, remoto);
        localStorage.setItem(CHAVE, JSON.stringify(remoto));
        localStorage.removeItem('zyntra_sess');
        if (diff) _notifSync('Zyntra FC — Dados atualizados', diff);
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
