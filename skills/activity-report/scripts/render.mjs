import { dirname } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Temporal } from '@js-temporal/polyfill';
import { chromium } from 'playwright';
import { hash, json, labels } from './core.mjs';

export const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 取得したタイトルでSlackメンション・書式を発動させない。
const plain = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/[`*_~]/g, '');
export function textReport(r) {
  const p = r.plan;
  return [`作業報告｜${p.startDate}〜${p.endDate}（終了日を含まない・${p.timezone}）`,
    `対象: ${p.repos.join(', ')}`, r.synthetic ? '架空データ・送信禁止' : 'GitHubの記録に基づく下書き',
    Object.entries(r.counts).map(([k, n]) => `${labels[k]} ${n}`).join(' / '),
    ...r.points.flatMap(h => [`• ${plain(h.text)}`, ...h.sources.map(e => `  ${e.url}`)]),
    ...(r.points.length ? [] : ['要点: 対象期間のマージ・Release記録なし。成果なしとは断定しません。']),
    ...r.limitations.map(s => `未確認: ${plain(s)}`)].join('\n');
}
const localTime = (at, zone) => Temporal.Instant.from(at).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'minute' });
export function timelineText(r) {
  return ['# マージ年表', `タイムゾーン: ${r.plan.timezone}。本番反映日はすべて未確認（マージから推定しない）。`, ...r.timeline.map(e => `- ${localTime(e.merged_at, r.plan.timezone)} | ${e.repo} | ${e.title.replace(/[\r\n]/g, ' ')} | ${e.url}`)].join('\n');
}
export function htmlReport(r) {
  const p = r.plan, max = Math.max(1, ...Object.values(r.counts));
  const bars = Object.entries(r.counts).map(([kind, n], i) => `<g transform="translate(0 ${i * 47})"><text x="0" y="23">${labels[kind]}</text><rect x="155" y="4" width="${n / max * 590}" height="28" rx="6" fill="${kind === 'pr-merged' ? '#2563eb' : '#93b4ef'}"/><text x="${165 + n / max * 590}" y="24">${n}</text></g>`).join('');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#edf2f8;color:#18253d;font:18px -apple-system,BlinkMacSystemFont,"Noto Sans CJK JP",sans-serif}.sheet{width:1040px;padding:52px;background:#f9fbfe}.tag{font-size:15px;color:#476391;letter-spacing:2px}h1{font-size:38px;margin:12px 0}.period{font-size:21px}.scope{color:#53657f;font-size:16px;overflow-wrap:anywhere}.card{background:white;border:1px solid #dce4f0;border-radius:16px;padding:25px;margin-top:24px}h2{font-size:22px;margin:0 0 18px}svg{width:100%;height:235px;font-size:18px}li{line-height:1.6;margin:14px 0;overflow-wrap:anywhere}.source{font-size:12px;color:#63718a;overflow-wrap:anywhere}.note{font-size:15px;color:#53657f;line-height:1.7}.foot{margin-top:24px;font-size:13px;color:#65748a}</style>
  <main class="sheet"><div class="tag">ACTIVITY REPORT · ${r.synthetic ? 'SAMPLE' : 'DRAFT'}</div><h1>開発の動きを、ひと目で。</h1><div class="period">${escape(p.startDate)} → ${escape(p.endDate)}</div><p class="scope">終了日を含まない / ${escape(p.timezone)}<br>${escape(p.repos.join(' / '))}</p>
  <section class="card"><h2>活動の記録</h2><svg viewBox="0 0 850 235" role="img" aria-label="活動件数">${bars}</svg><div class="note">件数は活動量です。成果の大きさや品質は表しません。</div></section>
  <section class="card"><h2>記録から分かる変更</h2><ul>${r.points.map(h => `<li>${escape(h.text)}<div class="source">${h.sources.map(e => escape(e.url)).join('<br>')}</div></li>`).join('') || '<li>対象期間のマージ・Release記録なし。成果なしとは断定しません。</li>'}</ul></section>
  <section class="card"><h2>マージ年表</h2><ul>${r.timeline.slice(-6).map(e => `<li>${escape(localTime(e.merged_at, p.timezone))} · ${escape(e.repo)}<br>${escape(e.title)}<div class="source">${escape(e.url)}</div></li>`).join('') || '<li>期間内のマージ記録なし</li>'}</ul><div class="note">本番反映日は未確認。マージから推定しません。${r.timeline.length > 6 ? '図は直近6件。全件はtimeline.mdに記録。' : ''}</div></section><section class="card"><h2>確認が必要なこと</h2><div class="note">${r.limitations.map(escape).join('<br>')}</div></section><div class="foot">${r.synthetic ? '架空データ / 送信禁止' : 'GitHubの取得時点の記録 / 公開・効果は別途確認'}</div></main></html>`;
}
export async function render(r, out, browserType = chromium) {
  // 新規フォルダに限定し、古い画像と新しい本文の混在を防ぐ。
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  await mkdir(out, { recursive: false, mode: 0o700 });
  const text = textReport(r);
  if (text.length > 12000) throw new Error('本文が長すぎます。対象範囲または要点を絞ってください');
  const files = { 'report.txt': Buffer.from(text), 'evidence.json': Buffer.from(json(r)), 'timeline.md': Buffer.from(timelineText(r)) };
  if (r.plan.format !== 'text') {
    files['report.html'] = Buffer.from(htmlReport(r));
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1040, height: 800 }, deviceScaleFactor: 1 });
      await page.route('**/*', route => route.abort());
      await page.setContent(files['report.html'].toString());
      await page.evaluate(() => document.fonts.ready);
      files['report.png'] = await page.locator('.sheet').screenshot();
    } finally { await browser.close(); }
  }
  for (const [name, bytes] of Object.entries(files)) await writeFile(`${out}/${name}`, bytes, { mode: 0o600 });
  const manifest = { plan: r.plan, privateRepos: r.privateRepos, synthetic: r.synthetic,
    hashes: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])) };
  manifest.id = hash(json(manifest));
  await writeFile(`${out}/manifest.json`, json(manifest), { mode: 0o600 });
  return manifest;
}
export async function verify(out) {
  const m = JSON.parse(await readFile(`${out}/manifest.json`, 'utf8'));
  const { id, ...payload } = m;
  if (hash(json(payload)) !== id) throw new Error('manifestが変更されています。再生成してください');
  const permitted = ['report.txt', 'report.html', 'report.png', 'evidence.json', 'timeline.md'];
  if (!m.hashes['report.txt'] || !m.hashes['evidence.json'] || (m.plan.format !== 'text' && !m.hashes['report.png'])) throw new Error('必要な成果物がありません');
  for (const [name, expected] of Object.entries(m.hashes)) {
    if (!permitted.includes(name) || hash(await readFile(`${out}/${name}`)) !== expected) throw new Error('成果物が変更されています。再生成してください');
  }
  return m;
}
