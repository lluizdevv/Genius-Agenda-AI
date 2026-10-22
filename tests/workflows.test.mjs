// Testes automatizados das operações críticas.
// Executam o código REAL dos nós "Code" extraído dos JSON dos workflows
// (nenhuma cópia da lógica): filtro/idempotência do webhook e cálculo/estado dos lembretes.
// Não testam o LLM nem a API do Google (ver docs/CENARIOS_DE_TESTE.md).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(path.join(root, 'workflows', f), 'utf8'));
const wf1 = load('01_Genius_Agenda_Agente_WhatsApp.json');
const wf2 = load('02_Genius_Agenda_Lembretes.json');
const node = (wf, name) => wf.nodes.find((n) => n.name === name);
const code = (wf, name) => node(wf, name).parameters.jsCode;

// Executa o código de um nó Code com o ambiente do n8n simulado.
function run(js, { input = [], sd = {}, now = Date.now(), nodes = {} } = {}) {
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  const $input = { first: () => input[0], all: () => input };
  const $ = (name) => ({ all: () => nodes[name] || [], first: () => (nodes[name] || [])[0] });
  return new Function('$input', '$getWorkflowStaticData', '$', 'Date', js)($input, () => sd, $, FakeDate);
}

// ---------------------------------------------------------------- Webhook / idempotência
describe('Workflow 01 - Filtrar e deduplicar', () => {
  const FILTER = code(wf1, 'Filtrar e deduplicar');
  const OK = '5581999999999@c.us'; // placeholder presente em ALLOWED
  const msg = ({ from = OK, fromMe = false, body = 'Oi', id = 'm1', event = 'message' } = {}) =>
    [{ json: { body: { event, payload: { id, from, fromMe, body } } } }];

  test('deixa passar mensagem válida de número autorizado', () => {
    const out = run(FILTER, { input: msg({ body: 'Marca reunião amanhã 14h' }) });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].json, { chatId: OK, text: 'Marca reunião amanhã 14h', messageId: 'm1' });
  });

  test('ignora mensagens enviadas pelo próprio número (evita loop)', () => {
    assert.equal(run(FILTER, { input: msg({ fromMe: true }) }).length, 0);
  });

  test('ignora grupos', () => {
    assert.equal(run(FILTER, { input: msg({ from: '123@g.us' }) }).length, 0);
  });

  test('ignora número não autorizado (privacidade)', () => {
    assert.equal(run(FILTER, { input: msg({ from: '5599000000000@c.us' }) }).length, 0);
  });

  test('ignora eventos que não são "message"', () => {
    assert.equal(run(FILTER, { input: msg({ event: 'session.status' }) }).length, 0);
  });

  test('ignora mensagem sem texto (mídia)', () => {
    assert.equal(run(FILTER, { input: msg({ body: '   ' }) }).length, 0);
  });

  test('MESMO webhook duas vezes => processa só uma (sem evento duplicado)', () => {
    const sd = {};
    const first = run(FILTER, { input: msg({ id: 'dup-1' }), sd });
    const second = run(FILTER, { input: msg({ id: 'dup-1' }), sd });
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
  });

  test('mensagens diferentes com texto igual são processadas normalmente', () => {
    const sd = {};
    assert.equal(run(FILTER, { input: msg({ id: 'a', body: 'Oi' }), sd }).length, 1);
    assert.equal(run(FILTER, { input: msg({ id: 'b', body: 'Oi' }), sd }).length, 1);
  });

  test('ids antigos (>6h) são limpos do estado', () => {
    const now = Date.now();
    const sd = { seen: { old: now - 7 * 3600 * 1000 } };
    run(FILTER, { input: msg({ id: 'novo' }), sd, now });
    assert.ok(!('old' in sd.seen));
    assert.ok('novo' in sd.seen);
  });
});

