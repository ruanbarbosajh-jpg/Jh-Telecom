'use strict';
// FERRAMENTAS que o planejador de IA pode escolher (28/10/2026). A IA NÃO executa nada e NÃO vê dado nenhum: ela só devolve
// { ferramenta, parametros } — o navegador (logado, com o RLS do Analista) valida de novo e roda a função que já existe no sistema.
// Este arquivo é a LISTA AUTORIZADA: ferramenta ou parâmetro fora daqui é descartado pelo servidor. Mudou aqui = conferir o mesmo nome
// no executor do navegador (jh-telecom-erp-demo.html, módulo IA, `EXECUTORES_IA`).

const CIDADES = ['GUARUJA', 'BERTIOGA', 'CUBATAO', 'SANTOS', 'SAO VICENTE', 'PRAIA GRANDE'];
const SITUACOES = ['pendente', 'em_rota', 'iniciado', 'concluido', 'improdutivo', 'cancelado'];
const REFS_PERIODO = ['hoje', 'ontem', 'semana_atual', 'semana_passada', 'mes_atual', 'mes_passado', 'ciclo_atual', 'ciclo_anterior', 'ultimos_n_dias', 'intervalo'];

// relatórios que já existem nas telas (CATALOGO do navegador)
const RELATORIOS = {
  pendentes: 'O.S pendentes do dia (lista, por tipo e prazo) — precisa de um dia',
  aExecutar: 'A Executar por cidade e tipo de serviço (só pendentes) — precisa de um dia',
  reparosSituacao: 'Situação dos reparos do dia (pendentes, em rota, iniciados, concluídos…) — precisa de um dia',
  prazoCartaoDia: 'Acompanhamento de prazos do dia (reparo 24h por cidade) — precisa de um dia',
  prazoAtivacaoDia: 'Prazo de ativação 36h do dia — precisa de um dia',
  prazoPorDia: 'Prazo de reparo por dia, tabela e gráficos — período',
  prodTecnico: 'Produção por técnico — período',
  prodCidade: 'Produção por cidade — período',
  rentab: 'Resultado por técnico: quem se paga — período',
  improdutivas: 'Técnicos com mais improdutivas (ranking) — período',
  apos18: 'Ordens concluídas depois das 18h — período',
  max: 'MAX: clientes que mais abriram chamado de reparo — período',
  ofensoresMotivos: 'Ofensores e motivos dos retornos IFI/IRR — período',
  retornosEvol: 'Evolução do % de retorno IFI/IRR — período',
};

const TIPO_RET = { enum: ['IFI', 'IRR', 'todos'] };
const COMUM = {
  cidades: { lista: CIDADES },
  tecnico: { texto: 60 },
  visual: { enum: ['tabela', 'grafico'] },
};

