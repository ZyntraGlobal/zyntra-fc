(async function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  const CHAVE = 'zyntra_v9';
  const base = location.href.replace(/\/[^/]*$/, '/');
  const DATA_URL = base + 'data.json';
  const R = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

  async function _notifSync(titulo, linhas) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      // Uma notificação por grupo de mudanças (máx 5 linhas no body)
      const body = linhas.slice(0, 5).join('\n') + (linhas.length > 5 ? '\n…+' + (linhas.length - 5) + ' mais' : '');
      await reg.showNotification(titulo, {
        body: body,
        icon: '/zyntra-fc/icon-192.png',
        badge: '/zyntra-fc/icon-192.png',
        tag: 'zyntra-fc-sync',
        requireInteraction: false
      });
    } catch(e) {}
  }

  function _diffFC(antigo, novo) {
    if (!antigo) return null;
    const linhas = [];

    // ── Lançamentos FC ──
    const mapAnt = {};
    (antigo.fc || []).forEach(f => mapAnt[f.id] = f);
    const idsNov = new Set((novo.fc || []).map(f => f.id));

    (novo.fc || []).forEach(f => {
      const a = mapAnt[f.id];
      if (!a) {
        linhas.push('➕ Lançamento: ' + f.desc + ' · ' + R(f.valor) + ' (' + (f.tipo || '') + ')');
      } else {
        const d = [];
        if (a.desc  !== f.desc)  d.push('desc: ' + f.desc);
        if (a.valor !== f.valor) d.push(R(a.valor) + ' → ' + R(f.valor));
        if (a.tipo  !== f.tipo)  d.push('tipo: ' + f.tipo);
        if (a.cat   !== f.cat)   d.push('cat: ' + f.cat);
        if (a.conta !== f.conta) d.push('conta: ' + f.conta);
        if (d.length) linhas.push('✏️ ' + f.desc + ': ' + d.join(', '));
      }
    });
    (antigo.fc || []).forEach(f => {
      if (!idsNov.has(f.id)) linhas.push('🗑️ Removido: ' + f.desc + ' · ' + R(f.valor));
    });

    // ── Vendas ──
    const mapAntV = {};
    (antigo.vnd || []).forEach(v => mapAntV[v.id] = v);
    const idsNovV = new Set((novo.vnd || []).map(v => v.id));

    (novo.vnd || []).forEach(v => {
      const a = mapAntV[v.id];
      if (!a) {
        linhas.push('🛒 Venda: ' + v.produto + ' · ' + v.plat + ' · ' + R(v.venda) + ' (lucro ' + R(v.lucro) + ')');
      } else {
        const d = [];
        if (a.venda   !== v.venda)   d.push('venda: ' + R(a.venda) + ' → ' + R(v.venda));
        if (a.lucro   !== v.lucro)   d.push('lucro: ' + R(v.lucro));
        if (a.produto !== v.produto) d.push('produto: ' + v.produto);
        if (a.plat    !== v.plat)    d.push('plat: ' + v.plat);
        if (a.qtd     !== v.qtd)     d.push('qtd: ' + v.qtd);
        if (d.length) linhas.push('✏️ Venda ' + v.produto + ': ' + d.join(', '));
      }
    });
    (antigo.vnd || []).forEach(v => {
      if (!idsNovV.has(v.id)) linhas.push('🗑️ Venda removida: ' + v.produto + ' · ' + R(v.venda));
    });

    return linhas.length ? linhas : null;
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
      const nVndRemoto = (remoto.vnd || []).length;
      const nLocal  = local ? (local.fc || []).length : 0;
      const nVndLocal = local ? (local.vnd || []).length : 0;

      if (nRemoto >= nLocal && nVndRemoto >= nVndLocal) {
        // Antes de salvar, calcula o diff
        const linhas = _diffFC(local, remoto);
        localStorage.setItem(CHAVE, JSON.stringify(remoto));
        localStorage.removeItem('zyntra_sess');
        if (linhas) {
          const qtd = linhas.length;
          _notifSync('Zyntra FC — ' + qtd + ' alteração(ões)', linhas);
        }
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

  // Polling a cada 30s quando visível, 120s em background
  function iniciarPolling() {
    let timer;
    function agendar() {
      clearTimeout(timer);
      timer = setTimeout(async function() {
        await sincronizar();
        agendar();
      }, document.hidden ? 120000 : 30000);
    }
    document.addEventListener('visibilitychange', function() { agendar(); });
    agendar();
  }
  iniciarPolling();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/zyntra-fc/sw.js', { scope: '/zyntra-fc/' })
      .then(function() {
        // Se permissão já concedida, assina push automaticamente ao abrir o app
        if ('Notification' in window && Notification.permission === 'granted') {
          navigator.serviceWorker.ready.then(function(reg) {
            reg.pushManager.getSubscription().then(function(sub) {
              var salvar = function(s) {
                fetch('https://ntfy.sh/zyntra-sub-fc-zg2026x', {
                  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s)
                }).catch(function(){});
              };
              if (sub) { salvar(sub); return; }
              function urlB64(b){var p='='.repeat((4-b.length%4)%4);var s=(b+p).replace(/-/g,'+').replace(/_/g,'/');var r=window.atob(s);var o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o;}
              reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64('BBhENPjxNvUjD-1ug7UJMdfnWJU3AvpBunQKj8dR_JNlr0J3_RFKCpRVEBbrmKIK6J_E9aCSv4y3thL_R0xMONE')
              }).then(salvar).catch(function(){});
            });
          });
        }
      })
      .catch(function(e) { console.warn('SW:', e); });
  }
})();
