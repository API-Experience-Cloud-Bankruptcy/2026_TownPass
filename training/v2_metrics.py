"""Task correctness and paired retention gates, without assuming global intelligence."""
import json
import re
from run_pilot import score as pilot_score


def unwrap(text):
    text=text.strip()
    match=re.fullmatch(r'```(?:json)?\s*\n(.*?)\n```',text,re.DOTALL)
    return match.group(1) if match else text


def evaluate_answer(text,row):
    if row['task']=='general':
        # Accept a bare option or an explicit "答案：B"; never scan arbitrary prose for a letter.
        match=re.fullmatch(r'(?:答案[是為：:\s]*)?([ABCD])(?:[。.)）])?',text.strip())
        return {'correct': bool(match and match.group(1)==row['expected']),
                'strict': bool(re.fullmatch(r'[ABCD]',text.strip()))}
    if row['task']=='interpret':
        expected=row.get('expected') or json.loads(row['completion'][0]['content'])
        canonical={**row,'completion':[{'content':json.dumps(expected,ensure_ascii=False)}]}
        strict=pilot_score(text,canonical)
        scores=pilot_score(unwrap(text),canonical)
        try: actual=json.loads(unwrap(text))
        except (ValueError,TypeError):actual=None
        uncertain_present=(scores['schema_valid'] and bool(actual['uncertain'])==bool(expected['uncertain']))
        uncertain_exact=(scores['schema_valid'] and set(actual['uncertain'])==set(expected['uncertain']))
        correct=bool(scores.get('tags_exact') and scores.get('fields_exact') and uncertain_exact and scores['source_correct'])
        return {**scores,'strict':strict['schema_valid'],'uncertainty_present_correct':bool(uncertain_present),
                'uncertainty_exact_match':bool(uncertain_exact),'evidence_grounding_only':scores['source_correct'],
                'correct':correct,'critical_fields_correct':bool(scores.get('fields_exact'))}
    scores=pilot_score(unwrap(text),row)
    return {**scores,'strict':pilot_score(text,row)['schema_valid'],'correct':scores['exact']}


def summarize(predictions):
    out={}
    for task in sorted({r['task'] for r in predictions}):
        items=[r for r in predictions if r['task']==task]
        out[task]={'count':len(items),'correct':sum(bool(r['correct']) for r in items),
                   'strict':sum(bool(r['strict']) for r in items)}
        if task=='interpret':
            out[task]['fields_correct']=sum(bool(r['critical_fields_correct']) for r in items)
            out[task]['uncertainty_correct']=sum(bool(r['uncertainty_present_correct']) for r in items)
            out[task]['uncertainty_exact']=sum(bool(r.get('uncertainty_exact_match')) for r in items)
    return out


def paired_gate(base,tuned,*,require_perfect_fields=True):
    baseline={r['id']:r for r in base}
    candidate={r['id']:r for r in tuned}
    if set(baseline)!=set(candidate):raise ValueError('Paired gate requires identical case IDs')
    lost_general=[key for key,r in baseline.items() if r['task']=='general' and r['correct'] and not candidate[key]['correct']]
    lost_general_strict=[key for key,r in baseline.items() if r['task']=='general' and r['strict'] and not candidate[key]['strict']]
    lost_source=[key for key,r in baseline.items() if r['task'] not in {'general','interpret'}
                 and r['correct'] and not candidate[key]['correct']]
    b=summarize(base);t=summarize(tuned)
    general_ok=not lost_general and not lost_general_strict and t['general']['correct']>=b['general']['correct']
    domain_ok=(t['interpret']['correct']>=b['interpret']['correct'] and
               (t['interpret']['correct']>b['interpret']['correct'] or
                t['interpret']['strict']>b['interpret']['strict']))
    schema_ok=t['interpret']['strict']==t['interpret']['count']
    field_ok=(t['interpret']['fields_correct']==t['interpret']['count']) if require_perfect_fields else t['interpret']['fields_correct']>=b['interpret']['fields_correct']
    uncertainty_ok=t['interpret']['uncertainty_exact']==t['interpret']['count']
    return {'general_no_observed_regression':general_ok,'lost_general_ids':lost_general,
            'lost_general_strict_ids':lost_general_strict,'uncertainty_exact_all':uncertainty_ok,
            'lost_source_ids':lost_source,
            'domain_improved':domain_ok,'strict_schema_all':schema_ok,'critical_fields_gate':field_ok,
            'eligible':general_ok and domain_ok and schema_ok and field_ok and uncertainty_ok and not lost_source,
            'scope':'This small paired suite cannot prove no broad capability loss.'}
