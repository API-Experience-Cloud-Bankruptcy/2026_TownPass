import json
import unittest
from run_pilot import score


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.answer = {'answer': '依學校公告', 'source_ids': ['WEL-0001'], 'verification_status': 'verified'}
        self.row = {'completion': [{'content': json.dumps(self.answer)}]}

    def test_rejects_markdown_and_extra_fields(self):
        self.assertFalse(score('```json\n{}\n```', self.row)['schema_valid'])
        self.assertFalse(score(json.dumps(dict(self.answer, approved=True)), self.row)['schema_valid'])

    def test_catches_wrong_amount_and_source(self):
        a = dict(self.answer, answer='一萬元', source_ids=['OTHER'])
        result = score(json.dumps(a), self.row)
        self.assertTrue(result['schema_valid'])
        self.assertFalse(result['exact'])
        self.assertFalse(result['source_correct'])

    def test_exact_requires_correct_metadata(self):
        self.assertTrue(score(json.dumps(self.answer), self.row)['exact'])
        self.assertFalse(score(json.dumps(dict(self.answer, verification_status='partial')), self.row)['exact'])

    def test_arbitrary_candidate_types_are_rejected_not_crashed(self):
        expected={'situationIds': [],'candidateFields': {},'uncertain': [],'evidence': []}
        row={'task':'interpret','prompt':[{'content':'你好'}], 'completion':[{'content':json.dumps(expected)}]}
        for value in ([], {}, 1, True):
            bad=dict(expected,candidateFields={'household_type':value})
            self.assertFalse(score(json.dumps(bad),row)['schema_valid'])


if __name__ == '__main__': unittest.main()
