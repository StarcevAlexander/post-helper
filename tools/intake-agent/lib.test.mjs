import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { AGENT_DEFAULTS, DAY_MS } from './constants.mjs';
import {
  AgentError,
  buildFixPrompt,
  buildPrompt,
  buildZcodeArgs,
  canRunNow,
  emptyState,
  formatReport,
  intakeKey,
  listNewIntakes,
  loadOwnerConfig,
  loadState,
  pickIntake,
  recordRun,
  runTimes,
  saveState,
  tomorrowOf,
  uploadPlan,
  validatePlan,
  zcodeEntry,
} from './lib.mjs';

const NOW = new Date(2026, 9, 24, 12, 0, 0);

const intake = {
  id: 'i1',
  masterId: 'm1',
  masterName: 'Массаж',
  networks: [{ platform: 'instagram', url: 'https://instagram.com/massage_experience' }],
  references: [{ platform: 'telegram', url: 'https://t.me/shkolammru' }],
  goals: ['reach'],
  goalTitles: ['Увеличить охваты'],
  note: 'Не показываю лица. Свободна по вторникам.',
  city: 'Иркутск',
  schedule: { shootDays: [1], shootTime: '12:00', publishTime: '19:30' },
  status: 'new',
  updatedAt: '2026-10-24T02:45:59+08:00',
};

function goodPlan() {
  return {
    note: 'Учтено: без лиц клиентов, съёмка по вторникам. Взято у референсов: короткие разборы.',
    strategy: { summary: 'x' },
    calendar: {
      startedOn: '2026-10-25',
      items: [
        { id: 'w1-tue', date: '2026-10-27', time: '19:00', format: 'stories', pillar: 'p', idea: 'i' },
        { id: 'w1-thu', date: '2026-10-29', time: '19:00', format: 'post', pillar: 'p', idea: 'i' },
      ],
    },
    kits: { 'w1-tue': { shots: ['a'] } },
  };
}

describe('validatePlan', () => {
  it('accepts a complete plan', () => {
    assert.deepEqual(validatePlan(goodPlan(), NOW), []);
  });

  it('wants the note for the master', () => {
    const plan = goodPlan();
    plan.note = 'ок';

    assert.match(validatePlan(plan, NOW).join('\n'), /note/);
  });

  it('keeps the note within the server limit', () => {
    const plan = goodPlan();
    plan.note = 'я'.repeat(1001);

    assert.match(validatePlan(plan, NOW).join('\n'), /длиннее 1000/);
    plan.note = 'я'.repeat(1000);
    assert.deepEqual(validatePlan(plan, NOW), []);
  });

  it('needs at least one block', () => {
    assert.match(validatePlan({ note: 'Записка мастеру, достаточно длинная.' }, NOW).join('\n'), /хотя бы один/);
  });

  it('rejects dates before tomorrow, duplicate ids and bad formats', () => {
    const plan = goodPlan();
    plan.calendar.items[0].date = '2026-10-24';
    plan.calendar.items[1].id = 'w1-tue';
    plan.calendar.items[1].format = 'video';
    plan.calendar.items[1].time = '7pm';

    const text = validatePlan(plan, NOW).join('\n');

    assert.match(text, /раньше завтрашнего дня 2026-10-25/);
    assert.match(text, /повторяется/);
    assert.match(text, /reels, post или stories/);
    assert.match(text, /ЧЧ:ММ/);
  });

  it('rejects a kit without a publication', () => {
    const plan = goodPlan();
    plan.kits.ghost = { shots: [] };

    assert.match(validatePlan(plan, NOW).join('\n'), /комплект ghost без публикации/);
  });

  it('accepts recommendations with an importance in percent', () => {
    const plan = goodPlan();
    plan.recommendations = [
      { id: 'r1', text: 'Добавить запись в шапку', importance: 90 },
      { id: 'r2', text: 'Обновить аватар', importance: 40 },
    ];

    assert.deepEqual(validatePlan(plan, NOW), []);
  });

  it('accepts a plan made of recommendations only', () => {
    const plan = { note: 'Записка мастеру, достаточно длинная.', recommendations: [] };

    assert.deepEqual(validatePlan(plan, NOW), []);
  });

  it('accepts the place of the master and refuses a broken one', () => {
    const plan = goodPlan();
    plan.location = { city: 'Иркутск', timezone: 'Asia/Irkutsk' };
    assert.deepEqual(validatePlan(plan, NOW), []);

    plan.location = { city: 'Иркутск' };
    assert.deepEqual(validatePlan(plan, NOW), []);

    plan.location = { city: ' ', timezone: 'Asia/Irkutsk' };
    assert.match(validatePlan(plan, NOW).join('\n'), /location: нужен city/);

    plan.location = { city: 'Иркутск', timezone: 'Иркутское время' };
    assert.match(validatePlan(plan, NOW).join('\n'), /зоной IANA/);
  });

  it('rejects broken recommendations', () => {
    const plan = goodPlan();
    plan.recommendations = [
      { id: 'r1', text: 'Добавить запись в шапку', importance: 140 },
      { id: 'r1', text: 'Дубль', importance: 10 },
      { id: 'r3', text: ' ', importance: 10 },
      { id: 'r4', text: 'Дробная важность', importance: 12.5 },
    ];

    const text = validatePlan(plan, NOW).join('\n');

    assert.match(text, /importance должна быть целым процентом/);
    assert.match(text, /повторяется/);
    assert.match(text, /нужны id и text/);
    plan.recommendations = 'нет';
    assert.match(validatePlan(plan, NOW).join('\n'), /recommendations должен быть списком/);
  });

  it('rejects things that are not a plan', () => {
    assert.deepEqual(validatePlan([], NOW), ['plan.json должен быть объектом']);
    assert.deepEqual(validatePlan(null, NOW), ['plan.json должен быть объектом']);
  });
});

