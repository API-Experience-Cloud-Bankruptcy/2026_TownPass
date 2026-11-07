"""GPU-only QLoRA feasibility trial. Results are not production acceptance."""
import argparse
import hashlib
import importlib.metadata
import json
import os
import random
import time
from collections import defaultdict
from pathlib import Path

BASE = 'google/gemma-4-E2B-it'
REVISION = '4adf15748de9e1a0097b6274cee9c15836c41c37'


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def read(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def score(text, row):
    expected = json.loads(row['completion'][0]['content'])
    try:
        actual = json.loads(text.strip())
    except (ValueError, TypeError):
        return {'json_valid': False, 'schema_valid': False, 'exact': False, 'source_correct': False}
    if row.get('task') == 'interpret':
        valid = (isinstance(actual, dict) and set(actual) == set(expected)
                 and isinstance(actual.get('candidateFields'), dict)
                 and set(actual['candidateFields']) <= {'age', 'region', 'is_student', 'household_type'}
                 and all(isinstance(actual.get(k), list) and all(isinstance(v, str) for v in actual[k])
                         for k in ('situationIds', 'uncertain', 'evidence')))
        if valid:
            f = actual['candidateFields']
            valid = (set(actual['situationIds']) <= {'living', 'elder', 'study', 'family', 'health', 'disability', 'housing', 'work'}
                     and ('age' not in f or type(f['age']) in (int, float) and 0 <= f['age'] <= 130)
                     and ('region' not in f or isinstance(f['region'], str))
                     and ('is_student' not in f or type(f['is_student']) is bool)
                     and ('household_type' not in f or isinstance(f['household_type'], str)
                          and f['household_type'] in {'low_income', 'mid_low_income', 'general'}))
        grounded = (valid and (bool(actual['evidence']) or not (actual['situationIds'] or actual['candidateFields']))
                    and all(v and v in row['prompt'][-1]['content'] for v in actual['evidence']))
        return {'json_valid': True, 'schema_valid': valid, 'exact': actual == expected,
                'source_correct': bool(grounded),
                'tags_exact': valid and set(actual['situationIds']) == set(expected['situationIds']),
                'fields_exact': valid and actual['candidateFields'] == expected['candidateFields']}
    valid = (isinstance(actual, dict) and set(actual) == set(expected)
             and isinstance(actual.get('answer'), str)
             and isinstance(actual.get('source_ids'), list)
             and all(isinstance(x, str) for x in actual['source_ids'])
             and isinstance(actual.get('verification_status'), str))
    return {'json_valid': True, 'schema_valid': valid, 'exact': actual == expected,
            'source_correct': valid and actual['source_ids'] == expected['source_ids']}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--steps', type=int, default=32)
    p.add_argument('--max-length', type=int, default=2048)
    p.add_argument('--eval-limit', type=int, default=8)
    p.add_argument('--token-file', type=Path)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    os.environ.setdefault('HF_HOME', '/vault/townpass/cache/huggingface')
    if args.token_file:
        os.environ['HF_TOKEN'] = args.token_file.read_text().strip()
    os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
    import torch
    from transformers import (AutoTokenizer, AutoModelForMultimodalLM, BitsAndBytesConfig,
                              Trainer, TrainingArguments, set_seed)
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from datasets import Dataset
    set_seed(20261107)
    if not torch.cuda.is_available(): raise RuntimeError('CUDA required')
    tokenizer = AutoTokenizer.from_pretrained(BASE, revision=REVISION)
    if tokenizer.pad_token_id is None: tokenizer.pad_token = tokenizer.eos_token
    rows = read(args.data / 'train.jsonl')
    grouped = defaultdict(list)
    for row in read(args.data / 'validation.jsonl'):
        grouped[row['task']].append(row)
    eval_rows = [rows[i] for i in range(max(map(len, grouped.values())))
                 for rows in grouped.values() if i < len(rows)][:args.eval_limit]
    # Validation only for the feasibility trial. Test remains sealed for final acceptance.
    encoded, rejected = [], []
    for row in rows:
        prompt = tokenizer.apply_chat_template(row['prompt'], tokenize=False,
                    add_generation_prompt=True, enable_thinking=False)
        full = tokenizer.apply_chat_template(row['prompt'] + row['completion'], tokenize=False,
                    add_generation_prompt=False, enable_thinking=False)
        if not full.startswith(prompt):
            raise RuntimeError('Chat template completion boundary mismatch; do not train with incorrect labels')
        ids = tokenizer(full, add_special_tokens=False)['input_ids']
        prefix_ids = tokenizer(prompt, add_special_tokens=False)['input_ids']
        if ids[:len(prefix_ids)] != prefix_ids: raise RuntimeError('Token boundary mismatch')
        if len(ids) > args.max_length:
            rejected.append({'id': row['id'], 'tokens': len(ids)})
            continue
        labels = [-100] * len(prefix_ids) + ids[len(prefix_ids):]
        if not any(v != -100 for v in labels): raise RuntimeError('Empty supervision')
        encoded.append({'input_ids': ids, 'attention_mask': [1] * len(ids), 'labels': labels})
    if len(encoded) < 32: raise RuntimeError('Too few usable examples')
    write(args.out / 'tokenization.json', {'accepted': len(encoded), 'rejected': rejected,
          'max_tokens': max(len(r['input_ids']) for r in encoded),
          'total_tokens': sum(len(r['input_ids']) for r in encoded)})
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
             bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForMultimodalLM.from_pretrained(BASE, revision=REVISION,
             quantization_config=quant, device_map={'': 0}, dtype=torch.bfloat16,
             attn_implementation={'text_config': 'sdpa', 'vision_config': 'sdpa', 'audio_config': 'eager'})
    write(args.out / 'environment.json', {'model': BASE, 'revision': REVISION,
        'gpu': torch.cuda.get_device_name(), 'cuda': torch.version.cuda,
        'packages': {k: importlib.metadata.version(k) for k in
            ['torch', 'transformers', 'peft', 'trl', 'datasets', 'bitsandbytes']},
        'seed': 20261107, 'steps': args.steps, 'max_length': args.max_length,
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'dataset_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in args.data.glob('*.jsonl')},
        'data_report': json.loads((args.data / 'data-report.json').read_text())})

    def evaluate(label):
        model.eval()
        predictions = []
        started = time.time()
        for row in eval_rows:
            text = tokenizer.apply_chat_template(row['prompt'], tokenize=False,
                     add_generation_prompt=True, enable_thinking=False)
            inputs = tokenizer(text, return_tensors='pt', add_special_tokens=False).to('cuda')
            with torch.inference_mode():
                result = model.generate(**inputs, max_new_tokens=384, do_sample=False,
                            pad_token_id=tokenizer.pad_token_id)
            answer = tokenizer.decode(result[0, inputs['input_ids'].shape[1]:], skip_special_tokens=True)
            token_count = result.shape[1] - inputs['input_ids'].shape[1]
            predictions.append({'id': row['id'], 'task': row['task'], 'output': answer,
                                'generated_tokens': token_count, 'hit_token_limit': token_count >= 384,
                                **score(answer, row)})
        summary = {k: sum(r[k] for r in predictions) / len(predictions)
                   for k in ['json_valid', 'schema_valid', 'exact', 'source_correct']}
        summary.update(count=len(predictions), seconds=time.time()-started,
                       scope='validation feasibility only; not production acceptance')
        needs = [r for r in predictions if r['task'] == 'interpret']
        if needs:
            summary['interpretation'] = {k: sum(bool(r.get(k)) for r in needs) / len(needs)
                                         for k in ('tags_exact', 'fields_exact')}
        write(args.out / (label + '.json'), {'summary': summary, 'predictions': predictions})
        print(label, json.dumps(summary), flush=True)
        return summary

    baseline = evaluate('baseline')
    targets = [name for name, module in model.named_modules()
               if 'language_model' in name and name.rsplit('.', 1)[-1]
               in {'q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'}]
    if not targets: raise RuntimeError('No text-only LoRA targets found')
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                    target_modules=targets, bias='none', task_type='CAUSAL_LM'))
    model.config.use_cache = False
    model.print_trainable_parameters()
    write(args.out / 'lora-targets.json', targets)

    def collate(batch):
        n = max(len(x['input_ids']) for x in batch)
        return {k: torch.tensor([x[k] + [pad] * (n-len(x[k])) for x in batch])
                for k, pad in [('input_ids', tokenizer.pad_token_id), ('attention_mask', 0), ('labels', -100)]}

    trainer = Trainer(model=model, train_dataset=Dataset.from_list(encoded), data_collator=collate,
        args=TrainingArguments(output_dir=str(args.out / 'checkpoints'), max_steps=args.steps,
             per_device_train_batch_size=1, gradient_accumulation_steps=4,
             learning_rate=1e-4, warmup_steps=max(1, round(args.steps * 0.05)), lr_scheduler_type='cosine',
             bf16=True, gradient_checkpointing=True, logging_steps=1,
             save_steps=16, save_total_limit=2, report_to='none', seed=20261107,
             optim='adamw_torch', remove_unused_columns=False))
    started = time.time()
    result = trainer.train()
    model.save_pretrained(args.out / 'adapter')
    tokenizer.save_pretrained(args.out / 'adapter')
    write(args.out / 'train-metrics.json', {**result.metrics, 'wall_seconds': time.time()-started,
            'peak_gpu_bytes': torch.cuda.max_memory_allocated()})
    model.gradient_checkpointing_disable()
    model.config.use_cache = True
    tuned = evaluate('tuned')
    write(args.out / 'decision.json', {'production_accepted': False,
        'pilot_exact_improved': tuned['exact'] > baseline['exact'],
        'pending': ['independent conversational data', 'full held-out evaluation',
                    'merge/quantization/export validation', 'offline physical phone acceptance']})
    print('PILOT_COMPLETE', str(args.out), flush=True)


if __name__ == '__main__': main()
