import json
import tempfile
import unittest
from pathlib import Path
from prepare import build, groups, split_for


class CorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(__file__).resolve().parents[1] / 'backend/data/subsidies.json'
        cls.original = cls.source.read_bytes()
        cls.records = json.loads(cls.original)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        cls.report = build(cls.source, cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_source_untouched(self):
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_related_and_same_url_do_not_leak(self):
        mapping = groups(self.records)
        seen = {}
        for r in self.records:
            for related in r['merge']['related_ids']:
                if related in mapping:
                    self.assertEqual(mapping[r['id']], mapping[related])
            url = r['application']['urls']['program']
            if url:
                url = url.split('#')[0]
                self.assertEqual(seen.setdefault(url, mapping[r['id']]), mapping[r['id']])

    def test_only_verified_with_source_exact_targets(self):
        indexed = {r['id']: r for r in self.records}
        field_paths = {'benefit': ('benefit', 'raw'), 'process': ('application', 'process_text'),
                       'eligibility': ('eligibility', 'raw_summary'), 'deadline': ('application', 'deadline')}
        sets = []
        for split in ('train', 'validation', 'test'):
            rows = [json.loads(l) for l in (self.out / (split + '.jsonl')).read_text().splitlines()]
            sets.append(set(r['group'] for r in rows))
            for row in rows:
                r = indexed[row['record_ids'][0]]
                a = json.loads(row['completion'][0]['content'])
                self.assertEqual(r['source_meta']['verification_status'], 'verified')
                x, y = field_paths[row['task']]
                expected = r[x][y]
                if row['task'] == 'deadline': expected = expected['raw']
                self.assertEqual(a['answer'], expected or '資料不足，請洽承辦單位確認。')
                self.assertEqual(a['source_ids'], [r['id']])
                self.assertEqual(split_for(row['group']), split)
        for i in range(3):
            for j in range(i): self.assertFalse(sets[i] & sets[j])


if __name__ == '__main__': unittest.main()
