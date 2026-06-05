(async function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  const CHAVE = 'zyntra_v9';
  // raw.githubusercontent.com atualiza em segundos após o commit (GitHub Pages CDN demora minutos)
  const DATA_URL = 'https://raw.githubusercontent.com/ZyntraGlobal/zyntra-fc/main/data.json';
  const R = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

  window._zyntraLastSync = window._zyntraLastSync || null;
  window._zyntraSyncStatus = window._zyntraSyncStatus || 'Aguardando...';

  async function _notifSync(titulo, linhas) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const body = linhas.slice(0, 6).join('\n') + (linhas.length > 6 ? '\n…+' + (linhas.length - 6) + ' mais' : '');
      await reg.showNotification(titulo, {
        body: body,
        icon: '/zyntra-fc/icon-192.png',
        badge: '/zyntra-fc/icon-192.png',
        tag: 'zyntra-fc-sync',
        requireInteraction: false
      });
    } catch(e) { console.warn('notif err:', e); }
  }

  function _diffFC(antigo, novo) {
    if (!antigo) return null;
    const linhas = [];
    const mAnt = {}; (antigo.fc || []).forEach(f => mAnt[f.id] = f);
    const idsN = new Set((novo.fc || []).map(f => f.id));
    (novo.fc || []).forEach(f => {
      const a = mAnt[f.id];
      if (!a) { linhas.push('➕ Lançamento: ' + f.desc + ' · ' + R(f.valor) + ' (' + (f.tipo||'') + ')'); }
      else {
        const d = [];
        if (a.desc  !== f.desc)  d.push('desc: ' + f.desc);
        if (a.valor !== f.valor) d.push(R(a.valor) + ' → ' + R(f.valor));
        if (a.tipo  !== f.tipo)  d.push('tipo: ' + f.tipo);
        if (a.cat   !== f.cat)   d.push('cat: ' + f.cat);
        if (a.conta !== f.conta) d.push('conta: ' + f.conta);
        if (d.length) linhas.push('✏️ ' + f.desc + ': ' + d.join(', '));
      }
    });
    (antigo.fc || []).forEach(f => { if (!idsN.has(f.id)) linhas.push('🗑️ Removido: ' + f.desc + ' · ' + R(f.valor)); });
    const mAntV = {}; (antigo.vnd || []).forEach(v => mAntV[v.id] = v);
    const idsNV = new Set((novo.vnd || []).map(v => v.id));
    (novo.vnd || []).forEach(v => {
      const a = mAntV[v.id];
      if (!a) { linhas.push('🛒 Venda: ' + v.produto + ' · ' + v.plat + ' · ' + R(v.venda) + ' (lucro ' + R(v.lucro) + ')'); }
      else {
        const d = [];
        if (a.venda   !== v.venda)   d.push(R(a.venda) + ' → ' + R(v.venda));
        if (a.lucro   !== v.lucro)   d.push('lucro: ' + R(v.lucro));
        if (a.produto !== v.produto) d.push('produto: ' + v.produto);
        if (a.plat    !== v.plat)    d.push('plat: ' + v.plat);
        if (d.length) linhas.push('✏️ Venda ' + v.produto + ': ' + d.join(', '));
      }
    });
    (antigo.vnd || []).forEach(v => { if (!idsNV.has(v.id)) linhas.push('🗑️ Venda: ' + v.produto + ' · ' + R(v.venda)); });
    return linhas.length ? linhas : null;
  }

  async function sincronizar() {
    try {
      const resp = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) { window._zyntraSyncStatus = 'Erro HTTP ' + resp.status; return false; }
      const remoto = await resp.json();
      if (!remoto || !remoto.fc) { window._zyntraSyncStatus = 'JSON inválido'; return false; }

      let local = null;
      try { local = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) {}

      const nRemoto  = (remoto.fc  || []).length;
      const nLocal   = local ? (local.fc  || []).length : 0;
      const nvRemoto = (remoto.vnd || []).length;
      const nvLocal  = local ? (local.vnd || []).length : 0;

      window._zyntraLastSync = new Date().toLocaleTimeString('pt-BR');
      window._zyntraSyncStatus = 'Remoto: ' + nRemoto + ' lanç · ' + nvRemoto + ' vendas | Local: ' + nLocal + ' · ' + nvLocal;

      // Dados diferentes → notifica
      if (nRemoto !== nLocal || nvRemoto !== nvLocal ||
          JSON.stringify(remoto.fc) !== JSON.stringify((local||{}).fc) ||
          JSON.stringify(remoto.vnd) !== JSON.stringify((local||{}).vnd)) {
        const linhas = _diffFC(local, remoto);
        localStorage.setItem(CHAVE, JSON.stringify(remoto));
        localStorage.removeItem('zyntra_sess');
        if (linhas && linhas.length > 0) {
          _notifSync('Zyntra FC — ' + linhas.length + ' alteração(ões)', linhas);
        } else if (local) {
          // Dados mudaram mas diff não detectou detalhe — notifica genérico
          _notifSync('Zyntra FC — dados atualizados', ['Dados sincronizados do desktop']);
        }
        return true;
      }
      return false;
    } catch (e) {
      window._zyntraSyncStatus = 'Erro: ' + e.message;
      return false;
    }
  }

  const atualizou = await sincronizar();
  if (atualizou) {
    const jaLogado = localStorage.getItem('zyntra_sess');
    if (jaLogado && typeof carregarDados === 'function') carregarDados();
    else if (jaLogado) window.dispatchEvent(new CustomEvent('zyntra-sync'));
  }

  // Polling 15s visível / 60s background
  function iniciarPolling() {
    let timer;
    function agendar() {
      clearTimeout(timer);
      timer = setTimeout(async function() { await sincronizar(); agendar(); },
        document.hidden ? 60000 : 15000);
    }
    document.addEventListener('visibilitychange', agendar);
    agendar();
  }
  iniciarPolling();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/zyntra-fc/sw.js', { scope: '/zyntra-fc/' })
      .then(function() {
        if ('Notification' in window && Notification.permission === 'granted') {
          navigator.serviceWorker.ready.then(function(reg) {
            reg.pushManager.getSubscription().then(function(sub) {
              function urlB64(b){var p='='.repeat((4-b.length%4)%4);var s=(b+p).replace(/-/g,'+').replace(/_/g,'/');var r=window.atob(s);var o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o;}
              var salvar = function(s) { fetch('https://ntfy.sh/zyntra-sub-fc-zg2026x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).catch(function(){}); };
              if (sub) { salvar(sub); return; }
              reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64('BBhENPjxNvUjD-1ug7UJMdfnWJU3AvpBunQKj8dR_JNlr0J3_RFKCpRVEBbrmKIK6J_E9aCSv4y3thL_R0xMONE') })
                .then(salvar).catch(function(){});
            });
          });
        }
      })
      .catch(function(e) { console.warn('SW:', e); });
  }
})();
