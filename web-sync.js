(async function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  const CHAVE    = 'zyntra_v9';
  // Leitura e escrita passam pelo relay, autenticadas com o token de sessão do
  // login — o navegador não fala mais direto com o GitHub (o repo de dados é
  // privado agora, e o relay decide o que cada papel pode ver/escrever).
  const PUSH_RELAY_URL = 'https://zyntra-push-relay.nameless-bonus-004f.workers.dev';
  const R = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

  function _sessaoWS() {
    try { return JSON.parse(localStorage.getItem('zyntra_sess') || '{}'); } catch(e) { return {}; }
  }

  // O Service Worker não tem localStorage — manda o token de sessão por
  // postMessage sempre que temos um, pra ele conseguir se autocorrigir sozinho.
  function _avisarTokenSW() {
    var tok = _sessaoWS().token;
    if (tok && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SESSION_TOKEN', token: tok });
    }
  }

  async function _notifSync(titulo, linhas) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const body = linhas.slice(0, 6).join('\n') + (linhas.length > 6 ? '\n…+' + (linhas.length - 6) + ' mais' : '');
      await reg.showNotification(titulo, {
        body, icon: 'icon-192.png', badge: 'icon-192.png',
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
      const sess = _sessaoWS();
      if (!sess.token) return false; // sem sessão válida ainda — nada a sincronizar

      // AbortController: evita travar pra sempre numa rede lenta/instável
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(PUSH_RELAY_URL + '/data?app=fc', {
        signal: ctrl.signal,
        headers: { 'Authorization': 'Bearer ' + sess.token }
      }).finally(() => clearTimeout(to));
      if (resp.status === 401) { try { if (typeof window._expirarSessao === 'function') window._expirarSessao(); } catch(e) {} return false; }
      if (!resp.ok) return false;
      const body = await resp.json();
      const remoto = body && body.data;
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

  // 'zyntra-sync' é ouvido pelo index.html, que redesenha a tela em memória
  // (nunca usar location.reload() aqui — no PWA instalado do iOS isso é
  // tratado como navegação e chega a tirar o usuário do modo de app)
  function _aplicarSeMudou(mudou) {
    if (!mudou) return;
    const jaLogado = localStorage.getItem('zyntra_sess');
    if (jaLogado && typeof carregarDados === 'function') carregarDados();
    else if (jaLogado) window.dispatchEvent(new CustomEvent('zyntra-sync'));
  }

  _aplicarSeMudou(await sincronizar());

  // Exposto para o botão "🔄 Atualizar" da topbar — sincroniza sob demanda, sem esperar o polling
  window.forcarSincronizarFC = async function() {
    const mudou = await sincronizar();
    _aplicarSeMudou(mudou);
    return mudou;
  };

  // Renova subscription push, republica no relay ntfy (instantâneo, mas expira em 12h)
  // e persiste no GitHub (push-sub.json — não expira, é a fonte confiável pro desktop).
  // push-sub.json é uma LISTA de aparelhos (não um só) — o mesmo app pode estar
  // instalado em vários iPhones ao mesmo tempo (ex: pessoal + da empresa), cada um
  // identificado por um deviceId próprio e aleatório gerado uma vez e guardado local.
  var _lastPushRenew = 0;
  // Publica através do relay — dedupe por endpoint já acontece do lado do servidor.
  function _salvarSubGitHubFC(sub, forcar) {
    try {
      var mudou = localStorage.getItem('fc_push_ep') !== sub.endpoint;
      var ultimaPub = Number(localStorage.getItem('fc_push_pub_ts') || 0);
      // Sem mudança de endpoint, republica mesmo assim 1x/dia — autocorreção caso o
      // arquivo remoto tenha ficado dessincronizado sem o endpoint em si ter mudado.
      if (!mudou && !forcar && (Date.now() - ultimaPub) < 86400000) return;
      // sub é um PushSubscription nativo — .keys não existe como propriedade direta
      // (só endpoint tem getter), as chaves só saem via .toJSON(). Sem isso, a
      // subscription salva ficava sem "keys" e o push falhava silenciosamente.
      var subJson = sub.toJSON ? sub.toJSON() : sub;
      var _tok = _sessaoWS().token;
      if (!_tok) return; // sem sessão ainda — a próxima renovação tenta de novo
      fetch(PUSH_RELAY_URL + '/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _tok },
        body: JSON.stringify({ app: 'fc', subscription: { endpoint: sub.endpoint, keys: subJson.keys } })
      }).then(function(r) {
        if (r && r.ok) {
          localStorage.setItem('fc_push_ep', sub.endpoint);
          localStorage.setItem('fc_push_pub_ts', String(Date.now()));
        } else {
          setTimeout(function() { _salvarSubGitHubFC(sub, true); }, 30000);
        }
      }).catch(function() { setTimeout(function() { _salvarSubGitHubFC(sub, true); }, 30000); });
    } catch(e) {}
  }
  function _renewPushFC() {
    _avisarTokenSW();
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
    var now = Date.now();
    if (now - _lastPushRenew < 1200000) return; // a cada 20 min
    _lastPushRenew = now;
    navigator.serviceWorker.ready.then(function(reg) {
      function urlB64(b){var p='='.repeat((4-b.length%4)%4);var s=(b+p).replace(/-/g,'+').replace(/_/g,'/');var r=window.atob(s);var o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o;}
      var chaveAtual = urlB64('BITLfwTQwUU_BYIbbdEXYoUAEp7sy6iiL52Cn-GmnuljgI4F0cPgiT5xgjSM-uV33AIP9LvWf3QrsLR1CRvE-FQ');
      var salvar = function(s){
        fetch('https://ntfy.sh/zyntra-sub-fc-zg2026x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)}).catch(function(){});
        _salvarSubGitHubFC(s);
      };
      // Se a chave VAPID mudou (rotação de chave), a subscription antiga fica inválida
      // pro servidor — descarta e reinscreve com a chave nova, sem precisar de ação manual.
      function chaveBate(sub){
        try {
          var atual = new Uint8Array(sub.options.applicationServerKey);
          if (atual.length !== chaveAtual.length) return false;
          for (var i=0;i<atual.length;i++) if (atual[i]!==chaveAtual[i]) return false;
          return true;
        } catch(e) { return true; } // sem suporte a .options: assume que bate, evita loop de resubscribe
      }
      reg.pushManager.getSubscription().then(function(sub) {
        if (sub && chaveBate(sub)) { salvar(sub); return; }
        var refazer = function(){
          reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveAtual })
            .then(salvar).catch(function(){});
        };
        if (sub) { sub.unsubscribe().then(refazer).catch(refazer); } else { refazer(); }
      });
    }).catch(function(){});
  }

  // Polling: 10s com app aberto, 60s em background
  function iniciarPolling() {
    let timer;
    function agendar() {
      clearTimeout(timer);
      timer = setTimeout(async function() { _aplicarSeMudou(await sincronizar()); _renewPushFC(); agendar(); },
        document.hidden ? 60000 : 10000);
    }
    document.addEventListener('visibilitychange', function() { _renewPushFC(); agendar(); });
    agendar();
  }
  iniciarPolling();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(function() { _renewPushFC(); })
      .catch(function(e) { console.warn('SW:', e); });
  }

  // Exposto pro botão "🔄 Renovar Push" do index.html — _renewPushFC/_salvarSubGitHubFC
  // vivem fechados dentro desta IIFE, então precisam de uma ponte explícita pra fora.
  // Ignora os dois throttles (20min do _renewPushFC, 1x/dia do _salvarSubGitHubFC) —
  // é um pedido manual e direto do usuário, sempre publica na hora.
  window._forcarRenovarPushFC = function() {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return Promise.resolve(false);
    function urlB64(b){var p='='.repeat((4-b.length%4)%4);var s=(b+p).replace(/-/g,'+').replace(/_/g,'/');var r=window.atob(s);var o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o;}
    return navigator.serviceWorker.ready.then(function(reg) {
      return reg.pushManager.getSubscription().then(function(sub) {
        if (sub) { _salvarSubGitHubFC(sub, true); return true; }
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64('BITLfwTQwUU_BYIbbdEXYoUAEp7sy6iiL52Cn-GmnuljgI4F0cPgiT5xgjSM-uV33AIP9LvWf3QrsLR1CRvE-FQ') })
          .then(function(sub2) { _salvarSubGitHubFC(sub2, true); return true; }).catch(function() { return false; });
      });
    }).catch(function() { return false; });
  };
})();
