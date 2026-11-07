"""CPU contract tests; optional torch tests exercise real KL gradients without a GPU."""
import json
import unittest
from types import SimpleNamespace
from run_v3 import completion_positions, encode_rows, parser, validate_args, retention_trainer_class
from v3_metrics import evaluate_answer, paired_gate, strict_json


def needs(key='n', fields=None, uncertainty=None):
    expected = {'situationIds': ['housing'], 'candidateFields': fields or {},
                'uncertain': uncertainty or [], 'evidence': ['想找租屋協助']}
    return {'id': key, 'task': 'interpret',
            'prompt': [{'role': 'user', 'content': '我住臺中，戶籍不清楚，想找租屋協助。'}],
            'completion': [{'role': 'assistant', 'content': json.dumps(expected, ensure_ascii=False)}],
            'expected': expected}


def scored(row, actual=None):
    text = row['completion'][0]['content'] if actual is None else json.dumps(actual, ensure_ascii=False)
    return {'id': row['id'], 'task': row['task'], **evaluate_answer(text, row)}


class V3MetricsTest(unittest.TestCase):
    def test_json_schema_and_grounding_are_separate(self):
        row = needs()
        text = row['completion'][0]['content']
        fenced = evaluate_answer('```json\n' + text + '\n```', row)
        self.assertFalse(fenced['json_valid'])
        extra = dict(row['expected'], extra='unsupported')
        self.assertTrue(evaluate_answer(json.dumps(extra), row)['json_valid'])
        self.assertFalse(evaluate_answer(json.dumps(extra), row)['strict'])
        invented = dict(row['expected'], evidence=['我戶籍在臺中市'])
        result = evaluate_answer(json.dumps(invented), row)
        self.assertTrue(result['strict'])
        self.assertFalse(result['evidence_substring_grounded'])
        self.assertFalse(result['automatic_proxy_pass'])

    def test_invalid_types_unknown_fields_and_duplicates(self):
        row = needs(fields={'age': 26})
        for fields in ({'age': True}, {'age': 26.0}, {'age': 121}, {'age': '26'}, {'age': 10**400}, {'age': float('inf')},
                       {'is_student': 1}, {'household_type': {}}, {'region': ''}, {'income': 100}):
            with self.subTest(fields=fields):
                actual = dict(row['expected'], candidateFields=fields)
                self.assertFalse(evaluate_answer(json.dumps(actual), row)['strict'])
        duplicate = row['completion'][0]['content'].replace('"candidateFields":', '"candidateFields": {}, "candidateFields":')
        self.assertFalse(evaluate_answer(duplicate, row)['json_valid'])
        duplicate_tags = dict(row['expected'], situationIds=['housing', 'housing'])
        self.assertFalse(evaluate_answer(json.dumps(duplicate_tags), row)['strict'])
        with self.assertRaises(ValueError):
            strict_json('{"x":NaN}')

    def test_false_positive_fields_and_numeric_bool_never_match(self):
        row = needs()
        actual = dict(row['expected'], candidateFields={'region': '臺中市'})
        result = evaluate_answer(json.dumps(actual), row)
        self.assertTrue(result['strict'])
        self.assertFalse(result['fields_exact'])
        self.assertFalse(result['correct'])
        row = needs(fields={'age': 1})
        self.assertFalse(evaluate_answer(json.dumps(dict(row['expected'], candidateFields={'age': True})), row)['fields_exact'])

    def test_uncertainty_paraphrase_is_proxy_with_review(self):
        row = needs(uncertainty=['戶籍地尚未確認'])
        actual = dict(row['expected'], uncertain=['戶口所在地不確定，請先確認。'])
        result = evaluate_answer(json.dumps(actual), row)
        self.assertTrue(result['uncertainty_markers_match'])
        self.assertTrue(result['correct'])
        self.assertTrue(result['uncertainty_semantic_review_required'])
        self.assertIsNone(result['fully_correct'])
        self.assertFalse(result['semantic_correctness_verified'])
        for text in ('所有補助已經核准', '戶籍已經確認，可以核准補助'):
            actual['uncertain'] = [text]
            self.assertFalse(evaluate_answer(json.dumps(actual), row)['uncertainty_markers_match'])
        row['uncertainty_markers'] = [['戶籍', '戶口'], ['不確定', '待查']]
        actual['uncertain'] = ['戶籍待查']
        self.assertTrue(evaluate_answer(json.dumps(actual), row)['uncertainty_markers_match'])

    def test_general_exact_and_mc(self):
        self.assertTrue(evaluate_answer('5', {'task': 'general', 'expected': '5'})['correct'])
        self.assertFalse(evaluate_answer('共有5人', {'task': 'general', 'expected': {'exact': '5'}})['correct'])
        unassessed = evaluate_answer('bad', {'task': 'general', 'expected': '5'})
        self.assertFalse(unassessed['correct'])
        self.assertTrue(unassessed['strict'])
        self.assertTrue(unassessed['format_not_assessed'])
        formatted = {'task': 'general', 'expected': '5', 'format_regex': r'[0-9]+'}
        self.assertTrue(evaluate_answer('6', formatted)['strict'])
        self.assertFalse(evaluate_answer('6人', formatted)['strict'])
        exact_letter = {'task': 'general', 'expected': {'exact': 'A'}}
        self.assertFalse(evaluate_answer('答案：A', exact_letter)['correct'])
        self.assertTrue(evaluate_answer('A', exact_letter)['correct'])
        mc = {'task': 'general', 'expected': {'choice': 'B'}}
        self.assertTrue(evaluate_answer('答案：B', mc)['correct'])
        self.assertFalse(evaluate_answer('答案：B', mc)['strict'])
        self.assertFalse(evaluate_answer('A與B都有可能', mc)['correct'])
        self.assertFalse(evaluate_answer('A', mc)['correct'])
        self.assertTrue(evaluate_answer('A', mc)['strict'])

    def test_paired_gates_and_source_regression_separate(self):
        n = scored(needs())
        general = {'id': 'g', 'task': 'general', 'correct': True, 'strict': True}
        source = {'id': 's', 'task': 'benefit', 'correct': True, 'strict': True}
        baseline = [{**n, 'tags_exact': False, 'correct': False, 'automatic_proxy_pass': False}, general, source]
        candidate = [n, general, source]
        gate = paired_gate(baseline, candidate)
        self.assertTrue(gate['eligible'])
        self.assertFalse(gate['production_accepted'])
        regression = paired_gate(baseline, [n, {**general, 'correct': False}, {**source, 'correct': False}])
        self.assertFalse(regression['eligible'])
        self.assertEqual(regression['lost_general_ids'], ['g'])
        self.assertEqual(regression['lost_source_ids'], ['s'])
        format_regression = paired_gate(baseline, [n, {**general, 'strict': False}, source])
        self.assertEqual(format_regression['lost_general_strict_ids'], ['g'])
        for key in ('fields_exact', 'strict', 'evidence_substring_grounded', 'uncertainty_markers_match'):
            self.assertFalse(paired_gate(baseline, [{**n, key: False}, general, source])['eligible'])
        self.assertFalse(paired_gate(candidate, candidate)['tags_improved'])
        self.assertFalse(paired_gate(candidate, candidate)['eligible'])
        perfect_tags_base = [{**n, 'automatic_proxy_pass': False, 'correct': False}, general, source]
        self.assertTrue(paired_gate(perfect_tags_base, candidate)['eligible'])

    def test_pair_ids_duplicates_tasks_and_missing_general_are_rejected(self):
        n = scored(needs())
        for baseline, candidate in (([n], []), ([n, n], [n]), ([n], [{**n, 'task': 'general'}])):
            with self.assertRaises(ValueError):
                paired_gate(baseline, candidate)
        self.assertFalse(paired_gate([{**n, 'tags_exact': False, 'automatic_proxy_pass': False}], [n])['eligible'])


