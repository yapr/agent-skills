import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('plan', Path(__file__).parents[1] / 'scripts/plan.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def configured():
    return {'target': {'url': 'https://example.invalid', 'framework': 'next-app', 'ga4_account_id': '100', 'gtm_account_id': '200'},
            'inventory': {'status': 'verified', 'url': 'https://example.invalid', 'ga4_account_id': '100', 'gtm_account_id': '200',
                          'measurement_ids': ['G-EXAMPLE1'], 'gtm_ids': ['GTM-EXAMPLE1'], 'google_tag_measurements': ['G-EXAMPLE1'],
                          'site_gtm_ids': ['GTM-EXAMPLE1'], 'direct_ga4_ids': [], 'plugin_unreviewed': False, 'consent_reviewed': True}}


class PlanTests(unittest.TestCase):
    def test_existing_and_repeat_are_noop_not_verified(self):
        d = configured()
        r = MODULE.build(d)
        self.assertEqual(r, MODULE.build(copy.deepcopy(d)))
        self.assertEqual(r['status'], 'reuse_only')
        self.assertEqual(r['actions'], [])
        self.assertTrue(all(v == 'unverified' for v in r['verification'].values()))

    def test_missing_credentials_and_partial_inventory_never_create(self):
        for state in ('credentials_missing', 'unknown', 'partial', 'failed'):
            d = configured(); d['inventory'] = {'status': state}
            r = MODULE.build(d)
            self.assertEqual(r['actions'], []); self.assertTrue(r['blockers'])

    def test_new_setup_is_proposal_only_for_each_framework(self):
        for framework in MODULE.FRAMEWORKS:
            d = configured(); d['target']['framework'] = framework
            for key in ('measurement_ids', 'gtm_ids', 'google_tag_measurements', 'site_gtm_ids'):
                d['inventory'][key] = []
            r = MODULE.build(d)
            self.assertEqual(r['status'], 'plan_ready'); self.assertTrue(r['dry_run'])
            self.assertEqual(len(r['actions']), 4)

    def test_duplicates_direct_and_unknown_plugin_block(self):
        for key, value in [('site_gtm_ids', ['GTM-EXAMPLE1'] * 2), ('measurement_ids', ['G-EXAMPLE1', 'G-EXAMPLE2']),
                           ('direct_ga4_ids', ['G-EXAMPLE1']), ('plugin_unreviewed', True), ('consent_reviewed', False),
                           ('google_tag_measurements', ['G-OTHER']), ('gtm_account_id', '999')]:
            d = configured(); d['inventory'][key] = value
            self.assertTrue(MODULE.build(d)['blockers'], key)

    def test_partial_setup_only_proposes_missing_layer(self):
        d = configured(); d['inventory']['site_gtm_ids'] = []
        r = MODULE.build(d)
        self.assertEqual(len(r['actions']), 1)
        self.assertIn('app/layout', r['actions'][0])

    def test_invalid_and_secret_input_not_echoed(self):
        for bad in ('https://user:secret@example.invalid', 'https://example.invalid/?email=private'):
            d = configured(); d['target']['url'] = bad
            with self.assertRaises(ValueError): MODULE.build(d)
        d = configured(); d['token'] = 'SYNTHETIC_SECRET_DO_NOT_LOG'
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'input.json'; p.write_text(json.dumps(d))
            r = subprocess.run([sys.executable, str(Path(__file__).parents[1] / 'scripts/plan.py'), '--input', str(p)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2)
            self.assertNotIn(d['token'], r.stdout + r.stderr)


if __name__ == '__main__':
    unittest.main()
