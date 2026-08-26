// Roda via GitHub Actions (agendado) — manda notificação push avisando quanto foi ganho
// líquido no dia, independente do desktop ou iPhone estarem ligados. Motivação diária.
//
// Os dados reais (data.json, push-sub.json, estado da notificação) moram num
// repositório PRIVADO separado (zyntra-fc-data) — este script lê/escreve neles
// via API do GitHub, usando um token com acesso (GH_DATA_TOKEN, secret do repo).
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const GH_DATA_TOKEN = process.env.GH_DATA_TOKEN;
const DATA_REPO = 'ZyntraGlobal/zyntra-fc-data';

async function ghGetJSON(caminho) {
  const r = await fetch('https://api.github.com/repos/' + DATA_REPO + '/contents/' + caminho, {
    headers: { 'Authorization': 'Bearer ' + GH_DATA_TOKEN, 'Accept': 'application/vnd.github+json' }
  });
  if (r.status === 404) return { json: null, sha: null };
  if (!r.ok) throw new Error('Falha ao ler ' + caminho + ' (' + r.status + ')');
  const info = await r.json();
  const json = JSON.parse(Buffer.from(info.content, 'base64').toString('utf8'));
  return { json, sha: info.sha };
}

async function ghPutJSON(caminho, obj, sha, mensagem) {
  const content = Buffer.from(JSON.stringify(obj, null, 2) + '\n').toString('base64');
  const body = { message: mensagem, content };
  if (sha) body.sha = sha;
  const r = await fetch('https://api.github.com/repos/' + DATA_REPO + '/contents/' + caminho, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + GH_DATA_TOKEN, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Falha ao gravar ' + caminho + ' (' + r.status + '): ' + await r.text());
}

// Título tem que caber numa linha só (o iOS corta e não expande sozinho na
// tela de bloqueio) — por isso é bem curto, só o valor. Detalhes (pedidos,
// lucro, despesas) vão no corpo, que consegue mostrar várias linhas sem cortar.
const FRASES_POSITIVAS = [
  '🚀 Líquido hoje: {valor}',
  '💰 Lucro líquido: {valor}',
  '🏆 Ganho líquido: {valor}'
];
const FRASES_NEUTRAS = [
  '📊 Resultado hoje: {valor}',
  '🎯 Líquido do dia: {valor}',
  '📉 Resultado líquido: {valor}'
];

// Horários alvo (hora cheia, BRT) em que a notificação deve disparar.
// O workflow roda a cada 15 min — isso aqui decide SE é a hora certa.
const HORAS_ALVO = [8, 11, 14, 17, 20];

function hojeBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // America/Sao_Paulo, UTC-3 fixo (sem horário de verão)
  return { ano: brt.getUTCFullYear(), mes: brt.getUTCMonth() + 1, dia: brt.getUTCDate(), hora: brt.getUTCHours() };
}

function hojeStr() {
  const h = hojeBRT();
  const pad = n => String(n).padStart(2, '0');
  return pad(h.dia) + '/' + pad(h.mes) + '/' + h.ano;
}

function fmtMoeda(v) {
  const sinal = v < 0 ? '-' : '';
  return sinal + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.log('VAPID keys não configuradas (secrets ausentes) — abortando.');
    return;
  }
  if (!GH_DATA_TOKEN) {
    console.log('GH_DATA_TOKEN não configurado (secret ausente) — abortando.');
    return;
  }

  const agora = hojeBRT();
  const hoje = hojeStr();

  // O GitHub Actions não garante disparo exato a cada 15 min (pode atrasar horas
  // em repos de baixa atividade) — em vez de exigir bater a hora exata, verifica
  // se algum horário-alvo já passou e ainda não foi notificado hoje, e recupera
  // no próximo run que rodar (evita perder o dia inteiro por causa do atraso).
  const disparoManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const passados = HORAS_ALVO.filter(h => h <= agora.hora);
  const { json: stateAtual, sha: stateSha } = await ghGetJSON('notif-state.json');
  const state = stateAtual || {};
  const enviadosHoje = state.dia === hoje ? (state.enviados || []) : [];
  const faltando = passados.filter(h => !enviadosHoje.includes(h));
  if (faltando.length === 0 && !disparoManual) {
    console.log('Nenhum horário-alvo pendente ainda (hora atual: ' + agora.hora + 'h BRT).');
    return;
  }

  const { json: dados } = await ghGetJSON('data.json');
  const { json: subRaw } = await ghGetJSON('push-sub.json');
  if (!dados) { console.log('data.json não encontrado no repositório de dados — abortando.'); return; }
  // push-sub.json é uma lista (um app pode estar em vários aparelhos). Notificação
  // é centralizada no dono — funcionário não recebe (role gravado pelo relay).
  const listaCompleta = Array.isArray(subRaw) ? subRaw : (subRaw && subRaw.endpoint ? [subRaw] : []);
  const subs = listaCompleta.filter(s => s.role === 'dono' || !s.role);

  const fc = dados.fc || [];
  const vnd = dados.vnd || [];

  const vendasHoje = vnd.filter(v => v.dv === hoje);
  const lancamentosHoje = fc.filter(l => l.data === hoje);

  const totalVendas = vendasHoje.reduce((a, v) => a + (Number(v.venda) || 0), 0);
  const lucroVendas = vendasHoje.reduce((a, v) => a + (Number(v.lucro) || 0), 0);
  const despesasHoje = lancamentosHoje
    .filter(l => l.tipo === 'SAÍDA OPERACIONAL' || l.tipo === 'IMPOSTOS')
    .reduce((a, l) => a + (Number(l.valor) || 0), 0);

  const ganhoLiquido = lucroVendas - despesasHoje;
  const valorFmt = fmtMoeda(ganhoLiquido);
  const frases = ganhoLiquido > 0 ? FRASES_POSITIVAS : FRASES_NEUTRAS;
  const frase = frases[Math.floor(Math.random() * frases.length)];
  const titulo = frase.replace('{valor}', valorFmt);

  const qtdPedidos = vendasHoje.length;
  const corpo = qtdPedidos > 0
    ? qtdPedidos + ' pedido' + (qtdPedidos > 1 ? 's' : '') + ' · vendido ' + fmtMoeda(totalVendas) + ' · lucro ' + fmtMoeda(lucroVendas) + (despesasHoje > 0 ? ' · despesas ' + fmtMoeda(despesasHoje) : '')
    : 'Sem vendas hoje · despesas ' + fmtMoeda(despesasHoje);

  webpush.setVapidDetails('mailto:contato@zyntraglobal.com.br', VAPID_PUBLIC, VAPID_PRIVATE);

  const payload = JSON.stringify({ title: titulo, body: corpo, icon: '/zyntra-fc/icon-192.png', badge: '/zyntra-fc/icon-192.png', tag: 'zyntra-fc-diaria-' + Date.now() });

  if (subs.length === 0) {
    console.log('Nenhum aparelho inscrito em push-sub.json.');
    process.exitCode = 1;
    return;
  }
  let okCount = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      okCount++;
    } catch (err) {
      console.log('Erro ao enviar push [' + (s.deviceId || '?') + ']. statusCode:', err.statusCode, '| body:', err.body);
    }
  }
  if (okCount > 0) {
    console.log('Push enviado com sucesso (' + okCount + '/' + subs.length + ' aparelhos):', titulo);
    await ghPutJSON('notif-state.json', { dia: hoje, enviados: passados }, stateSha, 'Atualiza estado da notificacao diaria').catch(e => console.log('Aviso: falha ao salvar estado:', e.message));
  } else {
    process.exitCode = 1;
  }
}

main();
