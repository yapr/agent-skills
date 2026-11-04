import { mkdir, open, writeFile, readFile } from 'node:fs/promises';
import { WebClient, LogLevel } from '@slack/web-api';
import { hash, json } from './core.mjs';
import { verify } from './render.mjs';

export const slackClient = (token, fetcher) => new WebClient(token, { fetch: fetcher, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 30000, logLevel: LogLevel.ERROR });
export async function send(out, args, ledger, client) {
  const m = await verify(out), p = m.plan;
  if (!args.send) return { dryRun: true, id: m.id, channel: p.channel, workspace: p.workspace };
  if (m.synthetic) throw new Error('架空データは送信できません');
  if (!/^T[A-Z0-9]+$/.test(p.workspace ?? '') || !/^[CG][A-Z0-9]+$/.test(p.channel ?? '')) throw new Error('workspace/channel IDを確定してください');
  if (args['confirm-report'] !== m.id || args['confirm-channel'] !== p.channel) throw new Error('内容IDと送信先を確認してください');
  if (m.privateRepos.length && !args['approve-private']) throw new Error('非公開repoの内容をこの投稿先で共有できるか確認してください');
  const auth = await client.auth.test();
  if (!auth.ok || auth.team_id !== p.workspace) throw new Error('Slack workspaceが一致しません');
  // 再生成や出力先変更でも、同じ範囲・期間・宛先への再送を防ぐ。
  const key = hash(json({ repos: p.repos, start: p.start, end: p.end, workspace: p.workspace, channel: p.channel }));
  await mkdir(ledger, { recursive: true, mode: 0o700 });
  const path = `${ledger}/${key}.json`;
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('送信済み・送信中・結果不明の記録があります。Slack側を確認し、自動再送しないでください'); throw error; }
  try { await lock.writeFile(json({ status: 'pending', report: m.id, channel: p.channel })); }
  finally { await lock.close(); }
  try {
    const text = `${await readFile(`${out}/report.txt`, 'utf8')}\n報告ID: ${m.id}`;
    const response = p.format === 'text'
      ? await client.chat.postMessage({ channel: p.channel, text, mrkdwn: false, unfurl_links: false, unfurl_media: false })
      : await client.filesUploadV2({ channel_id: p.channel, initial_comment: text,
        file: await readFile(`${out}/report.png`), filename: `activity-${m.id.slice(0, 12)}.png`, title: `作業報告 ${p.startDate}〜${p.endDate}` });
    const completed = response.files?.flatMap(f => f.files ?? [f]) ?? [];
    if (!response.ok || (p.format === 'text' ? !response.ts : !completed.length || completed.some(f => !f.id))) throw new Error('Slack応答を確認できません');
    const receipt = { status: 'sent', report: m.id, channel: p.channel, ts: response.ts ?? null,
      files: completed.map(f => f.id) };
    await writeFile(path, json(receipt), { mode: 0o600 });
    return receipt;
  } catch {
    // 部分アップロード・タイムアウト・結果保存失敗も結果不明として、自動再送しない。
    await writeFile(path, json({ status: 'uncertain', report: m.id, channel: p.channel }), { mode: 0o600 });
    throw new Error('送信結果が不明です。本文・ファイル・報告IDをSlackで照合し、再送しないでください');
  }
}
