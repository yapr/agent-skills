import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { plan, collect, github, summarize } from '../scripts/core.mjs';
import { render, textReport, htmlReport, verify, timelineText } from '../scripts/render.mjs';
import { send, slackClient } from '../scripts/send.mjs';
const config = { allowedRepos: ['demo/app', 'demo/tools'], scope: 'all', period: 'weekly', timezone: 'Asia/Tokyo', format: 'text', workspace: 'T123', channel: 'C123' };
const now = Temporal.Instant.from('2026-11-02T00:00:00Z');
const p = () => plan(config, {}, now);
const empty = () => summarize({ plan: p(), events: [], privateRepos: [], synthetic: false, limitations: ['効果は未確認'] });
const temporary = () => mkdtemp(join(tmpdir(), 'activity-test-'));

test('設定・明示指定・許可範囲・前週・3暦月・うるう日', () => {
  assert.deepEqual(p().repos, ['demo/app', 'demo/tools']);
  assert.equal(p().startDate, '2026-10-26'); assert.equal(p().endDate, '2026-11-02');
  const q = plan(config, { period: 'three-months' }, now);
  assert.equal(q.startDate, '2026-08-01'); assert.equal(q.endDate, '2026-11-01');
  const c = plan(config, { repos: 'demo/tools', start: '2024-02-28', end: '2024-03-01', format: 'png' }, now);
  assert.equal(c.period, 'custom'); assert.equal(c.format, 'png'); assert.deepEqual(c.repos, ['demo/tools']);
  assert.throws(() => plan(config, { repos: 'other/private' }, now));
  assert.throws(() => plan(config, { start: '2026-11-01' }, now));
  assert.throws(() => plan(config, { start: '2026-02-30', end: '2026-03-01' }, now));
  assert.throws(() => plan(config, { timezone: 'invalid' }, now));
  assert.throws(() => plan(config, { format: 'unknown' }, now));
});
test('夏時間を含む任意期間は現地日付の境界を使う', () => {
  const d = plan(config, { start: '2026-03-08', end: '2026-03-09', timezone: 'America/New_York' }, now);
  assert.equal((Date.parse(d.end) - Date.parse(d.start)) / 3600000, 23);
});
test('全ページ取得とAPI失敗・外部ページング・循環の停止', async () => {
  let calls = 0;
  const api = github('fake', async () => { calls++; return new Response(JSON.stringify([calls]), { headers: calls === 1 ? { link: '<https://api.github.com/repos/demo/app/issues?page=2>; rel="next"' } : {} }); });
  assert.deepEqual(await api.list('/repos/demo/app/issues'), [1, 2]);
  await assert.rejects(github('', async () => new Response('', { status: 429 })).list('/repos/demo/app/issues'), /HTTP 429/);
  await assert.rejects(github('', async () => new Response('[]', { headers: { link: '<https://evil.invalid/>; rel="next"' } })).list('/repos/demo/app/issues'), /不正/);
  await assert.rejects(github('', async () => new Response('[]', { headers: { link: '<https://api.github.com/repos/demo/app/issues?per_page=100>; rel="next"' } })).list('/repos/demo/app/issues'), /循環/);
});
test('期間内のPR/Issue/Releaseを分類し、終了境界とdraftを除外する', async () => {
  const at = '2026-10-28T00:00:00Z', target = { ...p(), repos: ['demo/app'] };
  const row = { id: 1, number: 1, title: '架空変更', html_url: 'https://github.com/demo/app/pull/1', created_at: target.start, merged_at: at };
  const api = { get: async path => path.endsWith('/pulls/1') ? row : { private: true }, list: async path => path.includes('/issues?') ? [{ ...row, pull_request: {} }, { id: 2, title: '架空Issue', html_url: 'https://github.com/demo/app/issues/2', created_at: target.end }] : [{ id: 3, name: '架空Release', html_url: 'https://github.com/demo/app/releases/v1', published_at: at, draft: true }] };
  const data = await collect(target, api), r = summarize(data);
  assert.deepEqual(data.privateRepos, ['demo/app']); assert.equal(r.counts['pr-opened'], 1); assert.equal(r.counts['pr-merged'], 1);
  assert.equal(r.counts['issue-opened'], 0); assert.equal(r.counts.release, 0);
  assert.equal(r.timeline[0].merged_at, at); assert.equal(r.timeline[0].production_at, null); assert.deepEqual(r.timeline[0].metric_evidence, []);
  assert(timelineText(r).includes('2026-10-28T09:00')); assert(timelineText(r).includes('本番反映日はすべて未確認'));
  await assert.rejects(collect(target, { ...api, get: async () => { throw new Error('failure'); } }));
});
test('要点の根拠必須、HTMLとSlackの特殊文字を無害化', () => {
  const e = { id: 'x', title: '<script>alert(1)</script> <!channel>', kind: 'pr-merged', at: '2026-10-28T00:00:00Z', repo: 'demo/app', url: 'https://github.com/demo/app/pull/1' };
  const r = summarize({ ...empty(), events: [e] });
  assert(!htmlReport(r).includes('<script>')); assert(!textReport(r).includes('<!channel>'));
  assert.throws(() => summarize(r, [{ text: 'claim', refs: ['missing'] }]));
});
test('dry-run、確認・共有範囲ゲート、workspace照合、再生成後も重複防止', async () => {
  const dir = await temporary(), out = join(dir, 'report'), ledger = join(dir, 'ledger');
  const r = { ...empty(), privateRepos: ['demo/app'] }, m = await render(r, out);
  assert.equal((await verify(out)).id, m.id); assert.equal((await send(out, {}, ledger, null)).dryRun, true);
  let calls = 0;
  const client = { auth: { test: async () => ({ ok: true, team_id: 'T123' }) }, chat: { postMessage: async a => { calls++; assert.equal(a.channel, 'C123'); assert.equal(a.mrkdwn, false); return { ok: true, ts: '1' }; } } };
  const args = { send: true, 'confirm-report': m.id, 'confirm-channel': 'C123' };
  await assert.rejects(send(out, { send: true }, ledger, client), /内容ID/);
  await assert.rejects(send(out, args, ledger, client), /非公開/);
  await assert.rejects(send(out, { ...args, 'approve-private': true }, ledger, { auth: { test: async () => ({ ok: true, team_id: 'T999' }) } }), /workspace/);
  assert.equal((await send(out, { ...args, 'approve-private': true }, ledger, client)).status, 'sent');
  const out2 = join(dir, 'report2'), m2 = await render(r, out2);
  await assert.rejects(send(out2, { ...args, 'confirm-report': m2.id, 'approve-private': true }, ledger, client), /送信済み/);
  assert.equal(calls, 1); await writeFile(join(out, 'report.txt'), 'modified'); await assert.rejects(verify(out), /変更/);
});
test('途中失敗・結果不明を記録し、自動再送しない', async () => {
  const dir = await temporary(), out = join(dir, 'report'), ledger = join(dir, 'ledger');
  const m = await render(empty(), out), args = { send: true, 'confirm-report': m.id, 'confirm-channel': 'C123' };
  let calls = 0;
  const client = { auth: { test: async () => ({ ok: true, team_id: 'T123' }) }, chat: { postMessage: async () => { calls++; throw new Error('timeout after send'); } } };
  await assert.rejects(send(out, args, ledger, client), /不明/); await assert.rejects(send(out, args, ledger, client), /送信済み/);
  assert.equal(calls, 1); assert.equal(JSON.parse(await readFile(join(ledger, (await readdir(ledger))[0]), 'utf8')).status, 'uncertain');
});
test('PNG実生成と本文・画像の紐付けモック、架空データ送信禁止', async () => {
  const dir = await temporary(), out = join(dir, 'png');
  const fixture = JSON.parse(await readFile(new URL('./example.json', import.meta.url), 'utf8'));
  const cfg = { ...config, allowedRepos: ['example-org/example-app', 'example-org/example-tools'], format: 'both' };
  const r = summarize({ ...fixture, plan: plan(cfg, {}, now), synthetic: true });
  await render(r, out);
  const image = await readFile(join(out, 'report.png')); assert.equal(image.subarray(1, 4).toString(), 'PNG');
  await assert.rejects(send(out, { send: true }, join(dir, 'ledger'), null), /架空/);
  const out2 = join(dir, 'mock'), m = await render({ ...r, synthetic: false }, out2);
  const client = { auth: { test: async () => ({ ok: true, team_id: 'T123' }) }, filesUploadV2: async a => {
    assert.equal(a.channel_id, 'C123'); assert(a.initial_comment.includes(m.id)); assert(Buffer.isBuffer(a.file));
    assert(a.initial_comment.includes('https://example.invalid/')); return { ok: true, files: [{ ok: true, files: [{ id: 'F1' }] }] };
  } };
  assert.equal((await send(out2, { send: true, 'confirm-report': m.id, 'confirm-channel': 'C123' }, join(dir, 'ledger'), client)).files[0], 'F1');
  console.log(`PNG preview: ${out}`);
});

 test('公式SDKのV2アップロードをHTTPモックで通し、429を再送しない', async () => {
  const urls = [];
  const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const client = slackClient('fake-test-token', async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith('files.getUploadURLExternal')) return response({ ok: true, file_id: 'F2', upload_url: 'https://files.slack.com/upload/mock' });
    if (String(url) === 'https://files.slack.com/upload/mock') return new Response('OK');
    if (String(url).endsWith('files.completeUploadExternal')) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('channel_id'), 'C123'); assert.equal(form.get('initial_comment'), '架空報告');
      return response({ ok: true, files: [{ id: 'F2' }] });
    }
    throw new Error('unexpected mock URL');
  });
  const result = await client.filesUploadV2({ file: Buffer.from('fake-image'), filename: 'mock.png', channel_id: 'C123', initial_comment: '架空報告' });
  assert.equal(result.files[0].files[0].id, 'F2'); assert.equal(urls.length, 3);
  let attempts = 0;
  const limited = slackClient('fake-test-token', async () => { attempts++; return new Response('', { status: 429, headers: { 'retry-after': '1' } }); });
  await assert.rejects(limited.chat.postMessage({ channel: 'C123', text: 'mock' })); assert.equal(attempts, 1);
});
