import { Temporal } from '@js-temporal/polyfill';
import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw new Error(message); };
export function plan(config, args = {}, now = Temporal.Now.instant()) {
  const c = { ...config, ...args };
  const allowed = config.allowedRepos?.map(r => r.toLowerCase());
  if (!allowed?.length || allowed.some(r => !/^[\w.-]+\/[\w.-]+$/.test(r))) fail('allowedReposを設定してください');
  const repos = c.repos ? c.repos.split(',').map(r => r.trim().toLowerCase()) : c.scope === 'all' ? allowed : c.scope?.split(',').map(r => r.trim().toLowerCase());
  if (!repos?.length || repos.some(r => !allowed.includes(r))) fail('対象repoが未指定または許可範囲外です');
  if (!c.timezone) fail('timezoneを指定してください');
  const today = now.toZonedDateTimeISO(c.timezone).toPlainDate();
  let start, end;
  const period = args.start || args.end ? 'custom' : c.period;
  if (period === 'weekly') {
    end = today.subtract({ days: today.dayOfWeek - 1 });
    start = end.subtract({ weeks: 1 });
  } else if (period === 'three-months') {
    end = today.with({ day: 1 });
    start = end.subtract({ months: 3 });
  } else if (period === 'custom' && c.start && c.end) {
    if (![c.start, c.end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) fail('日付はYYYY-MM-DDです');
    start = Temporal.PlainDate.from(c.start); end = Temporal.PlainDate.from(c.end);
  } else fail('periodまたは開始・終了日を指定してください');
  if (Temporal.PlainDate.compare(start, end) >= 0) fail('終了日は開始日より後にしてください');
  const format = c.format ?? 'both';
  if (!['both', 'text', 'png'].includes(format)) fail('formatはboth/text/pngです');
  return { repos: [...new Set(repos)].sort(), timezone: c.timezone, period, format,
    startDate: String(start), endDate: String(end),
    start: start.toZonedDateTime(c.timezone).toInstant().toString(),
    end: end.toZonedDateTime(c.timezone).toInstant().toString(),
    workspace: c.workspace ?? null, channel: c.channel ?? null };
}

// ページング先が別originなら認証情報を送らない。
export function github(token, fetcher = fetch) {
  async function request(url) {
    const u = new URL(url, 'https://api.github.com');
    if (u.origin !== 'https://api.github.com') fail('GitHubページング先が不正です');
    const response = await fetcher(u, { redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) fail(`GitHub取得失敗 HTTP ${response.status}。権限・rate limitを確認し、送信せず再集計してください`);
    return response;
  }
  return {
    get: async path => (await request(path)).json(),
    async list(path) {
      let url = new URL(path, 'https://api.github.com'); url.searchParams.set('per_page', '100');
      const rows = [], seen = new Set();
      for (let page = 0; url && page < 100; page++) {
        if (seen.has(String(url))) fail('ページングが循環しています');
        seen.add(String(url));
        const response = await request(url), data = await response.json();
        if (!Array.isArray(data)) fail('GitHub一覧の形式が不正です');
        rows.push(...data);
        url = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
      }
      if (url) fail('ページ上限に達しました。未完全集計は送信しません');
      return rows;
    }
  };
}

export async function collect(p, api) {
  const events = [], privateRepos = [];
  const inside = d => d && Date.parse(d) >= Date.parse(p.start) && Date.parse(d) < Date.parse(p.end);
  function add(repo, kind, row, at) {
    if (!inside(at)) return;
    const url = new URL(row.html_url);
    if (url.origin !== 'https://github.com' || !url.pathname.toLowerCase().startsWith(`/${repo}/`)) fail('出典URLが対象repoと一致しません');
    events.push({ id: `${repo}:${kind}:${row.id}`, repo, kind, at, title: row.title ?? row.name ?? row.tag_name, url: url.href });
  }
  for (const repo of p.repos) {
    const meta = await api.get(`/repos/${repo}`);
    if (typeof meta.private !== 'boolean') fail('公開範囲を確認できません');
    if (meta.private) privateRepos.push(repo);
    const rows = await api.list(`/repos/${repo}/issues?state=all&since=${encodeURIComponent(p.start)}&sort=updated&direction=desc`);
    for (const row of rows) {
      if (row.pull_request) {
        const pr = await api.get(`/repos/${repo}/pulls/${row.number}`);
        add(repo, 'pr-opened', pr, pr.created_at); add(repo, 'pr-merged', pr, pr.merged_at);
      } else {
        add(repo, 'issue-opened', row, row.created_at); add(repo, 'issue-closed', row, row.closed_at);
      }
    }
    for (const row of await api.list(`/repos/${repo}/releases`)) {
      if (!row.draft) add(repo, 'release', row, row.published_at);
    }
  }
  return { plan: p, privateRepos, synthetic: false,
    events: [...new Map(events.map(e => [e.id, e])).values()].sort((a, b) => a.at.localeCompare(b.at)),
    limitations: ['GitHubの現在の記録を集計。削除済み・再オープン等の全履歴は復元しない。',
      '件数は活動量。品質・売上・利用効果、実際のデプロイは未確認。'] };
}

export const labels = { 'pr-opened': 'PR作成', 'pr-merged': 'PRマージ', 'issue-opened': 'Issue作成', 'issue-closed': 'Issue終了', release: 'Release記録' };
export function summarize(data, highlights) {
  const counts = Object.fromEntries(Object.keys(labels).map(k => [k, data.events.filter(e => e.kind === k).length]));
  const chosen = highlights ?? [...data.events].reverse().filter(e => ['pr-merged', 'release'].includes(e.kind)).slice(0, 5).map(e => ({ text: `${labels[e.kind]}: ${e.title}`, refs: [e.id] }));
  if (!Array.isArray(chosen) || chosen.length > 6) fail('要点は6件以内です');
  const points = chosen.map(h => {
    if (typeof h.text !== 'string' || h.text.length > 180 || !h.refs?.length) fail('要点には180字以内のtextとrefsが必要です');
    const sources = h.refs.map(id => data.events.find(e => e.id === id) ?? fail('要点の出典がありません'));
    return { text: h.text, sources };
  });
  const timeline = data.events.filter(e => e.kind === 'pr-merged').map(e => ({ id: e.id, repo: e.repo, title: e.title, url: e.url, merged_at: e.at, production_at: null, production_evidence: [], metric_evidence: [] }));
  return { ...data, counts, points, timeline };
}
