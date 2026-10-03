/* =====================================================================
 * JH TELECOM · Nexus System — COLETOR DO MONITORAMENTO OLT (03/10/2026)
 *
 * Roda DENTRO do AutoISP da Alloha (auto.alloha.com), com o login de quem
 * clicou no favorito "📡 Coletar OLTs (JH)". A JH é terceirizada da Alloha e
 * só LÊ: lista de OLTs das cidades da JH Litoral e as ONUs com sinal ruim.
 *   • não clica em nada, não altera nada, não provisiona nada;
 *   • usa só GET nas mesmas listas que as telas do AutoISP já usam
 *     (/olts/olts_list e /provisioned_onus_datatable.json);
 *   • NÃO lê senha nenhuma (PPPoE / Wi-Fi ficam no AutoISP);
 *   • manda o resultado pra janela do sistema JH por postMessage (só pra
 *     origem de onde este arquivo foi carregado) — ou baixa um arquivo .json
 *     pra importar na aba "Monitoramento OLT", se a janela não abrir.
 * Para não pesar no AutoISP: no máximo 3 consultas ao mesmo tempo.
 * ===================================================================== */
(function () {
  'use strict';
  // origem do sistema JH = de onde este script veio (o favorito monta a URL)
  var ORIGEM_JH = (function () {
    try { return new URL(document.currentScript.src).origin; } catch (e) { return 'https://jh-telecom-pi.vercel.app'; }
  })();
  if (location.hostname !== 'auto.alloha.com') {
    alert('Abra o AutoISP (auto.alloha.com), entre com o seu login e clique de novo no favorito.');
    return;
  }
  if (window.__jhColetando) return;
  window.__jhColetando = true;

  var CIDADES = ['Guaruja', 'Santos', 'Sao Vicente', 'Bertioga', 'Cubatao', 'Praia Grande'];
  // situações do sinal que interessam pra preventiva (valores do filtro do AutoISP)
  var SITUACOES = ['critical', 'warning', 'loss_signal', 'power_fail', 'massive_loss_signal', 'massive_power_fail'];
  var COLUNAS = ['signal', 'signal', 'serial_number', 'circuit_id', 'int6_id', 'name', 'description', 'olt', 'ponlink', 'onu_id', 'onu_type', 'onu_info_model', 'topology'];
  var POR_PAGINA = 100;
  var PARALELO = 3;

  // ---------- painel de andamento (canto da tela do AutoISP) ----------
  var caixa = document.createElement('div');
  caixa.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;background:#0f172a;color:#e2e8f0;' +
    'font:13px/1.45 Segoe UI,Arial,sans-serif;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:14px 16px;border-left:4px solid #2563eb';
  caixa.innerHTML = '<div style="font-weight:700;font-size:14px;margin-bottom:6px">📡 JH — Monitoramento OLT</div>' +
    '<div id="jh-col-msg">Preparando…</div><div id="jh-col-barra" style="height:6px;background:#1e293b;border-radius:4px;margin:10px 0 4px">' +
    '<div style="height:6px;width:0;background:#2563eb;border-radius:4px;transition:width .2s"></div></div><div id="jh-col-acoes" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"></div>';
  document.body.appendChild(caixa);
  var elMsg = caixa.querySelector('#jh-col-msg');
  var elBarra = caixa.querySelector('#jh-col-barra > div');
  var elAcoes = caixa.querySelector('#jh-col-acoes');
  function msg(t) { elMsg.textContent = t; }
  function barra(p) { elBarra.style.width = Math.max(0, Math.min(100, p)) + '%'; }
  function botao(rotulo, fn, principal) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = rotulo;
    b.style.cssText = 'border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font:600 12px Segoe UI,Arial;' +
      (principal ? 'background:#2563eb;color:#fff' : 'background:#334155;color:#e2e8f0');
    b.onclick = fn; elAcoes.appendChild(b); return b;
  }
  function fechar() { caixa.remove(); window.__jhColetando = false; window.removeEventListener('message', aoReceber); }

  // ---------- conversa com a janela do sistema JH ----------
  var janela = window.__jhJanela || null;       // aberta pelo favorito, no clique (senão o navegador bloqueia)
  var jhPronto = false, dados = null, enviado = false;
  function enviar() {
    if (enviado || !dados || !janela || janela.closed || !jhPronto) return;
    try { janela.postMessage(dados, ORIGEM_JH); } catch (e) { return; }
  }
  function aoReceber(ev) {
    if (ev.origin !== ORIGEM_JH || !ev.data || typeof ev.data !== 'object') return;
    if (ev.data.tipo === 'jh-monitor-olt-pronto') { jhPronto = true; enviar(); }
    if (ev.data.tipo === 'jh-monitor-olt-recebido') {
      enviado = true;
      msg(ev.data.ok ? '✔ Enviado pro sistema JH (' + (ev.data.qtd || 0) + ' ONUs com problema). Pode fechar.' : '⚠ O sistema JH recusou: ' + (ev.data.erro || 'erro'));
      elAcoes.innerHTML = ''; botao('Fechar', fechar, true);
    }
  }
  window.addEventListener('message', aoReceber);

  // ---------- leitura ----------
  function pegar(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) {
        if (r.status === 401 || (r.redirected && /sign_in/.test(r.url))) throw new Error('Sessão do AutoISP expirada — entre de novo e clique no favorito.');
        if (!r.ok) throw new Error('AutoISP respondeu ' + r.status + ' em ' + url.split('?')[0]);
        return r.json();
      });
  }
  function urlOnus(oltId, situacao, inicio) {
    var p = new URLSearchParams();
    p.set('draw', '1');
    COLUNAS.forEach(function (c, i) {
      p.set('columns[' + i + '][data]', c); p.set('columns[' + i + '][name]', '');
      p.set('columns[' + i + '][searchable]', i === 0 ? 'false' : 'true');
      p.set('columns[' + i + '][orderable]', i <= 1 ? 'false' : 'true');
      p.set('columns[' + i + '][search][value]', i === 1 ? situacao : (i === 7 ? String(oltId) : ''));
      p.set('columns[' + i + '][search][regex]', 'false');
    });
    p.set('order[0][column]', '3'); p.set('order[0][dir]', 'asc');
    p.set('start', String(inicio)); p.set('length', String(POR_PAGINA));
    p.set('search[value]', ''); p.set('search[regex]', 'false');
    return '/provisioned_onus_datatable.json?' + p.toString();
  }
  function kind(o) { return o && typeof o === 'object' ? String(o.kind || o.status || '') : String(o || ''); }
  function dica(o) { return o && typeof o === 'object' ? String(o.tooltip || '') : ''; }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function link(v) { return typeof v === 'string' && v.indexOf('https://auto.alloha.com/') === 0 ? v : ''; }
  // fila com limite de consultas simultâneas
  function emFila(tarefas, limite, aoAndar) {
    var i = 0, feitas = 0, resultados = new Array(tarefas.length);
    return new Promise(function (ok) {
      if (!tarefas.length) { ok(resultados); return; }
      function proxima() {
        if (i >= tarefas.length) return;
        var k = i++;
        tarefas[k]().then(function (r) { resultados[k] = r; }, function (e) { resultados[k] = { erro: String(e && e.message || e) }; })
          .then(function () { feitas++; aoAndar(feitas, tarefas.length); if (feitas === tarefas.length) ok(resultados); else proxima(); });
      }
      for (var n = 0; n < limite; n++) proxima();
    });
  }

  async function coletar() {
    msg('Lendo a lista de OLTs das cidades da JH…');
    var base = '/olts/olts_list?olt_city=' + encodeURIComponent(CIDADES.join(',')) + '&sort_field=hostname&sort_order=asc&hide_deactivated=false&items=100&page=';
    var lista = [], pagina = 1, total = Infinity;
    while (lista.length < total && pagina <= 20) {
      var j = await pegar(base + pagina);
      total = j.total_count || 0;
      (j.olts || []).forEach(function (o) { lista.push(o); });
      if (!j.olts || !j.olts.length) break;
      pagina++;
    }
    var olts = lista.map(function (o) {
      return {
        id: o.id, hostname: o.hostname || '', modelo: o.model || '', modo: o.operation_mode || '',
        conexao: kind(o.connection_status), conexao_info: dica(o.connection_status),
        auditoria: kind(o.audit_status), monitoramento: kind(o.zabbix_status),
        ip: o.ip || '', clientes: o.sum_onus || 0, onus_lidas: o.sum_onus_olt || 0,
        cidades: String(o.locations_text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        ultima_config: o.running_cfg_last_changed || '',
      };
    });
    // DEACTIV (desativada) não conta — pedido do cliente
    var ativas = olts.filter(function (o) { return !/deactiv/i.test(o.modo); });
    msg(ativas.length + ' OLTs ativas. Lendo as ONUs com sinal ruim…');
    var onus = [], erros = [], vistos = {};
    // 1ª página de cada OLT × situação; as páginas extras entram numa 2ª rodada
    var tarefas = [];
    ativas.forEach(function (o) { SITUACOES.forEach(function (s) { tarefas.push({ olt: o, sit: s, inicio: 0 }); }); });
    async function rodar(lista, rotulo) {
      var res = await emFila(lista.map(function (t) { return function () { return pegar(urlOnus(t.olt.id, t.sit, t.inicio)); }; }), PARALELO,
        function (f, n) { barra(f / n * 100); msg(rotulo + ' ' + f + ' de ' + n + '…'); });
      var extras = [];
      res.forEach(function (r, k) {
        var t = lista[k];
        if (!r || r.erro) { erros.push((t.olt.hostname || t.olt.id) + ' / ' + t.sit + ': ' + (r && r.erro || 'sem resposta')); return; }
        (r.data || []).forEach(function (x) {
          var sinal = Array.isArray(x.signal) ? x.signal : [null, null];
          var sn = Array.isArray(x.serial_number) ? x.serial_number : [];
          var chave = (sn[0] || '') + '|' + t.olt.id + '|' + x.ponlink + '|' + x.onu_id;
          if (vistos[chave]) return; vistos[chave] = true;
          onus.push({
            olt_id: t.olt.id, olt: (Array.isArray(x.olt) ? x.olt[0] : '') || t.olt.hostname, ponlink: x.ponlink || '', onu_id: x.onu_id,
            situacao: sinal[1] || t.sit, sinal: num(sinal[0]),
            serial: sn[0] || '', serial_curto: sn[1] || '', link: link(sn[2]),
            contrato: Array.isArray(x.circuit_id) ? x.circuit_id[0] : null, int6: Array.isArray(x.int6_id) ? x.int6_id[0] : null,
            nome: x.name || '', descricao: x.description || '', modelo: x.onu_info_model || x.onu_type || '', topologia: x.topology || '',
          });
        });
        if (t.inicio === 0) {
          var tot = r.recordsFiltered || 0;
          for (var ini = POR_PAGINA; ini < tot && ini < 5000; ini += POR_PAGINA) extras.push({ olt: t.olt, sit: t.sit, inicio: ini });
        }
      });
      return extras;
    }
    var extras = await rodar(tarefas, 'Consultando');
    if (extras.length) await rodar(extras, 'Páginas extras');
    barra(100);
    return {
      tipo: 'jh-monitor-olt', versao: 1, origem: 'auto.alloha.com', coletado_em: new Date().toISOString(),
      cidades: CIDADES, olts: olts, onus: onus, erros: erros,
    };
  }

  function baixarArquivo() {
    var blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'monitor-olt-' + dados.coletado_em.slice(0, 16).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  coletar().then(function (d) {
    dados = d;
    var falhas = d.olts.filter(function (o) { return !/deactiv/i.test(o.modo) && /fail|never|busy|warning/i.test(o.conexao); }).length;
    msg('✔ ' + d.olts.length + ' OLTs (' + falhas + ' com falha) e ' + d.onus.length + ' ONUs com problema' +
      (d.erros.length ? ' · ' + d.erros.length + ' consulta(s) falharam' : '') + '. Enviando pro sistema JH…');
    elAcoes.innerHTML = '';
    botao('Abrir o sistema JH e enviar', function () {
      if (!janela || janela.closed) janela = window.open(ORIGEM_JH + '/?monitor-olt=1', 'jh_monitor_olt');
      enviar();
    }, true);
    botao('⬇ Baixar arquivo', baixarArquivo);
    botao('Fechar', fechar);
    enviar();
    if (!janela) msg(elMsg.textContent.replace('Enviando pro sistema JH…', 'O navegador bloqueou a janela: clique em "Abrir o sistema JH e enviar".'));
  }).catch(function (e) {
    msg('⚠ ' + (e && e.message || e));
    elAcoes.innerHTML = ''; botao('Fechar', fechar, true);
  });
})();