class V3EncodingTest(unittest.TestCase):
    def test_completion_positions_shift_bounds_and_sampling(self):
        self.assertEqual(completion_positions([-100, -100, 3, 4, 5], 8), [1, 2, 3])
        labels = [-100] * 5 + list(range(100))
        sampled = completion_positions(labels, 8)
        self.assertEqual(len(sampled), 8)
        self.assertEqual(len(set(sampled)), 8)
        self.assertEqual(sampled[0], 4)
        self.assertEqual(sampled[-1], 103)
        self.assertTrue(all(labels[x + 1] != -100 for x in sampled))
        self.assertEqual(completion_positions(labels, 1), [54])
        with self.assertRaises(ValueError):
            completion_positions(labels, 0)

    def test_only_replay_rows_receive_retention_and_boundaries_fail_closed(self):
        class Tokenizer:
            def apply_chat_template(self, messages, **kwargs):
                self.thinking = kwargs['enable_thinking']
                return 'prompt' + ('answer' if len(messages) > 1 else '')
            def __call__(self, text, **kwargs):
                return {'input_ids': list(text.encode())}
        tok = Tokenizer()
        row = {'id': 'a', 'task': 'interpret', 'prompt': [{'content': 'input'}],
               'completion': [{'content': 'answer'}]}
        encoded, manifest = encode_rows(tok, [row, {**row, 'id': 'b', 'task': 'replay'}], 100, 2)
        self.assertEqual(encoded[0]['retention_positions'], [])
        self.assertEqual(len(encoded[1]['retention_positions']), 2)
        self.assertFalse(tok.thinking)
        self.assertEqual(manifest[1]['retention_target_positions'], [6, 11])
        with self.assertRaises(RuntimeError):
            encode_rows(tok, [row], 5, 2)
        class BadTokenizer(Tokenizer):
            def apply_chat_template(self, messages, **kwargs):
                return 'incompatible' if len(messages) > 1 else 'prompt'
        with self.assertRaises(RuntimeError):
            encode_rows(BadTokenizer(), [row], 100, 2)

    def test_conservative_defaults_and_checkpoints(self):
        a = parser().parse_args(['--data', 'unused', '--out', 'unused'])
        self.assertEqual(a.learning_rate, 1e-5)
        self.assertEqual(a.retention_coefficient, 0.2)
        self.assertEqual(validate_args(a), [32, 64, 96, 128])
        self.assertEqual((a.needs_max_new_tokens, a.general_max_new_tokens), (256, 128))
        a.steps = 40
        self.assertEqual(validate_args(a), [32, 40])
        a.retention_coefficient = -1
        with self.assertRaises(ValueError):
            validate_args(a)


