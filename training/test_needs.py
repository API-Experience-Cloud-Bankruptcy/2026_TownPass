import json
import tempfile
import unittest
from pathlib import Path
from prepare_needs import build
from run_pilot import score


class NeedsTests(unittest.TestCase):
    def test_corpus_contract_and_separate_prompts(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d); build(out)
            seen = set()
            for split in ('train', 'validation', 'test'):
                for line in (out / f'{split}.jsonl').read_text().splitlines():
                    row = json.loads(line)
                    text = row['prompt'][-1]['content']
                    self.assertNotIn(text, seen)
                    seen.add(text)
                    result = score(row['completion'][0]['content'], row)
                    self.assertTrue(result['schema_valid'])
                    self.assertTrue(result['source_correct'])

    def test_residence_and_relative_do_not_become_applicant_fields(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d); build(out)
            rows = [json.loads(x) for x in (out / 'train.jsonl').read_text().splitlines()]
            for row in rows:
                text = row['prompt'][-1]['content']
                answer = json.loads(row['completion'][0]['content'])
                if text.startswith('我住臺北'): self.assertNotIn('region', answer['candidateFields'])
                if text.startswith('幫媽媽'): self.assertNotIn('age', answer['candidateFields'])


if __name__ == '__main__': unittest.main()