const FERRAMENTAS = {
  prazos_do_dia: {
    descricao: 'Tabela "Prazos do Dia — Detalhado" da PCR: os reparos de UM dia (prazo de 24h) com quanto falta, horário limite, situação e faixa de prazo, as ordens em aberto primeiro (a que vence antes no topo). Serve para "prazos de hoje", "o que está vencendo", "quais reparos já venceram / estouraram / estão atrasados", "qual o prazo mais cedo", "prazo do técnico X", "prazos da manhã". NÃO serve para prazo de semana/mês (use relatorio_existente prazoPorDia).',
    parametros: {
      data: { data: true },
      cidades: COMUM.cidades,
      tecnico: COMUM.tecnico,
      situacao: { lista: SITUACOES },
      foco: { enum: ['todos', 'vencidas', 'vencem_2h', 'em_aberto'] },
      turno: { enum: ['manha', 'tarde'] },
      limite: { inteiro: [1, 300] },
    },
  },
  retornos_do_dia: {
    descricao: 'Tabela "Retornos do Dia (IFI / IRR)" da PCR: retornos de UM dia, ordem por ordem (lido do CSV de atividades). IFI = retorno de ativação/mudança de endereço (até 15 dias); IRR = retorno de reparo (até 30 dias). Serve para "IFI e IRR pendentes hoje", "quais os retornos de hoje", "retornos em rota". Cada linha tem a situação ATUAL da ordem de retorno.',
    parametros: {
      data: { data: true },
      tipo: TIPO_RET,
      situacao: { lista: SITUACOES },
      cidades: COMUM.cidades,
      tecnico: COMUM.tecnico,
      ofensor: { texto: 60 },
      ordenar: { enum: ['abertura_mais_antiga', 'prazo_restante', 'dias_desde_servico_anterior'] },
      agrupar: { enum: ['nenhum', 'tecnico', 'ofensor', 'cidade', 'tipo', 'situacao'] },
      visual: COMUM.visual,
      comparar: { enum: ['nenhum', 'dia_anterior'] },
      limite: { inteiro: [1, 200] },
    },
  },
  retornos_periodo: {
    descricao: 'IFI/IRR de um PERÍODO (semana, mês, ciclo 21→20, intervalo) — total, % contra a meta (IFI ≤ 2,50% das ativações+M.E, IRR ≤ 4,50% dos reparos), por técnico OFENSOR, por cidade ou por dia. Conta só retornos CONCLUÍDOS (Produção); não serve para pendentes.',
    parametros: {
      periodo: { periodo: true },
      tipo: TIPO_RET,
      cidades: COMUM.cidades,
      tecnico: COMUM.tecnico,
      agrupar: { enum: ['nenhum', 'tecnico', 'cidade', 'dia'] },
      visual: COMUM.visual,
      comparar: { enum: ['nenhum', 'periodo_anterior'] },
      limite: { inteiro: [1, 50] },
    },
  },
  improdutivas_em_aberto: {
    descricao: 'Ordens que estão em campo (pendente, em rota ou iniciada) mas JÁ tiveram visita improdutiva ("Não Concluído"), com o motivo e o técnico de cada visita. Serve para "improdutivas pendentes", "ordens que já deram ausente", "quem visitou e não conseguiu".',
    parametros: {
      data: { data: true },
      situacao: { lista: ['pendente', 'em_rota', 'iniciado'] },
      cidades: COMUM.cidades,
      tecnico: COMUM.tecnico,
      motivo: { texto: 60 },
      min_visitas: { inteiro: [1, 10] },
      agrupar: { enum: ['nenhum', 'motivo', 'tecnico', 'cidade'] },
      visual: COMUM.visual,
      limite: { inteiro: [1, 200] },
    },
  },
  motivos_improdutividade: {
    descricao: 'Visitas improdutivas ("Não Concluído") feitas num período (de um dia a um mês) e seus MOTIVOS: quais os principais motivos, quais técnicos têm mais improdutivas, por cidade. Conta tentativas, não ordens.',
    parametros: {
      periodo: { periodo: true },
      cidades: COMUM.cidades,
      tecnico: COMUM.tecnico,
      motivo: { texto: 60 },
      agrupar: { enum: ['motivo', 'tecnico', 'cidade', 'dia'] },
      visual: COMUM.visual,
      comparar: { enum: ['nenhum', 'periodo_anterior'] },
      limite: { inteiro: [1, 50] },
    },
  },
  relatorio_existente: {
    descricao: 'Abre um relatório que já existe nas telas (use quando nenhuma ferramenta acima serve). Ids: ' + Object.keys(RELATORIOS).map(k => `${k} = ${RELATORIOS[k]}`).join('; ') + '.',
    parametros: {
      id: { enum: Object.keys(RELATORIOS) },
      data: { data: true },
      periodo: { periodo: true },
      cidades: COMUM.cidades,
      tecnico: COMUM.tecnico,
    },
  },
};