// ---------------------------------------------------------------- Lembretes
describe('Workflow 02 - Lembretes', () => {
  const CALC = code(wf2, 'Calcular lembretes devidos');
  const REG = code(wf2, 'Registrar enviados');
  const NOW = Date.parse('2026-10-22T12:00:00-03:00');
  const min = (m) => new Date(NOW + m * 60000).toISOString();
  const ev = (o = {}) => ({ json: { id: 'e1', summary: 'Reunião com Yuri', status: 'confirmed', start: { dateTime: min(15) }, ...o } });
  const calc = (events, sd = {}, now = NOW) => run(CALC, { input: events, sd, now });
  const register = (calcOut, sendResults, sd) =>
    run(REG, { input: sendResults, sd, nodes: { 'Calcular lembretes devidos': calcOut } });

  test('offsets padrão são 24h, 1h e 15min (configurável no código)', () => {
    assert.match(CALC, /OFFSETS\s*=\s*\[1440,\s*60,\s*15\]/);
  });

  test('dispara o lembrete de 15 min quando faltam 15 min', () => {
    const out = calc([ev()]);
    assert.equal(out.length, 1);
    assert.match(out[0].json.text, /15 minutos/);
    assert.match(out[0].json.text, /Reunião com Yuri/);
  });

  test('dispara o lembrete de 1 hora e o de 24 horas nos momentos certos', () => {
    assert.match(calc([ev({ start: { dateTime: min(60) } })])[0].json.text, /1 hora/);
    assert.match(calc([ev({ start: { dateTime: min(1440) } })])[0].json.text, /1 dia/);
  });

  test('não dispara fora da janela de tolerância', () => {
    assert.equal(calc([ev({ start: { dateTime: min(8) } })]).length, 0);
    assert.equal(calc([ev({ start: { dateTime: min(40) } })]).length, 0);
  });

  test('evento criado tarde (já passou o offset) não gera lembretes atrasados', () => {
    assert.equal(calc([ev({ start: { dateTime: min(30) } })]).length, 0);
  });

  test('NÃO duplica: depois de registrado como enviado, não envia de novo', () => {
    const sd = {};
    const out = calc([ev()], sd);
    assert.equal(out.length, 1);
    register(out, [{ json: { ok: true } }], sd);
    assert.equal(calc([ev()], sd).length, 0);
  });

  test('se o envio falhar, NÃO registra e tenta de novo no próximo ciclo', () => {
    const sd = {};
    const out = calc([ev()], sd);
    register(out, [{ json: { error: 'WAHA fora do ar' } }], sd);
    assert.equal(calc([ev()], sd).length, 1);
  });

  test('evento reagendado: lembrete antigo é descartado e o novo horário gera alerta novo', () => {
    const sd = {};
    // evento estava às +15; foi movido para +75 antes do alerta disparar
    assert.equal(calc([ev({ start: { dateTime: min(75) } })], sd).length, 0); // nada no horário antigo
    // 15 min depois, faltam 60 para o novo horário => alerta de 1 hora
    const later = calc([ev({ start: { dateTime: min(75) } })], sd, NOW + 15 * 60000);
    assert.equal(later.length, 1);
    assert.match(later[0].json.text, /1 hora/);
  });

  test('reagendar depois de já ter avisado gera nova chave (novo aviso é permitido)', () => {
    const sd = {};
    const a = calc([ev()], sd);
    register(a, [{ json: {} }], sd);
    const b = calc([ev({ start: { dateTime: min(60) } })], sd); // novo horário
    assert.equal(b.length, 1);
    assert.notEqual(a[0].json.key, b[0].json.key);
  });

  test('evento excluído (ausente da consulta) não gera lembrete', () => {
    assert.equal(calc([]).length, 0);
  });

  test('evento cancelado é ignorado', () => {
    assert.equal(calc([ev({ status: 'cancelled' })]).length, 0);
  });

  test('evento de dia inteiro (sem dateTime) é ignorado', () => {
    assert.equal(calc([{ json: { id: 'd1', summary: 'Feriado', start: { date: '2026-10-23' } } }]).length, 0);
  });

  test('aceita start como string ISO (saída simplificada do nó)', () => {
    assert.equal(calc([{ json: { id: 'e2', summary: 'Call', start: min(15) } }]).length, 1);
  });

  test('classifica o tipo do compromisso', () => {
    const t = (summary) => calc([ev({ summary })])[0].json.text;
    assert.match(t('Entrevista com RH'), /Entrevista/);
    assert.match(t('Voo para Lisboa'), /Viagem/);
    assert.match(t('Aula de inglês'), /Estudo/);
    assert.match(t('Reunião com fornecedor'), /Reunião/);
    assert.match(t('Dentista'), /Compromisso/);
  });

  test('horário é formatado no fuso America/Recife', () => {
    const out = calc([ev({ start: { dateTime: '2026-10-22T12:15:00-03:00' } })]);
    assert.match(out[0].json.text, /12:15/);
  });

  test('chaves enviadas com mais de 3 dias são limpas do estado', () => {
    const sd = { sent: { velha: NOW - 4 * 24 * 3600 * 1000 } };
    calc([], sd);
    assert.ok(!('velha' in sd.sent));
  });
});

