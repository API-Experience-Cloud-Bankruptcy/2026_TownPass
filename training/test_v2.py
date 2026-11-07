import json
import tempfile
import unittest
from pathlib import Path
from prepare_v2 import build,needs
from run_pilot import read
from v2_metrics import evaluate_answer,paired_gate


class V2Test(unittest.TestCase):
    def test_data_contract_and_split(self):
        with tempfile.TemporaryDirectory() as d:
            build(Path(d))
            train=read(Path(d)/'train.jsonl');dev=read(Path(d)/'validation.jsonl')
            self.assertEqual(len(train),len({r['id'] for r in train}))
            self.assertFalse({r['prompt'][-1]['content'] for r in train}&{r['prompt'][-1]['content'] for r in dev})
            for row in train:
                if row['task']=='interpret':
                    scores=evaluate_answer(row['completion'][0]['content'],row)
                    self.assertTrue(scores['correct'],row['id'])
                    self.assertTrue(scores['strict'],row['id'])

    def test_wrong_registration_and_schema_are_rejected(self):
        row=needs('example','住在臺北，戶籍在臺南市，想找租屋支援。',['housing'],{'region':'臺南市'})
        actual=dict(row['expected']);actual['candidateFields']={'region':'臺北'}
        self.assertFalse(evaluate_answer(json.dumps(actual),row)['correct'])
        actual=dict(row['expected']);actual['uncertain']=False
        self.assertFalse(evaluate_answer(json.dumps(actual),row)['strict'])

    def test_fence_diagnostic_keeps_strict_separate(self):
        row=needs('example','需要醫療補助。',['health'])
        scores=evaluate_answer('```json\n'+row['completion'][0]['content']+'\n```',row)
        self.assertTrue(scores['correct']);self.assertFalse(scores['strict'])

    def test_any_previously_correct_general_failure_blocks(self):
        base=[{'id':'g1','task':'general','correct':True,'strict':True},
              {'id':'g2','task':'general','correct':False,'strict':False},
              {'id':'n','task':'interpret','correct':False,'strict':False,'critical_fields_correct':False,'uncertainty_present_correct':False}]
        tuned=[{'id':'g1','task':'general','correct':False,'strict':False},
               {'id':'g2','task':'general','correct':True,'strict':True},
               {'id':'n','task':'interpret','correct':True,'strict':True,'critical_fields_correct':True,'uncertainty_present_correct':True}]
        gate=paired_gate(base,tuned)
        self.assertFalse(gate['eligible']);self.assertEqual(gate['lost_general_ids'],['g1'])

    def test_no_spurious_choice_from_prose(self):
        row={'task':'general','expected':'A'}
        self.assertFalse(evaluate_answer('A與B都有可能。',row)['correct'])
        self.assertTrue(evaluate_answer('答案：A',row)['correct'])
        wrong_but_formatted=evaluate_answer('B',row)
        self.assertFalse(wrong_but_formatted['correct'])
        self.assertTrue(wrong_but_formatted['strict'])

    def test_wrong_uncertainty_is_not_correct(self):
        row=needs('example','只知道住臺北，戶籍不明，想找租屋補助。',['housing'],{},['戶籍地尚未確認'])
        actual=dict(row['expected']);actual['uncertain']=['已核准所有補助']
        scores=evaluate_answer(json.dumps(actual),row)
        self.assertTrue(scores['uncertainty_present_correct'])
        self.assertFalse(scores['uncertainty_exact_match'])
        self.assertFalse(scores['correct'])

    def test_general_format_regression_blocks(self):
        row=needs('example','需要醫療補助。',['health'])
        good={'id':'n','task':'interpret',**evaluate_answer(row['completion'][0]['content'],row)}
        bad={**good,'strict':False}
        base=[{'id':'g','task':'general','correct':True,'strict':True},bad]
        tuned=[{'id':'g','task':'general','correct':True,'strict':False},good]
        gate=paired_gate(base,tuned)
        self.assertFalse(gate['eligible']);self.assertEqual(gate['lost_general_strict_ids'],['g'])


if __name__=='__main__':unittest.main()
