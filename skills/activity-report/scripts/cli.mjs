import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { plan, github, collect, summarize } from './core.mjs';
import { render, verify } from './render.mjs';
import { send, slackClient } from './send.mjs';

const strings = ['config', 'repos', 'scope', 'period', 'start', 'end', 'timezone', 'format', 'workspace', 'channel', 'out', 'fixture', 'highlights', 'confirm-report', 'confirm-channel'];
const options = Object.fromEntries(strings.map(k => [k, { type: 'string' }]));
options.send = { type: 'boolean' }; options['approve-private'] = { type: 'boolean' };
try {
  const { values: args, positionals } = parseArgs({ options, allowPositionals: true });
  const [command] = positionals;
  if (positionals.length !== 1 || !['prepare', 'deliver'].includes(command) || !args.out) throw new Error('prepare|deliver --out <新規フォルダ> を指定してください');
  const out = resolve(args.out);
  if (command === 'prepare') {
    if (args.send) throw new Error('prepareでは送信しません。別途deliverで確認してください');
    const fixture = args.fixture ? JSON.parse(await readFile(args.fixture, 'utf8')) : null;
    const config = args.config ? JSON.parse(await readFile(args.config, 'utf8')) : {};
    const p = plan(config, args);
    const data = fixture ? { ...fixture, plan: p, synthetic: true } : await collect(p, github(process.env.GITHUB_TOKEN));
    if (fixture && fixture.events.some(e => !p.repos.includes(e.repo))) throw new Error('fixtureと対象repoが不一致です');
    const highlights = args.highlights ? JSON.parse(await readFile(args.highlights, 'utf8')) : undefined;
    const manifest = await render(summarize(data, highlights), out);
    console.log(JSON.stringify({ dryRun: true, id: manifest.id, workspace: p.workspace, channel: p.channel, out }));
  } else {
    // dry-runではSlackクライアントもトークンも使わない。
    const allowed = ['out', 'send', 'confirm-report', 'confirm-channel', 'approve-private'];
    if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('deliverの対象・宛先は固定です。変更はprepareで再生成してください');
    await verify(out);
    if (args.send && !process.env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKENが必要です');
    const ledger = resolve(process.env.ACTIVITY_REPORT_STATE_DIR ?? `${homedir()}/.local/state/activity-report`);
    console.log(JSON.stringify(await send(out, args, ledger, args.send ? slackClient(process.env.SLACK_BOT_TOKEN) : null)));
  }
} catch (error) {
  // SDK応答本文やトークンを出力しない。
  console.error(error.message?.startsWith('GitHub') ? error.message : `処理停止: ${error.message}`);
  process.exitCode = 1;
}
