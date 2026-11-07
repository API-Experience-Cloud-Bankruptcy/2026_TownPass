"""V3 development proxies. Substring evidence and uncertainty markers are not semantic proof."""
import json
import re

TAGS = {'living', 'elder', 'study', 'family', 'health', 'disability', 'housing', 'work'}
FIELDS = {'age', 'region', 'is_student', 'household_type'}
KEYS = {'situationIds', 'candidateFields', 'uncertain', 'evidence'}


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def strict_json(text):
    def reject_constant(value):
        raise ValueError('Non-finite JSON number: ' + value)
    return json.loads(text.strip(), object_pairs_hook=_pairs, parse_constant=reject_constant)


def _strings(value):
    return isinstance(value, list) and all(isinstance(x, str) and x.strip() for x in value)


def _schema(actual):
    if not isinstance(actual, dict) or set(actual) != KEYS:
        return False
    if not all(_strings(actual[k]) for k in ('situationIds', 'uncertain', 'evidence')):
        return False
    tags = actual['situationIds']
    fields = actual['candidateFields']
    if len(tags) != len(set(tags)) or not set(tags) <= TAGS:
        return False
    if not isinstance(fields, dict) or not set(fields) <= FIELDS:
        return False
    return (('age' not in fields or type(fields['age']) is int
             and 0 <= fields['age'] <= 120)
            and ('region' not in fields or isinstance(fields['region'], str) and bool(fields['region'].strip()))
            and ('is_student' not in fields or type(fields['is_student']) is bool)
            and ('household_type' not in fields or fields['household_type'] in
                 ('low_income', 'mid_low_income', 'general')))


def _fields_equal(actual, expected):
    # Python otherwise equates True and 1, hiding a type regression.
    return (set(actual) == set(expected) and all(type(actual[k]) is type(expected[k])
            and actual[k] == expected[k] for k in actual))


def _uncertainty(actual, expected, row):
    present = bool(actual) == bool(expected)
    if not expected:
        return present, present
    joined = '\n'.join(actual)
    markers = row.get('uncertainty_markers')
    if markers:
        groups = [[x] if isinstance(x, str) else x for x in markers]
        if not all(isinstance(g, list) and g and all(isinstance(x, str) and x for x in g) for g in groups):
            raise ValueError('uncertainty_markers must contain nonempty strings or alternative groups')
        match = all(any(x in joined for x in group) for group in groups)
    else:
        topics = [('戶籍', ('戶籍', '戶口', '設籍')), ('申請人', ('申請人', '誰申請', '誰提出')),
                  ('年齡', ('年齡', '歲數', '歲')), ('家戶', ('家戶', '身分', '低收入')),
                  ('需求', ('需求', '協助', '生活情境'))]
        expected_text = '\n'.join(expected)
        groups = [terms for topic, terms in topics if topic in expected_text]
        ambiguity = ('不明', '未知', '不確定', '不清楚', '未確認', '尚未', '需確認',
                     '待確認', '請確認', '需要確認', '矛盾', '衝突', '不足', '未定', '未提供')
        match = bool(groups) and all(any(x in joined for x in group) for group in groups)
        match = match and any(x in joined for x in ambiguity)
    # These are conservative review flags, never a semantic correctness judgement.
    return present, bool(present and match)


def evaluate_answer(text, row):
    task = row['task']
    if task in {'general', 'replay'}:
        expected = row.get('expected')
        if expected is None:
            expected = row['completion'][0]['content']
        exact_mode = row.get('answer_type') == 'exact'
        if isinstance(expected, dict):
            if 'exact' in expected:
                exact_mode = True
                expected = expected['exact']
            elif 'choice' in expected:
                expected = expected['choice']
            else:
                raise ValueError('General expected must specify exact or choice')
        if not isinstance(expected, str):
            raise ValueError('General expected answer must be a string')
        answer = text.strip()
        mc = expected in {'A', 'B', 'C', 'D'} and not exact_mode
        match = re.fullmatch(r'(?:答案[是為：:\s]*)?([ABCD])(?:[。.)）])?', answer) if mc else None
        correct = bool(match and match.group(1) == expected) if mc else answer == expected.strip()
        format_regex = row.get('format_regex')
        if format_regex is not None and not isinstance(format_regex, str):
            raise ValueError('format_regex must be a string')
        assessed = bool(mc or format_regex is not None)
        strict = bool(re.fullmatch(r'[ABCD]', answer)) if mc else (
            bool(re.fullmatch(format_regex, answer)) if format_regex is not None else True)
        return {'correct': correct, 'strict': strict, 'format_assessed': assessed,
                'format_not_assessed': not assessed, 'exact': answer == expected.strip(),
                'scoring': 'multiple_choice' if mc else 'exact_string'}
    expected = row.get('expected')
    if expected is None:
        expected = strict_json(row['completion'][0]['content'])
    try:
        actual = strict_json(text)
        parsed = True
    except (ValueError, TypeError):
        actual = None
        parsed = False
    if task != 'interpret':
        schema = (isinstance(actual, dict) and set(actual) == {'answer', 'source_ids', 'verification_status'}
                  and isinstance(actual['answer'], str) and _strings(actual['source_ids'])
                  and isinstance(actual['verification_status'], str))
        source = bool(schema and actual['source_ids'] == expected['source_ids'])
        exact = bool(schema and actual == expected)
        return {'json_valid': parsed, 'schema_valid': bool(schema), 'strict': bool(schema),
                'source_correct': source, 'exact': exact, 'correct': exact}
    if not _schema(expected):
        raise ValueError('Invalid expected interpretation schema')
    schema = _schema(actual)
    tags = bool(schema and set(actual['situationIds']) == set(expected['situationIds']))
    fields = bool(schema and _fields_equal(actual['candidateFields'], expected['candidateFields']))
    present, markers = _uncertainty(actual['uncertain'], expected['uncertain'], row) if schema else (False, False)
    source_text = '\n'.join(m['content'] for m in row['prompt'] if m['role'] == 'user')
    grounded = bool(schema and (actual['evidence'] or not (actual['situationIds'] or actual['candidateFields']))
                    and all(x in source_text for x in actual['evidence']))
    review = bool(expected['uncertain'] or schema and actual['uncertain'])
    proxy = bool(schema and tags and fields and grounded and markers)
    return {'json_valid': parsed, 'schema_valid': schema, 'strict': schema, 'tags_exact': tags,
            'fields_exact': fields, 'critical_fields_correct': fields,
            'uncertainty_present_correct': present, 'uncertainty_markers_match': markers,
            'uncertainty_semantic_review_required': review, 'evidence_substring_grounded': grounded,
            'source_correct': grounded, 'automatic_proxy_pass': proxy, 'correct': proxy,
            'fully_correct': None, 'semantic_correctness_verified': False}


