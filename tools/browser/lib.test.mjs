import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DETAIL_LIMIT, FIX_COMMAND, PROBE_TOOL } from './constants.mjs';
import {
  alertKind,
  applyVerdict,
  brokenMessage,
  buildProbeArgs,
  chromeCandidates,
  countProcesses,
  emptyState,
  findOnPath,
  parseProbe,
  parseRegValue,
  parseTaskCsv,
  staticProblems,
  telegramConfig,
} from './lib.mjs';

describe('probe', () => {
  it('locks the probe to one browser tool, haiku and json output', () => {
    const args = buildProbeArgs('ping');
    assert.equal(args[0], '-p');
    assert.equal(args[1], 'ping');
    assert.ok(args.includes('--restricted'));
    assert.ok(args.includes('--strict-mcp-config'));
    assert.deepEqual(args.filter((item) => item === PROBE_TOOL).length, 2);
    assert.equal(args.at(-1), 'json');
  });

  it('treats an OK answer as a working bridge and anything else as broken', () => {
    assert.deepEqual(parseProbe({ code: 0, stdout: JSON.stringify({ result: 'OK' }), stderr: '' }), {
      ok: true,
      detail: 'extension answered',
    });
    assert.deepEqual(
      parseProbe({ code: 0, stdout: JSON.stringify({ result: 'FAIL  browser\nnot connected' }), stderr: '' }),
      { ok: false, detail: 'FAIL browser not connected' },
    );
  });

  it('reports a crash, a silent exit and a timeout with the reason', () => {
    assert.equal(parseProbe({ code: 1, stdout: '', stderr: 'boom' }).detail, 'claude exited with code 1: boom');
    assert.equal(parseProbe({ code: 0, stdout: JSON.stringify({ result: '' }), stderr: '' }).detail, 'claude gave no answer');
    assert.match(parseProbe({ timedOut: true }).detail, /did not finish in 90 s/);
    const long = parseProbe({ code: 0, stdout: JSON.stringify({ result: `FAIL ${'x'.repeat(500)}` }), stderr: '' });
    assert.equal(long.detail.length, DETAIL_LIMIT);
  });
});

describe('windows command output', () => {
  it('reads the default value of a registry key', () => {
    const output =
      '\r\nHKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\x\r\n    (Default)    REG_SZ    C:\\Users\\a b\\host.json\r\n\r\n';
    assert.equal(parseRegValue(output), 'C:\\Users\\a b\\host.json');
    assert.equal(parseRegValue('ERROR: The system was unable to find the specified registry key or value.'), undefined);
  });

  it('counts processes from tasklist csv and ignores the no-tasks notice', () => {
    const csv = '"chrome.exe","5708","Console","1","464 300 K"\r\n"chrome.exe","16448","Console","1","11 152 K"\r\n';
    assert.equal(countProcesses(csv, 'chrome.exe'), 2);
    assert.equal(countProcesses('INFO: No tasks are running which match the specified criteria.\r\n', 'LogonUI.exe'), 0);
  });

  it('reads task status columns from schtasks csv', () => {
    const csv =
      '"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author"\r\n' +
      '"PC","\\PostHelperBridgeWatch","26.10.2026 11:00:00","Ready","Interactive only","26.10.2026 10:00:00","0","master"\r\n';
    assert.deepEqual(parseTaskCsv(csv), {
      status: 'Ready',
      nextRun: '26.10.2026 11:00:00',
      lastRun: '26.10.2026 10:00:00',
      lastResult: '0',
    });
    assert.equal(parseTaskCsv('ERROR: The system cannot find the file specified.'), undefined);
  });
});

describe('lookups', () => {
  it('lists chrome locations that exist in the environment', () => {
    const candidates = chromeCandidates({ ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\LA' });
    assert.equal(candidates.length, 2);
    assert.match(candidates[0], /^C:\\PF.*chrome\.exe$/);
  });

  it('finds an executable on PATH with the given extensions', () => {
    const exists = (path) => path.endsWith('bin\\claude.cmd') || path.endsWith('bin/claude.cmd');
    const found = findOnPath('claude', ['C:\\nope', 'C:\\bin'].join(process.platform === 'win32' ? ';' : ':'), exists);
    assert.match(found, /claude\.cmd$/);
    assert.equal(findOnPath('claude', 'C:\\nope', () => false), undefined);
  });

  it('names every missing part of the bridge', () => {
    const ok = {
      claude: 'c',
      manifest: 'm',
      manifestExists: true,
      hostPath: 'h',
      hostExists: true,
      extensionExists: true,
      chrome: 'x',
      profile: 'Default',
    };
    assert.deepEqual(staticProblems(ok), []);
    assert.deepEqual(staticProblems({ ...ok, hostExists: false }), ['native host launcher is missing: h']);
    assert.deepEqual(staticProblems({ ...ok, manifest: undefined, extensionExists: false, profile: 'Nope' }), [
      'native host is not registered in Chrome (run claude, then /chrome, and pick install)',
      'Claude in Chrome extension is not installed in profile Nope',
    ]);
  });

  it('takes telegram settings only when both values are present', () => {
    assert.deepEqual(telegramConfig('TELEGRAM_BOT_TOKEN="t"\nTELEGRAM_CHAT_ID=1\n'), { token: 't', chat: '1' });
    assert.equal(telegramConfig('TELEGRAM_BOT_TOKEN=t\n'), undefined);
  });
});

describe('state and alerts', () => {
  const broken = { ok: false, detail: 'Chrome is not running' };
  const fine = { ok: true, detail: 'extension answered' };

  it('alerts on the first failure, repeats after 12 hours and reports recovery once', () => {
    const now = '2026-10-26T10:00:00';
    assert.equal(alertKind(emptyState(), broken, now), 'broken');
    const checkedOnly = applyVerdict(emptyState(), broken, now);
    assert.equal(alertKind(checkedOnly, broken, '2026-10-26T10:05:00'), 'broken');
    const alerted = applyVerdict(emptyState(), broken, now, { alerted: true });
    assert.equal(alertKind(alerted, broken, '2026-10-26T15:00:00'), undefined);
    assert.equal(alertKind(alerted, broken, '2026-10-26T22:00:00'), 'broken');
    assert.equal(alertKind(alerted, fine, '2026-10-26T11:00:00'), 'recovered');
    assert.equal(alertKind(emptyState(), fine, now), undefined);
  });

  it('keeps the start of the current status and clears the alert on recovery', () => {
    const first = applyVerdict(emptyState(), broken, '2026-10-26T10:00:00', { alerted: true });
    assert.equal(first.since, '2026-10-26T10:00:00');
    assert.equal(first.lastAlert, '2026-10-26T10:00:00');
    const second = applyVerdict(first, broken, '2026-10-26T11:00:00');
    assert.equal(second.since, '2026-10-26T10:00:00');
    assert.equal(second.lastCheck, '2026-10-26T11:00:00');
    const recovered = applyVerdict(second, fine, '2026-10-26T12:00:00', { recovered: true });
    assert.equal(recovered.status, 'ok');
    assert.equal(recovered.since, '2026-10-26T12:00:00');
    assert.equal(recovered.lastAlert, null);
  });

  it('tells the owner how to repair in the alert', () => {
    assert.match(brokenMessage('x'), new RegExp(FIX_COMMAND.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  });
});
