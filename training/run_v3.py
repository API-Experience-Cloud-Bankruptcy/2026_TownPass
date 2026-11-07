"""Conservative BF16 LoRA candidates with development-only selection and replay retention.

No model is promoted and no holdout is read. The reference is the ORIGINAL frozen
base, temporarily obtained by disabling adapters, never a second resident model.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import time
from pathlib import Path
from run_pilot import BASE, REVISION, read
from run_v2 import load_model
from v3_metrics import evaluate_answer, summarize, paired_gate


def write(path, value):
    """Publish a complete JSON report even if a later GPU operation fails."""
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def completion_positions(labels, sample_count):
    """Logit indices that predict supervised completion tokens (causal shift)."""
    if sample_count < 1:
        raise ValueError('sample_count must be positive')
    positions = [i - 1 for i, label in enumerate(labels) if i > 0 and label != -100]
    if len(positions) <= sample_count:
        return positions
    if sample_count == 1:
        return [positions[len(positions) // 2]]
    return [positions[i * (len(positions) - 1) // (sample_count - 1)] for i in range(sample_count)]


def encode_rows(tokenizer, rows, max_length, retention_positions):
    encoded, manifest = [], []
    for row in rows:
        prefix = tokenizer.apply_chat_template(row['prompt'], tokenize=False,
                     add_generation_prompt=True, enable_thinking=False)
        full = tokenizer.apply_chat_template(row['prompt'] + row['completion'], tokenize=False,
                   add_generation_prompt=False, enable_thinking=False)
        if not full.startswith(prefix):
            raise RuntimeError(f"Completion prefix mismatch: {row['id']}")
        ids = tokenizer(full, add_special_tokens=False)['input_ids']
        prompt_ids = tokenizer(prefix, add_special_tokens=False)['input_ids']
        if ids[:len(prompt_ids)] != prompt_ids or len(ids) > max_length:
            raise RuntimeError(f"Token boundary/length failure: {row['id']}")
        labels = [-100] * len(prompt_ids) + ids[len(prompt_ids):]
        if not any(x != -100 for x in labels):
            raise RuntimeError(f"Empty completion: {row['id']}")
        # No distribution retention on domain/task or source-copy examples.
        positions = completion_positions(labels, retention_positions) if row['task'] == 'replay' else []
        encoded.append({'input_ids': ids, 'attention_mask': [1] * len(ids),
                        'labels': labels, 'retention_positions': positions})
        manifest.append({'id': row['id'], 'task': row['task'], 'tokens': len(ids),
                         'completion_token_start': len(prompt_ids),
                         'retention_logit_positions': positions,
                         'retention_target_positions': [i + 1 for i in positions]})
    if not encoded:
        raise ValueError('Training set is empty')
    return encoded, manifest


def retention_trainer_class(trainer_base):
    """Lazy imports keep CPU-only data and metric checks usable without torch."""
    class RetentionTrainer(trainer_base):
        def __init__(self, *args, retention_coefficient=0.2, retention_chunk_positions=2, **kwargs):
            super().__init__(*args, **kwargs)
            self.retention_coefficient = retention_coefficient
            self.retention_chunk_positions = retention_chunk_positions
            # Our CE/KL are per-microbatch means. Trainer must apply its ordinary
            # accumulation scaling, not pretend this custom loss uses batch counts.
            self.model_accepts_loss_kwargs = False
            self.retention_stats = {'microbatches': 0, 'retention_microbatches': 0,
                                    'sampled_positions': 0, 'ce_sum': 0.0, 'kl_sum': 0.0}

        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            import torch
            import torch.nn.functional as F
            values = dict(inputs)
            sampled = values.pop('retention_positions')
            coords = [(i, int(pos)) for i, positions in enumerate(sampled)
                      for pos in positions.tolist() if pos >= 0]
            reference_logits = None
            if self.retention_coefficient > 0 and coords:
                # Reference runs BEFORE the checkpointed student graph. Adapter
                # state and training mode are restored before any differentiable
                # forward/backward, avoiding recomputation under disabled LoRA.
                replay_indices = sorted({i for i, _ in coords})
                row_map = {original: local for local, original in enumerate(replay_indices)}
                reference_rows = torch.tensor([row_map[i] for i, _ in coords], device=values['input_ids'].device)
                positions = torch.tensor([p for _, p in coords], device=values['input_ids'].device)
                was_training = model.training
                owner = self.accelerator.unwrap_model(model)
                try:
                    model.eval()
                    with torch.no_grad(), owner.disable_adapter():
                        reference = model(input_ids=values['input_ids'][replay_indices],
                                          attention_mask=values['attention_mask'][replay_indices],
                                          use_cache=False, return_dict=True)
                        # Advanced indexing copies just the bounded BF16 positions;
                        # release the full reference logits before student forward.
                        reference_logits = reference.logits[reference_rows, positions].detach()
                        del reference
                finally:
                    model.train(was_training)
            outputs = model(**values, use_cache=False, return_dict=True)
            ce = outputs.loss
            kl = ce.new_zeros(())
            if reference_logits is not None:
                # Each conversion to FP32 spans at most chunk_positions x vocab.
                # KL is forward KL P(original base) || P(adapted), no temperature.
                for start in range(0, len(coords), self.retention_chunk_positions):
                    stop = min(start + self.retention_chunk_positions, len(coords))
                    student_rows = [i for i, _ in coords[start:stop]]
                    student_positions = [p for _, p in coords[start:stop]]
                    teacher_logp = F.log_softmax(reference_logits[start:stop].float(), dim=-1)
                    student_logp = F.log_softmax(outputs.logits[student_rows, student_positions].float(), dim=-1)
                    kl = kl + F.kl_div(student_logp, teacher_logp, log_target=True, reduction='sum')
                kl = kl / len(coords)
            loss = ce + self.retention_coefficient * kl
            stats = self.retention_stats
            stats['microbatches'] += 1
            stats['retention_microbatches'] += int(reference_logits is not None)
            stats['sampled_positions'] += len(coords) if reference_logits is not None else 0
            stats['ce_sum'] += float(ce.detach())
            stats['kl_sum'] += float(kl.detach())
            return (loss, outputs) if return_outputs else loss
    return RetentionTrainer


def evaluate(model, tokenizer, rows, out, *, max_length=2048, needs_tokens=256, general_tokens=128):
    import torch
    was_training = model.training
    model.eval()
    predictions = []
    started = time.time()
    try:
        for row in rows:
            text = tokenizer.apply_chat_template(row['prompt'], tokenize=False,
                    add_generation_prompt=True, enable_thinking=False)
            inputs = tokenizer(text, add_special_tokens=False, return_tensors='pt').to(model.device)
            limit = general_tokens if row['task'] in {'general', 'replay'} else needs_tokens
            if inputs['input_ids'].shape[1] + limit > max_length:
                raise RuntimeError(f"Evaluation exceeds context budget: {row['id']}")
            with torch.inference_mode():
                result = model.generate(**inputs, max_new_tokens=limit, do_sample=False,
                                       pad_token_id=tokenizer.pad_token_id)
            tokens = result[0, inputs['input_ids'].shape[1]:]
            answer = tokenizer.decode(tokens, skip_special_tokens=True)
            predictions.append({'id': row['id'], 'task': row['task'], 'category': row.get('category'),
                'output': answer, 'generated_tokens': len(tokens), 'hit_token_limit': len(tokens) >= limit,
                **evaluate_answer(answer, row)})
            del result, inputs, tokens
    finally:
        model.train(was_training)
        # Partial observations are preserved but never fed into a gate.
        report = {'summary': summarize(predictions), 'seconds': time.time() - started,
                  'complete': len(predictions) == len(rows), 'predictions': predictions,
                  'generation': {'enable_thinking': False, 'do_sample': False,
                                 'needs_max_new_tokens': needs_tokens, 'general_max_new_tokens': general_tokens}}
        write(out, report)
    print(out.name, json.dumps(report['summary']), flush=True)
    return report


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--token-file', type=Path)
    p.add_argument('--learning-rate', type=float, default=1e-5)
    p.add_argument('--rank', type=int, default=8)
    p.add_argument('--alpha', type=int, default=16)
    p.add_argument('--dropout', type=float, default=0.05)
    p.add_argument('--steps', type=int, default=128)
    p.add_argument('--checkpoints', default='32,64,96,128')
    p.add_argument('--batch-size', type=int, default=1)
    p.add_argument('--gradient-accumulation', type=int, default=8)
    p.add_argument('--warmup-steps', type=int, default=8)
    p.add_argument('--weight-decay', type=float, default=0.01)
    p.add_argument('--max-grad-norm', type=float, default=0.5)
    p.add_argument('--max-length', type=int, default=2048)
    p.add_argument('--needs-max-new-tokens', type=int, default=256)
    p.add_argument('--general-max-new-tokens', type=int, default=128)
    p.add_argument('--retention-coefficient', type=float, default=0.2,
                   help='Set 0 to disable original-base replay KL')
    p.add_argument('--retention-positions', type=int, default=8)
    p.add_argument('--retention-chunk-positions', type=int, default=2)
    p.add_argument('--seed', type=int, default=20261109)
    return p


def validate_args(a):
    positive = ('learning_rate', 'rank', 'alpha', 'steps', 'batch_size', 'gradient_accumulation',
                'max_grad_norm', 'max_length', 'needs_max_new_tokens', 'general_max_new_tokens',
                'retention_positions', 'retention_chunk_positions')
    numeric = positive + ('dropout', 'retention_coefficient', 'weight_decay', 'warmup_steps')
    if any(not math.isfinite(getattr(a, key)) for key in numeric):
        raise ValueError('Training hyperparameters must be finite')
    if any(getattr(a, key) <= 0 for key in positive):
        raise ValueError('Training and sampling limits must be positive')
    if not 0 <= a.dropout < 1 or a.retention_coefficient < 0 or a.weight_decay < 0 or a.warmup_steps < 0:
        raise ValueError('Invalid dropout, retention coefficient, weight decay or warmup')
    if a.max_length > 2048 or a.needs_max_new_tokens > 256 or a.general_max_new_tokens > 256:
        raise ValueError('V3 mobile/context budget exceeded')
    try:
        checkpoints = sorted({int(x) for x in a.checkpoints.split(',') if x.strip()})
    except ValueError as exc:
        raise ValueError('Checkpoints must be comma separated integer steps') from exc
    if any(x <= 0 for x in checkpoints):
        raise ValueError('Checkpoints must be positive')
    return sorted({x for x in checkpoints if x <= a.steps} | {a.steps})


def main():
    a = parser().parse_args()
    checkpoints = validate_args(a)
    a.out.mkdir(parents=True, exist_ok=False)
    if a.token_file:
        os.environ['HF_TOKEN'] = a.token_file.read_text().strip()
    os.environ['TOKENIZERS_PARALLELISM'] = 'false'
    import torch
    from transformers import AutoTokenizer, Trainer, TrainingArguments, TrainerCallback, set_seed
    from peft import LoraConfig, get_peft_model
    from datasets import Dataset
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA required; no GPU was started by this script')
    set_seed(a.seed)
    # Explicit allowlist: do not glob or hash sealed test/holdout files.
    paths = [a.data / 'train.jsonl', a.data / 'validation.jsonl']
    rows, dev = [read(path) for path in paths]
    for split, items in (('train', rows), ('validation', dev)):
        if not items or len({r['id'] for r in items}) != len(items):
            raise ValueError(f'Empty split or duplicate IDs: {split}')
    if {r['id'] for r in rows} & {r['id'] for r in dev}:
        raise ValueError('Train/development IDs overlap')
    if {json.dumps(r['prompt'], sort_keys=True, ensure_ascii=False) for r in rows} & {
            json.dumps(r['prompt'], sort_keys=True, ensure_ascii=False) for r in dev}:
        raise ValueError('Train/development prompts overlap')
    tok = AutoTokenizer.from_pretrained(BASE, revision=REVISION)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    encoded, manifest = encode_rows(tok, rows, a.max_length, a.retention_positions)
    if a.retention_coefficient > 0 and not any(x['retention_positions'] for x in encoded):
        raise ValueError('Retention enabled but training data has no replay rows')
    write(a.out / 'tokenization.json', {'count': len(encoded),
          'max_tokens': max(len(x['input_ids']) for x in encoded), 'examples': manifest})
    model = load_model()
    evaluation_args = dict(max_length=a.max_length, needs_tokens=a.needs_max_new_tokens,
                           general_tokens=a.general_max_new_tokens)
    baseline = evaluate(model, tok, dev, a.out / 'baseline-dev.json', **evaluation_args)
    targets = [name for name, _ in model.named_modules() if 'language_model' in name
               and name.rsplit('.', 1)[-1] in {'q_proj', 'v_proj'}]
    if not targets:
        raise RuntimeError('No text q/v attention LoRA targets')
    model = get_peft_model(model, LoraConfig(r=a.rank, lora_alpha=a.alpha, lora_dropout=a.dropout,
                          target_modules=targets, bias='none', task_type='CAUSAL_LM'))
    model.enable_input_require_grads()
    model.config.use_cache = False
    trainable = [name for name, param in model.named_parameters() if param.requires_grad]
    if not trainable or not all('lora_' in name for name in trainable):
        raise RuntimeError('Unexpected trainable base parameters or no LoRA parameters')
    settings = {key: str(value) if isinstance(value, Path) else value for key, value in vars(a).items()
                if key != 'token_file'}
    write(a.out / 'environment.json', {'model': BASE, 'revision': REVISION,
        'precision': 'BF16 frozen base; q/v text LoRA; no training quantization',
        'settings': settings, 'candidate_steps': checkpoints, 'targets': targets,
        'trainable_parameters': sum(p.numel() for p in model.parameters() if p.requires_grad),
        'gpu': torch.cuda.get_device_name(), 'cuda': torch.version.cuda,
        'packages': {k: importlib.metadata.version(k) for k in ('torch', 'transformers', 'peft', 'datasets', 'accelerate')},
        'component_sha256': {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                             for name in ('run_v3.py', 'v3_metrics.py', 'run_v2.py', 'run_pilot.py')},
        'dataset_sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
        'retention_objective': 'CE + coefficient * mean sampled-token forward KL(P(original frozen base)||P(adapter)); replay rows only; temperature=1',
        'retention_positions': 'Deterministic evenly spaced supervised completion target positions, causal-shifted; exact coordinates in tokenization.json',
        'retention_memory': 'One resident base; reference no_grad/eval before student; bounded sampled BF16 reference logits, position-chunked FP32 KL',
        'gate_rule': 'Before V3 evaluation: needs automatic proxy count strictly improves while exact tag count does not fall; all strict schemas/exact fields/evidence substrings/uncertainty proxies pass, paired general correctness and assessed format retained, source regression separately retained.',
        'selection_rule': 'Among eligible dev candidates maximize automatic proxy count then exact tag count; tie prefers earlier. Never auto promote.',
        'production_accepted': False, 'holdout_not_read': True})
    reports = []

    def selection(status, error=None):
        eligible = [r for r in reports if r.get('gate', {}).get('eligible')]
        selected = max(eligible, key=lambda r: (r['summary']['interpret']['correct'],
                       r['summary']['interpret']['tags_exact'], -r['step'])) if eligible else None
        write(a.out / 'selection.json', {'status': status, 'error': error, 'candidates': reports,
              'selected': selected, 'production_accepted': False, 'holdout_not_read': True})

    class Checkpoint(TrainerCallback):
        def on_step_end(self, args, state, control, **kwargs):
            if state.global_step not in checkpoints:
                return control
            dest = a.out / f'candidate-{state.global_step:03d}'
            dest.mkdir(exist_ok=False)
            entry = {'step': state.global_step, 'path': str(dest), 'status': 'saving'}
            reports.append(entry)
            try:
                model.save_pretrained(dest / 'adapter')
                tok.save_pretrained(dest / 'adapter')
                entry['artifact_sha256'] = {name: hashlib.sha256((dest / 'adapter' / name).read_bytes()).hexdigest()
                    for name in ('adapter_model.safetensors', 'adapter_config.json')}
                entry['status'] = 'adapter_saved'
                model.gradient_checkpointing_disable()
                model.config.use_cache = True
                report = evaluate(model, tok, dev, dest / 'validation.json', **evaluation_args)
                gate = paired_gate(baseline['predictions'], report['predictions'])
                write(dest / 'gate.json', gate)
                entry.update(status='evaluated', summary=report['summary'], gate=gate)
            except BaseException as exc:
                entry.update(status='failed', error=f'{type(exc).__name__}: {exc}')
                raise
            finally:
                model.config.use_cache = False
                model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
                model.train()
                selection('running')
            return control

    def collate(batch):
        length = max(len(x['input_ids']) for x in batch)
        values = {key: torch.tensor([x[key] + [pad] * (length - len(x[key])) for x in batch])
                  for key, pad in (('input_ids', tok.pad_token_id), ('attention_mask', 0), ('labels', -100))}
        values['retention_positions'] = torch.tensor([x['retention_positions'] + [-1] *
            (a.retention_positions - len(x['retention_positions'])) for x in batch])
        return values

    trainer = retention_trainer_class(Trainer)(model=model, train_dataset=Dataset.from_list(encoded),
        data_collator=collate, callbacks=[Checkpoint()], retention_coefficient=a.retention_coefficient,
        retention_chunk_positions=a.retention_chunk_positions,
        args=TrainingArguments(output_dir=str(a.out / 'trainer'), max_steps=a.steps,
            per_device_train_batch_size=a.batch_size, gradient_accumulation_steps=a.gradient_accumulation,
            learning_rate=a.learning_rate, warmup_steps=a.warmup_steps, lr_scheduler_type='cosine',
            weight_decay=a.weight_decay, max_grad_norm=a.max_grad_norm, bf16=True,
            gradient_checkpointing=True, gradient_checkpointing_kwargs={'use_reentrant': False},
            logging_steps=8, save_strategy='no', report_to='none', seed=a.seed,
            optim='adamw_torch', remove_unused_columns=False))
    started = time.time()
    status, error, metrics = 'failed', None, {}
    try:
        result = trainer.train()
        metrics = result.metrics
        status = 'complete'
    except BaseException as exc:
        status = 'interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed'
        error = f'{type(exc).__name__}: {exc}'
        # Preserve a failed/interrupted candidate without evaluating or promoting it.
        try:
            if trainer.state.global_step > 0:
                model.save_pretrained(a.out / 'recovery-adapter')
                tok.save_pretrained(a.out / 'recovery-adapter')
        except Exception as save_exc:
            error += f'; recovery save failed: {type(save_exc).__name__}: {save_exc}'
        raise
    finally:
        write(a.out / 'train-metrics.json', {**metrics, 'status': status, 'error': error,
              'completed_steps': trainer.state.global_step, 'wall_seconds_including_dev': time.time() - started,
              'peak_gpu_bytes': torch.cuda.max_memory_allocated(), 'retention': trainer.retention_stats})
        selection(status, error)
    print('V3_TRAINING_COMPLETE', flush=True)


if __name__ == '__main__':
    main()