def summarize(predictions):
    result = {}
    for task in sorted({r['task'] for r in predictions}):
        rows = [r for r in predictions if r['task'] == task]
        result[task] = {'count': len(rows), **{key: sum(bool(r.get(key)) for r in rows)
            for key in ('correct', 'strict', 'tags_exact', 'fields_exact', 'evidence_substring_grounded',
                        'uncertainty_markers_match', 'uncertainty_semantic_review_required', 'format_not_assessed')}}
    return result


def paired_gate(base, tuned):
    def index(rows):
        result = {r['id']: r for r in rows}
        if len(result) != len(rows):
            raise ValueError('Paired gate rejects duplicate case IDs')
        return result
    baseline, candidate = index(base), index(tuned)
    if set(baseline) != set(candidate) or any(baseline[k]['task'] != candidate[k]['task'] for k in baseline):
        raise ValueError('Paired gate requires identical IDs and task assignments')
    needs = [k for k in baseline if baseline[k]['task'] == 'interpret']
    general = [k for k in baseline if baseline[k]['task'] in {'general', 'replay'}]
    source = [k for k in baseline if k not in needs and k not in general]
    lost = lambda ids, metric: [k for k in ids if baseline[k].get(metric) and not candidate[k].get(metric)]
    lost_general, lost_format = lost(general, 'correct'), lost(general, 'strict')
    lost_source = lost(source, 'correct')
    tags_improved = bool(needs) and sum(bool(candidate[k].get('tags_exact')) for k in needs) > sum(
        bool(baseline[k].get('tags_exact')) for k in needs)
    tags_not_worse = bool(needs) and sum(bool(candidate[k].get('tags_exact')) for k in needs) >= sum(
        bool(baseline[k].get('tags_exact')) for k in needs)
    proxy_improved = bool(needs) and sum(bool(candidate[k].get('automatic_proxy_pass', candidate[k].get('correct'))) for k in needs) > sum(
        bool(baseline[k].get('automatic_proxy_pass', baseline[k].get('correct'))) for k in needs)
    domain_improved = tags_not_worse and proxy_improved
    schema_all = bool(needs) and all(candidate[k].get('strict') for k in needs)
    fields_all = bool(needs) and all(candidate[k].get('fields_exact') for k in needs)
    evidence_all = bool(needs) and all(candidate[k].get('evidence_substring_grounded') for k in needs)
    uncertainty_all = bool(needs) and all(candidate[k].get('uncertainty_markers_match') for k in needs)
    general_ok = bool(general) and not lost_general and not lost_format
    return {'eligible': bool(domain_improved and schema_all and fields_all and evidence_all
                              and uncertainty_all and general_ok and not lost_source),
            'tags_improved': tags_improved, 'tags_not_worse': tags_not_worse,
            'automatic_proxy_improved': proxy_improved, 'domain_improved': domain_improved,
            'strict_schema_all': schema_all,
            'exact_fields_all': fields_all, 'evidence_substring_all': evidence_all,
            'uncertainty_proxy_all': uncertainty_all, 'general_no_observed_regression': general_ok,
            'lost_general_ids': lost_general, 'lost_general_strict_ids': lost_format,
            'general_format_not_assessed_ids': [k for k in general if candidate[k].get('format_not_assessed')],
            'source_cases': len(source), 'source_no_observed_regression': not lost_source,
            'lost_source_ids': lost_source, 'production_accepted': False,
            'semantic_review_required_ids': [k for k in needs if candidate[k].get('uncertainty_semantic_review_required')],
            'scope': 'Development proxies only. Evidence substrings do not prove entailment; uncertainty markers require semantic review. No broad capability or production acceptance claim.'}
