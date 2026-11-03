"""外部通信・認証読み込み・書き込みをしない導入計画。Python 3.10+。"""
import argparse
import hashlib
import json
import re
import sys
from urllib.parse import urlsplit

FRAMEWORKS = {
    'next-app': 'app/layoutでGTMを1回だけ設置するPR案。GoogleAnalyticsを併用しない。',
    'next-pages': 'pages/_appでGTMを1回だけ設置するPR案。GoogleAnalyticsを併用しない。',
    'wordpress': 'テーマ・挿入プラグイン・Site Kit・CMPを確認し、管理する挿入元を1つにする手順案。',
    'go': '共通HTMLテンプレートのhead/bodyへ公式スニペットを1回設置するPR案。',
    'static': '共通レイアウトのhead/bodyへ公式スニペットを1回設置するPR案。',
}
TARGET = {'url', 'framework', 'ga4_account_id', 'gtm_account_id'}
INVENTORY = {'status', 'url', 'ga4_account_id', 'gtm_account_id', 'measurement_ids', 'gtm_ids',
             'google_tag_measurements', 'site_gtm_ids', 'direct_ga4_ids', 'plugin_unreviewed', 'consent_reviewed'}


def check(obj, keys):
    if not isinstance(obj, dict) or set(obj) - keys:
        raise ValueError('入力形式が不正です。秘密情報や未定義キーは入力しないでください')


def site(value):
    u = urlsplit(value)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ValueError('サイトURLは認証情報・query・fragmentのないHTTPS URLにしてください')
    return value.rstrip('/')


def build(data):
    check(data, {'target', 'inventory'})
    t, i = data.get('target', {}), data.get('inventory', {})
    check(t, TARGET)
    check(i, INVENTORY)
    url = site(t.get('url', ''))
    if t.get('framework') not in FRAMEWORKS:
        raise ValueError('frameworkを明示してください')
    result = {'dry_run': True, 'status': 'needs_review', 'actions': [], 'blockers': [],
              'verification': {'installation': 'unverified', 'published': 'unverified', 'event_received': 'unverified'}}
    def stop(reason):
        result['blockers'].append(reason)
        return result
    if i.get('status') == 'credentials_missing':
        return stop('認証不足。対象と必要な読取権限を案内し、ユーザーの認証対応を待つ。作成しない。')
    if i.get('status') != 'verified':
        return stop('棚卸し未完了。対象アカウントの全ページとサイトの挿入元を確認する。')
    for key in ('ga4_account_id', 'gtm_account_id'):
        if not re.fullmatch(r'[0-9]+', t.get(key, '')):
            return stop('対象GA4/GTMアカウントIDを確定する。')
        if i.get(key) != t[key]:
            return stop('棚卸しのアカウントと対象が不一致。再取得する。')
    if site(i.get('url', '')) != url:
        return stop('棚卸しのサイトと対象が不一致。再取得する。')
    for key in ('measurement_ids', 'gtm_ids', 'google_tag_measurements', 'site_gtm_ids', 'direct_ga4_ids'):
        values = i.get(key)
        pattern = r'GTM-[A-Z0-9]+' if key in ('gtm_ids', 'site_gtm_ids') else r'G-[A-Z0-9]+'
        if not isinstance(values, list) or any(not isinstance(v, str) or not re.fullmatch(pattern, v) for v in values):
            raise ValueError('棚卸しID一覧が不正です')
    if type(i.get('plugin_unreviewed')) is not bool or type(i.get('consent_reviewed')) is not bool:
        raise ValueError('プラグインと同意の確認状態が必要です')
    if i['plugin_unreviewed'] or i['direct_ga4_ids']:
        return stop('既存の直接計測・プラグインを先に確認し、二重計測を防ぐ移行案をレビューする。')
    if any(len(i[k]) > 1 for k in ('measurement_ids', 'gtm_ids', 'google_tag_measurements', 'site_gtm_ids')):
        return stop('候補または挿入元が複数。重複・複数送信先の意図を確認し、作成しない。')
    ga = i['measurement_ids'][0] if i['measurement_ids'] else None
    gtm = i['gtm_ids'][0] if i['gtm_ids'] else None
    if (i['google_tag_measurements'] and (not gtm or i['google_tag_measurements'] != [ga])) or (i['site_gtm_ids'] and i['site_gtm_ids'] != [gtm]):
        return stop('既存タグ・コンテナ・測定先が不一致。設定を追加せず確認する。')
    if not i['consent_reviewed']:
        return stop('CMP・同意前の挙動・送信項目の方針を確定する。')
    result['status'] = 'plan_ready'
    result['reuse'] = {'measurement_id': ga, 'gtm_public_id': gtm}
    if not ga:
        result['actions'].append('承認後: 既存Property/Streamを再確認し、不足するリソースだけ作成する。')
    if not gtm:
        result['actions'].append('承認後: 既存Containerを再確認し、不足時だけWeb Containerを作成する。')
    if not i['google_tag_measurements']:
        result['actions'].append('承認後: WorkspaceでGoogle tag/Analytics destinationとトリガーの差分だけ設定する。公開しない。')
    if not i['site_gtm_ids']:
        result['actions'].append(FRAMEWORKS[t['framework']])
    if not result['actions']:
        result['status'] = 'reuse_only'
    result['next'] = 'Preview・重複発火・同意拒否/許可を検証。公開・deployは個別承認後。GA4受信は別に確認。'
    result['plan_id'] = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='GTM/GA4のオフラインdry-run。実行・公開機能なし。')
    parser.add_argument('--input', required=True)
    parser.add_argument('--dry-run', action='store_true', help='常にdry-run。省略しても変更しない')
    args = parser.parse_args()
    try:
        with open(args.input, encoding='utf-8') as f:
            result = build(json.load(f))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, TypeError, OSError, KeyError, AttributeError):
        print('入力を確認してください。秘密情報を含む入力・例外詳細は出力しません。', file=sys.stderr)
        sys.exit(2)