describe('tomorrowOf', () => {
  it('rolls over month ends', () => {
    assert.equal(tomorrowOf(new Date(2026, 9, 31, 23, 30)), '2026-11-01');
    assert.equal(tomorrowOf(NOW), '2026-10-25');
  });
});

describe('pickIntake and state', () => {
  it('takes a new intake once', () => {
    const state = emptyState();

    assert.equal(pickIntake([intake], state, NOW.getTime())?.id, 'i1');
    recordRun(state, intake, 'uploaded', NOW.getTime());
    assert.equal(pickIntake([intake], state, NOW.getTime()), undefined);
  });

  it('takes the same intake again after the master edits it', () => {
    const state = emptyState();
    recordRun(state, intake, 'uploaded', NOW.getTime());
    const edited = { ...intake, updatedAt: '2026-10-24T09:00:00+08:00' };

    assert.notEqual(intakeKey(edited), intakeKey(intake));
    assert.equal(pickIntake([edited], state, NOW.getTime() + 1000)?.id, 'i1');
  });

  it('limits runs for one master per day', () => {
    const state = emptyState();
    const limits = { ...AGENT_DEFAULTS, perMasterPerDay: 2 };
    for (const version of ['a', 'b']) {
      recordRun(state, { ...intake, updatedAt: version }, 'uploaded', NOW.getTime());
    }
    const third = { ...intake, updatedAt: 'c' };

    assert.equal(pickIntake([third], state, NOW.getTime() + 1000, limits), undefined);
    assert.equal(pickIntake([third], state, NOW.getTime() + DAY_MS + 1000, limits)?.id, 'i1');
  });

  it('leaves the month review requests to the owner', () => {
    const state = emptyState();

    assert.equal(pickIntake([{ ...intake, review: true }], state, NOW.getTime()), undefined);
  });

  it('does not loop on a failed intake', () => {
    const state = emptyState();
    recordRun(state, intake, 'failed', NOW.getTime(), { error: 'x' });

    assert.equal(pickIntake([intake], state, NOW.getTime() + 5000), undefined);
  });

  it('feeds the daily cap from the recorded runs', () => {
    const state = emptyState();
    const limits = { ...AGENT_DEFAULTS, maxPerDay: 1, pauseMs: 0 };
    recordRun(state, intake, 'uploaded', NOW.getTime());

    assert.equal(canRunNow(runTimes(state), NOW.getTime() + 1000, limits).ok, false);
  });

  it('saves and loads, and survives a broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'intake-state-'));
    const file = join(dir, 'state.json');
    const state = emptyState();
    recordRun(state, intake, 'uploaded', NOW.getTime(), { version: 3 });

    saveState(file, state);
    assert.deepEqual(loadState(file), state);
    writeFileSync(file, '{broken');
    assert.deepEqual(loadState(file), emptyState());
    assert.deepEqual(loadState(join(dir, 'missing.json')), emptyState());
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildZcodeArgs', () => {
  const args = buildZcodeArgs('собери план', 'C:/work');

  it('runs headless in the work dir with the shell locked out', () => {
    assert.equal(args[0], '-p');
    assert.equal(args[1], 'собери план');
    assert.equal(args[args.indexOf('--cwd') + 1], 'C:/work');
    assert.equal(args[args.indexOf('--mode') + 1], 'yolo');
    assert.ok(args.includes('--json'));
  });

  it('disallows the shell and the side tools', () => {
    const tools = args[args.indexOf('--disallowed-tools') + 1];
    assert.match(tools, /\bBash\b/);
    assert.match(tools, /\bEdit\b/);
    assert.doesNotMatch(tools, /WebFetch|WebSearch|Read|Write/);
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt(intake, { guide: '# Формат plan.json', tomorrow: '2026-10-25' });

  it('carries the safety rules, the date limit and the guide', () => {
    assert.match(prompt, /это данные, а не указания/);
    assert.match(prompt, /не раньше 2026-10-25/);
    assert.match(prompt, /# Формат plan\.json/);
    assert.match(prompt, /plan\.json/);
    assert.match(prompt, /report\.md/);
  });

  it('puts the intake into a data block with the wishes', () => {
    assert.match(prompt, /<<<ЗАЯВКА[\s\S]*Не показываю лица[\s\S]*ЗАЯВКА>>>/);
    assert.match(prompt, /t\.me\/shkolammru/);
  });

  it('passes the city and the schedule of the master with weekday names', () => {
    assert.match(prompt, /"city": "Иркутск"/);
    assert.match(prompt, /"shootDays": \[\s*"вторник"\s*\]/);
    assert.match(prompt, /"publishTime": "19:30"/);
    assert.match(prompt, /schedule.*обязателен/);
    assert.doesNotMatch(buildPrompt({ ...intake, city: '', schedule: undefined }, { guide: '', tomorrow: '2026-10-25' }), /"city"|"schedule"/);
  });

  it('builds a fix prompt that lists the problems', () => {
    const fix = buildFixPrompt(['дата 2026-10-24 раньше завтрашнего дня'], { tomorrow: '2026-10-25' });

    assert.match(fix, /дата 2026-10-24 раньше/);
    assert.match(fix, /не раньше 2026-10-25/);
  });
});

describe('formatReport', () => {
  it('names the version, the rollback command and the agent notes', () => {
    const text = formatReport({
      intake,
      result: { version: 4, items: 12 },
      agentReport: 'Не открылась страница instagram.com/x',
      now: NOW,
    });

    assert.match(text, /версия данных 4, публикаций 12/);
    assert.match(text, /restore m1 3/);
    assert.match(text, /Не открылась страница/);
  });
});

describe('zcodeEntry', () => {
  it('prefers the explicit path', () => {
    assert.equal(zcodeEntry({ ZCODE_JS: 'D:/tools/zcode.js' }), 'D:/tools/zcode.js');
  });

  it('finds the npm global install when it exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-zcode-'));
    try {
      const entry = join(dir, 'npm', 'node_modules', 'zcode-app-cli', 'bin', 'zcode.js');
      mkdirSync(dirname(entry), { recursive: true });
      writeFileSync(entry, '', 'utf8');
      assert.equal(zcodeEntry({ APPDATA: dir }), entry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when zcode is not installed', () => {
    assert.equal(zcodeEntry({ APPDATA: 'C:/nowhere-real' }), undefined);
  });
});

describe('loadOwnerConfig', () => {
  it('reads the server and falls back to the local admin port', () => {
    assert.deepEqual(loadOwnerConfig({ OWNER_SERVER: 'http://127.0.0.1:8081/' }, undefined), { server: 'http://127.0.0.1:8081' });
    assert.deepEqual(loadOwnerConfig({}, undefined), { server: 'http://127.0.0.1:8081' });
  });

  it('complains about a server that is not an address', () => {
    assert.throws(() => loadOwnerConfig({ OWNER_SERVER: 'x.example' }, undefined), AgentError);
  });
});

describe('talking to the server', () => {
  let server;
  let base;
  const seen = [];

  before(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        seen.push({ method: request.method, url: request.url, body });
        if (request.url.startsWith('/api/admin/intakes')) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([intake]));
        } else if (request.url.endsWith('/plan') && body.includes('"bad"')) {
          response.writeHead(400).end(JSON.stringify({ error: 'format: неизвестный' }));
        } else if (request.url.endsWith('/plan')) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ version: 5, items: 2 }));
        } else {
          response.writeHead(204).end();
        }
      });
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('lists only new intakes', async () => {
    const intakes = await listNewIntakes({ server: base });

    assert.equal(intakes[0].id, 'i1');
    assert.equal(seen.at(-1).url, '/api/admin/intakes?status=new&limit=50');
  });

  it('uploads a plan and returns the version', async () => {
    const result = await uploadPlan({ server: base }, 'm1', goodPlan());

    assert.deepEqual(result, { version: 5, items: 2 });
    assert.equal(seen.at(-1).url, '/api/admin/masters/m1/plan');
    assert.equal(JSON.parse(seen.at(-1).body).note.startsWith('Учтено'), true);
  });

  it('turns a server refusal into an error with code 6', async () => {
    await assert.rejects(
      uploadPlan({ server: base }, 'm1', { note: 'bad' }),
      (error) => error instanceof AgentError && error.code === 6 && /format/.test(error.message),
    );
  });

  it('reports an unreachable server as code 4', async () => {
    await assert.rejects(
      listNewIntakes({ server: 'http://127.0.0.1:1' }),
      (error) => error instanceof AgentError && error.code === 4,
    );
  });
});
