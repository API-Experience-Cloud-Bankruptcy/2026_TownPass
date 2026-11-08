import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evaluate_v3 import main


class FrozenCandidateChecks(unittest.TestCase):
    def check_rejection(self, status='complete', eligible=True, tamper=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter = root/'candidate'/'adapter'
            adapter.mkdir(parents=True)
            files = ['adapter_model.safetensors','adapter_config.json']
            for name in files:
                (adapter/name).write_bytes(b'original')
            chosen = {'path':str(adapter.parent),'status':'evaluated','gate':{'eligible':eligible},
                      'artifact_sha256':{n:hashlib.sha256((adapter/n).read_bytes()).hexdigest() for n in files}}
            selection = root/'selection.json'
            selection.write_text(json.dumps({'status':status,'selected':chosen,'candidates':[chosen]}))
            if tamper:
                (adapter/'adapter_model.safetensors').write_bytes(b'replaced')
            args = ['evaluate_v3','--holdout',str(root/'sealed-unread.jsonl'),
                    '--adapter',str(adapter),'--selection',str(selection),'--out',str(root/'out')]
            with patch.object(sys,'argv',args), self.assertRaises(RuntimeError):
                main()
            self.assertFalse((root/'out').exists())

    def test_replaced_adapter_rejected_before_reading_holdout(self):
        self.check_rejection(tamper=True)

    def test_ineligible_selected_record_rejected(self):
        self.check_rejection(eligible=False)

    def test_incomplete_training_rejected(self):
        self.check_rejection(status='running')


if __name__ == '__main__':
    unittest.main()