// ---------------------------------------------------------------- Estrutura / confiabilidade
describe('Estrutura dos workflows', () => {
  for (const [label, wf] of [['01', wf1], ['02', wf2]]) {
    test(`workflow ${label}: nomes de nós únicos e conexões válidas`, () => {
      const names = wf.nodes.map((n) => n.name);
      assert.equal(new Set(names).size, names.length);
      for (const [from, types] of Object.entries(wf.connections)) {
        assert.ok(names.includes(from), `origem inexistente: ${from}`);
        for (const outs of Object.values(types))
          for (const branch of outs) for (const c of branch) assert.ok(names.includes(c.node), `destino inexistente: ${c.node}`);
      }
    });
    test(`workflow ${label}: fuso America/Recife configurado`, () => {
      assert.equal(wf.settings.timezone, 'America/Recife');
    });
  }

  test('falha do agente segue para o aviso de falha (não afirma sucesso)', () => {
    const errBranch = wf1.connections['Genius Agenda AI'].main[1];
    assert.equal(errBranch[0].node, 'Enviar aviso de falha');
    assert.equal(node(wf1, 'Genius Agenda AI').onError, 'continueErrorOutput');
  });

  test('o agente possui as 4 ferramentas de calendário ligadas', () => {
    const tools = Object.entries(wf1.connections).filter(([, t]) => t.ai_tool).map(([n]) => n).sort();
    assert.deepEqual(tools, ['Atualizar evento', 'Consultar eventos', 'Criar evento', 'Excluir evento']);
  });

  test('chamadas HTTP ao WAHA têm retentativas controladas', () => {
    const http = [...wf1.nodes, ...wf2.nodes].filter((n) => n.type === 'n8n-nodes-base.httpRequest');
    assert.ok(http.length >= 3);
    for (const n of http) {
      assert.equal(n.retryOnFail, true, n.name);
      assert.ok(n.maxTries >= 2, n.name);
    }
  });

  test('falha no envio do lembrete não derruba o fluxo (permite nova tentativa)', () => {
    assert.equal(node(wf2, 'Enviar lembrete WhatsApp').onError, 'continueRegularOutput');
  });

  test('prompt do agente contém as regras críticas', () => {
    const p = node(wf1, 'Genius Agenda AI').parameters.options.systemMessage;
    for (const frag of ['Nunca simule', 'NÃO foi concluído', 'PERGUNTE', 'confirmação explícita', 'mais de um candidato', 'conflito', 'America/Recife'])
      assert.ok(p.includes(frag), `faltando no prompt: ${frag}`);
  });
});

// ---------------------------------------------------------------- Segurança
describe('Segurança: nenhum segredo no repositório', () => {
  const PATTERNS = [/AIza[0-9A-Za-z_-]{30,}/, /GOCSPX-[0-9A-Za-z_-]+/, /sk-[A-Za-z0-9_-]{20,}/, /-----BEGIN (RSA )?PRIVATE KEY-----/, /Bearer\s+[A-Za-z0-9._-]{25,}/];
  const walk = (d) => readdirSync(d).flatMap((f) => {
    if (['node_modules', '.git', 'tests'].includes(f)) return [];
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

  test('arquivos versionados não contêm chaves/tokens', () => {
    for (const f of walk(root).filter((p) => /\.(json|md|yml|yaml|example|svg)$/.test(p) || p.endsWith('.env.example'))) {
      const txt = readFileSync(f, 'utf8');
      for (const re of PATTERNS) assert.ok(!re.test(txt), `possível segredo em ${path.relative(root, f)}`);
    }
  });

  test('workflows não embutem credenciais', () => {
    for (const wf of [wf1, wf2]) for (const n of wf.nodes) assert.ok(!('credentials' in n), `${n.name} carrega credentials`);
  });

  test('.env real está no .gitignore', () => {
    assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.env$/m);
  });
});
