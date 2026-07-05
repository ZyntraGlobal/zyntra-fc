// Roda via GitHub Actions (agendado) — manda notificação push avisando quanto foi ganho
// líquido no dia, independente do desktop ou iPhone estarem ligados. Motivação diária.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

const FRASES_POSITIVAS = [
  '🚀 Hoje você ganhou {valor} líquido! Continue assim',
  '💰 Fechou o dia com {valor} de lucro líquido. Orgulho!',
  '🔥 {valor} líquido no bolso hoje. Você está construindo algo grande',
  '⭐ Dia produtivo: {valor} de ganho líquido',
  '🏆 {valor} líquido hoje — a Zyntra está crescendo'
];
const FRASES_NEUTRAS = [
  '📊 Hoje o resultado líquido foi {valor}. Amanhã é um novo dia',
  '🎯 Fechamento do dia: {valor} líquido. Bora ajustar a rota',
  '📉 Resultado líquido de hoje: {valor}. Fique de olho nas despesas'
];

function hojeBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // America/Sao_Paulo, UTC-3 fixo (sem horário de verão)
  return { ano: brt.getUTCFullYear(), mes: brt.getUTCMonth() + 1, dia: brt.getUTCDate() };
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

  const dataPath = path.join(__dirname, '..', 'data.json');
  const subPath = path.join(__dirname, '..', 'push-sub.json');

  if (!fs.existsSync(dataPath) || !fs.existsSync(subPath)) {
    console.log('data.json ou push-sub.json não encontrado — abortando.');
    return;
  }

  const dados = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const sub = JSON.parse(fs.readFileSync(subPath, 'utf8'));

  const hoje = hojeStr();
  const fc = dados.fc || [];
  const vnd = dados.vnd || [];

  const vendasHoje = vnd.filter(v => v.dv === hoje);
  const lancamentosHoje = fc.filter(l => l.data === hoje);

  if (vendasHoje.length === 0 && lancamentosHoje.length === 0) {
    console.log('Nenhuma venda ou lançamento hoje — não envia notificação.');
    return;
  }

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
    ? qtdPedidos + ' pedido' + (qtdPedidos > 1 ? 's' : '') + ' hoje · lucro vendas ' + fmtMoeda(lucroVendas) + (despesasHoje > 0 ? ' · despesas ' + fmtMoeda(despesasHoje) : '')
    : 'Sem vendas hoje · despesas ' + fmtMoeda(despesasHoje);

  webpush.setVapidDetails('mailto:contato@zyntraglobal.com.br', VAPID_PUBLIC, VAPID_PRIVATE);

  const payload = JSON.stringify({ title: titulo, body: corpo, icon: '/zyntra-fc/icon-192.png', badge: '/zyntra-fc/icon-192.png', tag: 'zyntra-fc-diaria-' + Date.now() });

  try {
    await webpush.sendNotification(sub, payload);
    console.log('Push enviado com sucesso:', titulo);
  } catch (err) {
    console.log('Erro ao enviar push. statusCode:', err.statusCode, '| body:', err.body);
    process.exitCode = 1;
  }
}

main();
