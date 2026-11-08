import copy
import json
import tempfile
import unittest
from pathlib import Path

from prepare_v3 import build, digest, validate_material


class MaterialChecks(unittest.TestCase):
    def setUp(self):
        self.row = {'id':'example', 'group_id':'family', 'category':'housing',
                    'input':'我自己二十歲，想找租屋協助。',
                    'target':{'situationIds':['housing'], 'candidateFields':{'age':20},
                              'uncertain':[], 'evidence':['想找租屋協助']},
                    'annotation_reason':'原文明確說明需求', 'provenance':'AI synthetic'}

    def test_supported_material(self):
        validate_material(self.row)

    def test_boolean_cannot_be_age(self):
        row = copy.deepcopy(self.row)
        row['target']['candidateFields']['age'] = True
        with self.assertRaisesRegex(ValueError, 'age'):
            validate_material(row)

    def test_nonexistent_evidence_rejected(self):
        row = copy.deepcopy(self.row)
        row['target']['evidence'] = ['戶籍在臺北市']
        with self.assertRaisesRegex(ValueError, 'Evidence'):
            validate_material(row)

    def test_changed_material_cannot_reuse_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            materials, review = root/'materials.jsonl', root/'review.json'
            materials.write_text(json.dumps(self.row)+'\n')
            review.write_text(json.dumps({'materials_sha256':'stale', 'approved_ids':['example']}))
            with self.assertRaisesRegex(ValueError, 'exact material'):
                build(materials,review,root/'dev',root/'replay',root/'out')
            self.assertFalse((root/'out').exists())

    def test_quarantined_case_cannot_be_approved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            materials, review = root/'materials.jsonl', root/'review.json'
            materials.write_text(json.dumps(self.row)+'\n')
            review.write_text(json.dumps({'materials_sha256':digest(materials),
                'reviewer_type':'AI','purpose':'experimental_training_only',
                'approved_ids':['example'],'rejected':[{'id':'example','reason':'Ambiguous applicant'}]}))
            with self.assertRaisesRegex(ValueError, 'conflict'):
                build(materials,review,root/'dev',root/'replay',root/'out')
            self.assertFalse((root/'out').exists())


if __name__ == '__main__':
    unittest.main()