const MAX_TEXTO = 60;
function limparTexto(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>`{}$\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO); }
const ehISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00').getTime());

// valida UM parâmetro contra a especificação; devolve { ok, valor } (valor limpo) ou { ok:false }
function validarParametro(spec, v) {
  if (spec.enum) return spec.enum.includes(v) ? { ok: true, valor: v } : { ok: false };
  if (spec.lista) { if (!Array.isArray(v)) return { ok: false }; const l = [...new Set(v)].filter(x => spec.lista.includes(x)).slice(0, 10); return { ok: true, valor: l }; }
  if (spec.texto) { const t = limparTexto(v); return t ? { ok: true, valor: t } : { ok: false }; }
  if (spec.data) { const t = String(v || ''); return t === 'hoje' || t === 'ontem' || ehISO(t) ? { ok: true, valor: t } : { ok: false }; }
  if (spec.inteiro) { const n = Math.round(Number(v)); return isFinite(n) && n >= spec.inteiro[0] && n <= spec.inteiro[1] ? { ok: true, valor: n } : { ok: false }; }
  if (spec.periodo) {
    if (!v || typeof v !== 'object') return { ok: false };
    const ref = v.ref;
    if (!REFS_PERIODO.includes(ref)) return { ok: false };
    const o = { ref };
    if (ref === 'ultimos_n_dias') { const n = Math.round(Number(v.n)); if (!(n >= 1 && n <= 90)) return { ok: false }; o.n = n; }
    if (ref === 'intervalo') { if (!ehISO(String(v.inicio)) || !ehISO(String(v.fim)) || String(v.inicio) > String(v.fim)) return { ok: false }; o.inicio = String(v.inicio); o.fim = String(v.fim); }
    return { ok: true, valor: o };
  }
  return { ok: false };
}

// valida o PLANO inteiro vindo do modelo (ou do histórico enviado pelo navegador). Devolve o plano limpo ou { erro }.
function validarPlano(p) {
  if (!p || typeof p !== 'object') return { erro: 'plano_invalido' };
  const acao = p.acao;
  if (acao === 'fora_do_escopo') return { plano: { acao, motivo: limparTexto(p.motivo) } };
  if (acao === 'responder') {   // conversa: explicação, saudação, dúvida geral. É só TEXTO (o navegador escapa antes de mostrar); nunca executa nada
    const texto = Array.from(String(p.texto == null ? '' : p.texto)).filter(ch => ch === '\n' || ch.charCodeAt(0) >= 32).join('').replace(/[<>`]/g, ' ').replace(/ {3,}/g, '  ').trim().slice(0, 1500);
    if (!texto) return { erro: 'texto_vazio' };
    return { plano: { acao, texto } };
  }
  if (acao === 'perguntar') {
    const pergunta = String(p.pergunta == null ? '' : p.pergunta).replace(/[\u0000-\u001f<>`]/g, ' ').trim().slice(0, 200);
    if (!pergunta) return { erro: 'pergunta_vazia' };
    const opcoes = (Array.isArray(p.opcoes) ? p.opcoes : []).map(o => String(o == null ? '' : o).replace(/[\u0000-\u001f<>`]/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 6);
    return { plano: { acao, pergunta, opcoes } };
  }
  if (acao !== 'ferramenta') return { erro: 'acao_invalida' };
  const def = FERRAMENTAS[p.ferramenta];
  if (!def) return { erro: 'ferramenta_desconhecida' };
  const entrada = p.parametros && typeof p.parametros === 'object' ? p.parametros : {};
  const parametros = {};
  for (const k of Object.keys(entrada)) {
    const spec = def.parametros[k];
    if (!spec) continue;   // parâmetro que não existe é ignorado, nunca repassado
    const r = validarParametro(spec, entrada[k]);
    if (r.ok) parametros[k] = r.valor;
  }
  return { plano: { acao, ferramenta: p.ferramenta, parametros } };
}

module.exports = { FERRAMENTAS, RELATORIOS, CIDADES, SITUACOES, REFS_PERIODO, validarPlano, validarParametro, limparTexto, ehISO };