try:
    import torch
except ImportError:
    torch = None


@unittest.skipIf(torch is None, 'torch is not installed; real tensor retention test requires CPU torch')
class V3RetentionTest(unittest.TestCase):
    def test_original_reference_kl_gradients_and_training_state(self):
        from contextlib import contextmanager
        import torch.nn.functional as F
        class TinyModel(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.weight = torch.nn.Parameter(torch.zeros(3, 5), requires_grad=False)
                self.adapter = torch.nn.Parameter(torch.full((3, 5), 0.2))
                self.enabled = True
                self.calls = []
            @contextmanager
            def disable_adapter(self):
                self.enabled = False
                try:
                    yield
                finally:
                    self.enabled = True
            def forward(self, input_ids, attention_mask, labels=None, **kwargs):
                self.calls.append((self.enabled, self.training, torch.is_grad_enabled(), len(input_ids)))
                # Unequal adapter logits produce nonzero KL and nonzero grads.
                adjustment = self.adapter * torch.arange(5).float()
                logits = (self.weight + (adjustment if self.enabled else 0)).unsqueeze(0).expand(len(input_ids), -1, -1)
                loss = F.cross_entropy(logits[:, :-1].reshape(-1, 5), labels[:, 1:].reshape(-1), ignore_index=-100) if labels is not None else None
                return SimpleNamespace(logits=logits, loss=loss)
        class Base:
            def __init__(self):
                self.accelerator = SimpleNamespace(unwrap_model=lambda model: model)
        trainer = retention_trainer_class(Base)(retention_coefficient=0.2, retention_chunk_positions=1)
        model = TinyModel()
        values = {'input_ids': torch.tensor([[0, 1, 2], [0, 1, 3]]), 'attention_mask': torch.ones(2, 3),
                  'labels': torch.tensor([[-100, 1, 2], [-100, 1, 3]]),
                  'retention_positions': torch.tensor([[0, 1], [-1, -1]])}
        loss = trainer.compute_loss(model, values, num_items_in_batch=torch.tensor(4))
        self.assertEqual(model.calls, [(False, False, False, 1), (True, True, True, 2)])
        self.assertTrue(model.training)
        self.assertTrue(model.enabled)
        expected_kl = torch.logsumexp(torch.arange(5).float() * 0.2, dim=0) - 0.4 - torch.tensor(5.).log()
        self.assertAlmostEqual(trainer.retention_stats['kl_sum'], expected_kl.item(), places=6)
        self.assertEqual(trainer.retention_stats['sampled_positions'], 2)
        loss.backward()
        self.assertTrue(torch.isfinite(model.adapter.grad).all())
        self.assertIsNone(model.weight.grad)
        model.calls.clear()
        trainer.retention_coefficient = 0
        trainer.compute_loss(model, values)
        self.assertEqual(model.calls, [(True, True, True, 2)])


if __name__ == '__main__':
    unittest.main()
