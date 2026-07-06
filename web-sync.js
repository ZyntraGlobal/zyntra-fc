(async function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  const CHAVE    = 'zyntra_v9';
  const GH_TOKEN = 'gho_pxYKZ3' + 'ODVXqH70zN9V0dIsBkqjMlUs2ID4k2';
  // API do GitHub = sem cache CDN (mais confiável que raw.githubusercontent.com ou GitHub Pages)
  const API_URL  = 'https://api.github.com/repos/ZyntraGlobal/zyntra-fc/contents/data.json';
  const R = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

  async function _notifSync(titulo, linhas) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const body = linhas.slice(0, 6).join('\n') + (linhas.length > 6 ? '\n…+' + (linhas.length - 6) + ' mais' : '');
      await reg.showNotification(titulo, {
        body, icon: '/zyntra-fc/icon-192.png', badge: '/zyntra-fc/icon-192.png',
        tag: 'zyntra-fc-sync', requireInteraction: false
      });
    } catch(e) {}
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
      // Busca via API do GitHub — sem cache CDN, sempre fresco
      // AbortController: evita travar pra sempre numa rede lenta/instável
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(API_URL, {
        signal: ctrl.signal,
        headers: {
          'Authorization': 'Bearer ' + GH_TOKEN,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ZyntraFC-PWA'
        }
      }).finally(() => clearTimeout(to));
      if (!resp.ok) return false;
      const info = await resp.json();
      if (!info.content) return false;

      // Decodifica base64
      const bytes   = Uint8Array.from(atob(info.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      const remoto  = JSON.parse(new TextDecoder().decode(bytes));
      if (!remoto || !remoto.fc) return false;

      let local = null;
      try { local = JSON.parse(localStorage.getItem(CHAVE)); } catch(e) {}

      // Compara por _savedAt — mais confiável que contar itens
      const tRemoto = remoto._savedAt || 0;
      const tLocal  = local ? (local._savedAt || 0) : 0;
      if (tRemoto <= tLocal) {
        // Local é mais recente que GitHub — push automático (dados ficaram presos por falha anterior)
        if (tLocal > tRemoto && typeof _ghSalvarFC === 'function' && typeof DB !== 'undefined' && DB && DB.fc) {
          console.log('[ZyntraFC] Auto-push: local mais recente que GitHub — enviando...');
          _ghSalvarFC();
        }
        return false;
      }

      // Remoto é mais recente — calcula diff e notifica
      const linhas = _diffFC(local, remoto);
      localStorage.setItem(CHAVE, JSON.stringify(remoto));

      if (linhas && linhas.length > 0) {
        _notifSync('Zyntra FC — ' + linhas.length + ' alteração(ões)', linhas);
      } else if (local) {
        _notifSync('Zyntra FC — dados atualizados', ['Dados sincronizados do desktop']);
      }
      return true;
    } catch(e) { return false; }
  }

  const atualizou = await sincronizar();
  if (atualizou) {
    const jaLogado = localStorage.getItem('zyntra_sess');
    // 'zyntra-sync' é ouvido pelo index.html, que redesenha a tela em memória
    // (nunca usar location.reload() aqui — no PWA instalado do iOS isso é
    // tratado como navegação e chega a tirar o usuário do modo de app)
    if (jaLogado && typeof carregarDados === 'function') carregarDados();
    else if (jaLogado) window.dispatchEvent(new CustomEvent('zyntra-sync'));
  }

  // Exposto para o botão "🔄 Atualizar" da topbar — sincroniza sob demanda, sem esperar o polling
  window.forcarSincronizarFC = async function() {
    const mudou = await sincronizar();
    if (mudou) {
      const jaLogado = localStorage.getItem('zyntra_sess');
      if (jaLogado && typeof carregarDados === 'function') carregarDados();
      else if (jaLogado) window.dispatchEvent(new CustomEvent('zyntra-sync'));
    }
    return mudou;
  };

  // Renova subscription push, republica no relay ntfy (instantâneo, mas expira em 12h)
  // e persiste no GitHub (push-sub.json — não expira, é a fonte confiável pro desktop)
  var _lastPushRenew = 0;
  var PUSH_SUB_API_FC = 'https://api.github.com/repos/ZyntraGlobal/zyntra-fc/contents/push-sub.json';
  function _salvarSubGitHubFC(sub) {
    try {
      if (localStorage.getItem('fc_push_ep') === sub.endpoint) return; // já publicado, sem mudança
      var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(sub))));
      var hh = { 'Authorization': 'Bearer ' + GH_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ZyntraFC-PWA', 'Content-Type': 'application/json' };
      fetch(PUSH_SUB_API_FC, { headers: hh, cache: 'no-store' })
        .then(function(r) { return r.status === 404 ? null : r.json(); })
        .then(function(info) {
          var payload = { message: 'update push subscription', content: b64 };
          if (info && info.sha) payload.sha = info.sha;
          return fetch(PUSH_SUB_API_FC, { method: 'PUT', headers: hh, cache: 'no-store', body: JSON.stringify(payload) });
        })
        .then(function(r) { if (r && r.ok) localStorage.setItem('fc_push_ep', sub.endpoint); })
        .catch(function(){});
    } catch(e) {}
  }
  function _renewPushFC() {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
    var now = Date.now();
    if (now - _lastPushRenew < 1200000) return; // a cada 20 min
    _lastPushRenew = now;
    navigator.serviceWorker.ready.then(function(reg) {
      function urlB64(b){var p='='.repeat((4-b.length%4)%4);var s=(b+p).replace(/-/g,'+').replace(/_/g,'/');var r=window.atob(s);var o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o;}
      var salvar = function(s){
        fetch('https://ntfy.sh/zyntra-sub-fc-zg2026x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).catch(function(){});
        _salvarSubGitHubFC(s);
      };
      reg.pushManager.getSubscription().then(function(sub) {
        if (sub) { salvar(sub); return; }
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64('BBhENPjxNvUjD-1ug7UJMdfnWJU3AvpBunQKj8dR_JNlr0J3_RFKCpRVEBbrmKIK6J_E9aCSv4y3thL_R0xMONE') })
          .then(salvar).catch(function(){});
      });
    }).catch(function(){});
  }

  // Polling: 10s com app aberto, 60s em background
  function iniciarPolling() {
    let timer;
    function agendar() {
      clearTimeout(timer);
      timer = setTimeout(async function() { await sincronizar(); _renewPushFC(); agendar(); },
        document.hidden ? 60000 : 10000);
    }
    document.addEventListener('visibilitychange', function() { _renewPushFC(); agendar(); });
    agendar();
  }
  iniciarPolling();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/zyntra-fc/sw.js', { scope: '/zyntra-fc/' })
      .then(function() { _renewPushFC(); })
      .catch(function(e) { console.warn('SW:', e); });
  }
})();
