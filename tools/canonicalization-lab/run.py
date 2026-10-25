"""Runner of the canonicalization design corpus: integrity, freshness, completeness and validity
checks, the design model on every case (the 87 r2 cases by reference included), and negative
controls that must fail. Experimental tool: its own CI workflow (.github/workflows/canonicalization-lab.yml)
runs this design model, but it is not an SDK test, a conformance check or a normative use of the candidate.

    python3 tools/canonicalization-lab/run.py --out RESULTS.json            # corpus run
    python3 tools/canonicalization-lab/run.py --controls --out CONTROLS.json # negative controls

Exit codes: 0 everything as expected, 1 a case or control differs, 2 the data is invalid.
"""
import argparse
import ast
import copy
import hashlib
import json
import pathlib
import re
import signal
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CORPUS = ROOT / 'docs/proposals/canonicalization-candidate/corpus.json'
DESIGN = ROOT / 'docs/proposals/canonicalization-candidate/README.md'
sys.path.insert(0, str(HERE))
import model  # noqa: E402

RESULTS = {'accept', 'accept_v2', 'v1_path', 'reject'}
CLASSES = {'BOM', 'UTF8_INVALID', 'SYNTAX', 'SURROGATE_UNPAIRED', 'DUPLICATE_KEY', 'NUMBER_NOT_INTEGER',
           'NUMBER_OUT_OF_RANGE', 'DEPTH_EXCEEDED', 'TRANSPORT_INVALID', 'TRANSPORT_AMBIGUOUS', 'PROFILE_UNKNOWN',
           'PROFILE_NOT_ACCEPTED', 'POLICY_INVALID', 'COMMITMENT_MISMATCH'}
EXPECTED_KEYS = {'result', 'class', 'offset', 'detail', 'profile', 'attempts', 'warnings', 'canonical_sha256',
                 'manifest_sha256', 'unit', 'transport_offset'}
CASE_KEYS = {'id', 'group', 'mode', 'transport', 'input_json', 'input_hex', 'input_sha256', 'expected', 'why',
             'policy', 'historical', 'options', 'maps_original', 'same_input_as'}
HISTORICAL = {'fails', 'absent', model.V1, model.V2, 'other'}
SCANNER_CLASSES = {'BOM', 'UTF8_INVALID', 'SYNTAX', 'SURROGATE_UNPAIRED', 'DUPLICATE_KEY', 'NUMBER_NOT_INTEGER',
                   'NUMBER_OUT_OF_RANGE', 'DEPTH_EXCEEDED'}
HEX64 = re.compile(r'[0-9a-f]{64}')
VALUE_PAIRS = [(a, b) for a in ('sur', 'dup', 'frac', 'range', 'depth') for b in ('sur', 'dup', 'frac', 'range', 'depth') if a != b]
CASE_SECONDS = 20
# What each model mutant must break, exactly: the cases of its own rule and nothing else.
MUTANTS = {
    'class-order': ['m-pair-depth-then-dup', 'm-pair-depth-then-frac', 'm-pair-depth-then-range', 'm-pair-depth-then-sur',
                    'm-pair-dup-then-sur', 'm-pair-frac-then-dup', 'm-pair-frac-then-sur', 'm-pair-range-then-dup',
                    'm-pair-range-then-frac', 'm-pair-range-then-sur', 'm-value-then-dup-key'],
    'syntax-not-first': ['m-depth-then-syntax', 'm-dup-then-syntax', 'm-frac-then-syntax', 'm-range-then-syntax',
                         'm-sur-then-syntax', 'm-surrogate-then-trailing-data', 'm-syntax-inside-deep',
                         'm-unterminated-after-surrogate'],
    'fallback-v1': ['mig-chain-break', 'mig-copied-v1-hash', 'mig-payload-hash', 'mig-relabel-v1-to-v2'],
    'transport-depth': ['b-v2-unit-depth-64-envelope', 'b-v2-unit-depth-65-envelope', 'd-unit-64-envelope', 'd-unit-65-envelope'],
}


class Invalid(Exception):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def case_bytes(case):
    if ('input_json' in case) == ('input_hex' in case):
        raise Invalid(f'{case.get("id")}: exactly one of input_json / input_hex')
    return case['input_json'].encode('utf-8') if 'input_json' in case else bytes.fromhex(case['input_hex'])


def validate(corpus, r2, r2_bytes):
    """Integrity, validity and completeness. Raises Invalid with every problem found."""
    problems = []
    original = corpus.get('original_corpus', {})
    if original.get('sha256') != sha(r2_bytes):
        problems.append('r2 corpus hash differs from original_corpus.sha256')
    referenced = [(c['id'], c['input_sha256']) for c in original.get('cases', [])]
    actual = [(c['id'], c['input_sha256']) for c in r2['cases']]
    if referenced != actual or len(actual) != 87:
        problems.append('r2 case ids or input hashes differ from the reference list (or are not 87)')
    for c in r2['cases']:
        if sha(case_bytes(c)) != c['input_sha256']:
            problems.append(f'r2 {c["id"]}: input bytes do not match input_sha256')
    seen = set(c['id'] for c in r2['cases'])
    r2_inputs = {case_bytes(c): c['id'] for c in r2['cases']}
    inputs = {}
    for c in corpus.get('cases', []):
        cid = c.get('id')
        if not isinstance(cid, str) or not cid:
            problems.append(f'case without an id: {str(c)[:80]}')
            continue
        if cid in seen:
            problems.append(f'{cid}: duplicate id')
        seen.add(cid)
        extra = set(c) - CASE_KEYS
        if extra:
            problems.append(f'{cid}: unknown fields {sorted(extra)}')
        try:
            data = case_bytes(c)
        except (Invalid, ValueError) as e:
            problems.append(f'{cid}: {e}')
            continue
        if sha(data) != c.get('input_sha256'):
            problems.append(f'{cid}: input bytes do not match input_sha256')
        if c.get('mode') == 'document' and c.get('transport') == 'bare' and data in r2_inputs:
            problems.append(f'{cid}: repeats the input of r2 {r2_inputs[data]}')
        if c.get('mode') not in ('document', 'bundle') or c.get('transport') not in ('bare', 'envelope'):
            problems.append(f'{cid}: invalid mode or transport')
        key = (c.get('mode'), c.get('transport'), data, json.dumps(c.get('policy')), c.get('historical'),
               json.dumps(c.get('options'), sort_keys=True))
        if key in inputs:
            other = inputs[key]
            if c.get('same_input_as') != other[0] or c.get('expected') != other[1]:
                problems.append(f'{cid}: same input and parameters as {other[0]} (undeclared, or other expectations)')
        else:
            inputs[key] = (cid, c.get('expected'))
        e = c.get('expected')
        if not isinstance(e, dict) or e.get('result') not in RESULTS:
            problems.append(f'{cid}: expected.result is not one of {sorted(RESULTS)}')
            continue
        if set(e) - EXPECTED_KEYS:
            problems.append(f'{cid}: unknown expected fields {sorted(set(e) - EXPECTED_KEYS)}')
        if (e['result'] == 'reject') != ('class' in e) or ('class' in e and e['class'] not in CLASSES):
            problems.append(f'{cid}: a reject needs exactly one known class, other results none')
        if e['result'] == 'accept' and (c.get('mode') != 'document' or 'canonical_sha256' not in e):
            problems.append(f'{cid}: accept is a document result with canonical_sha256')
        if e['result'] in ('accept_v2', 'v1_path') and c.get('mode') != 'bundle':
            problems.append(f'{cid}: {e["result"]} is a bundle result')
        if 'historical' in c and c['historical'] not in HISTORICAL:
            problems.append(f'{cid}: invalid historical')
        if c.get('mode') == 'bundle' and 'policy' not in c and e.get('detail') != 'MISSING':
            problems.append(f'{cid}: a bundle case states its policy')
        if set(c.get('options', {})) - {'depth_scope'}:
            problems.append(f'{cid}: unknown options')
        if not c.get('why'):
            problems.append(f'{cid}: no why')
        mapping = c.get('maps_original')
        if mapping and r2[mapping['list']][mapping['index']] != mapping['r2']:
            problems.append(f'{cid}: maps_original does not match the r2 entry')
    ids = {c.get('id') for c in corpus.get('cases', [])}
    for a, b in VALUE_PAIRS:
        if f'm-pair-{a}-then-{b}' not in ids:
            problems.append(f'coverage: missing m-pair-{a}-then-{b}')
    mapped = {(c['maps_original']['list'], c['maps_original']['index']) for c in corpus.get('cases', []) if c.get('maps_original')}
    want = {('profile_selection_cases', i) for i in range(len(r2['profile_selection_cases']))} | \
           {('policy_cases', i) for i in range(len(r2['policy_cases']))}
    if mapped != want:
        problems.append('coverage: every r2 selection and policy case must be mapped once')
    covered = {c['expected'].get('class') for c in corpus.get('cases', []) if isinstance(c.get('expected'), dict)}
    if CLASSES - covered:
        problems.append(f'coverage: classes never expected {sorted(CLASSES - covered)}')
    groups = {c.get('group') for c in corpus.get('cases', [])}
    for group in ('multi', 'number', 'depth', 'transport', 'transport-multi', 'selection', 'ingress', 'historical',
                  'policy', 'configuration', 'migration'):
        if group not in groups:
            problems.append(f'coverage: no {group} case')
    for revision in corpus.get('expectation_revisions', []):
        if not {'id', 'r2_expected', 'design_expected', 'reason'} <= set(revision):
            problems.append(f'expectation revision without id/r2_expected/design_expected/reason: {revision}')
    if problems:
        raise Invalid('\n'.join(problems))


def independent_generator():
    """The generator must not import the model it is meant to test."""
    tree = ast.parse((HERE / 'generate_corpus.py').read_text())
    for node in ast.walk(tree):
        names = [a.name for a in node.names] if isinstance(node, (ast.Import, ast.ImportFrom)) else []
        module = node.module if isinstance(node, ast.ImportFrom) else None
        if 'model' in names or module == 'model':
            return False
    return True


def fresh(corpus_bytes):
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / 'corpus.json'
        subprocess.run([sys.executable, '-I', str(HERE / 'generate_corpus.py'), str(out)], check=True,
                       capture_output=True, timeout=120)
        return out.read_bytes() == corpus_bytes


def alarm(_signum, _frame):
    raise TimeoutError(f'case took more than {CASE_SECONDS} s')


def run_case(data, **kwargs):
    signal.signal(signal.SIGALRM, alarm)
    signal.alarm(CASE_SECONDS)
    try:
        return model.evaluate(data, **kwargs)
    except Exception as e:  # a model failure is reported as such, never as a rejection of the data
        return {'result': 'MODEL_ERROR', 'error': f'{type(e).__name__}: {e}'}
    finally:
        signal.alarm(0)


def result_problems(got, mode):
    """Why an ACTUAL result is not a valid state, whatever was expected; [] when it is valid. Shared by
    the corpus run and every strict control."""
    result = got.get('result')
    if result not in RESULTS:
        return [f'result {result!r} is not a valid state' + (f' ({got["error"]})' if 'error' in got else '')]
    problems = []
    if result == 'reject' and got.get('class') not in CLASSES:
        problems.append(f'reject with unknown class {got.get("class")!r}')
    if result != 'reject' and 'class' in got:
        problems.append(f'{result} carries a class')
    if result == 'accept' and not (mode == 'document' and isinstance(got.get('canonical_sha256'), str)
                                   and HEX64.fullmatch(got['canonical_sha256'])):
        problems.append('accept needs document mode and a canonical_sha256')
    if result in ('accept_v2', 'v1_path') and mode != 'bundle':
        problems.append(f'{result} outside bundle mode')
    # Format and state only. Design properties (one profile, no retry) are checked by the expectations.
    digest = got.get('manifest_sha256')
    if result == 'accept_v2' and not (got.get('profile') == model.V2 and isinstance(digest, str)
                                      and digest.startswith('sha256:') and HEX64.fullmatch(digest[7:])):
        problems.append('accept_v2 needs profile dcp-jcs-v2 and a manifest_sha256')
    if result == 'v1_path' and got.get('profile') != model.V1:
        problems.append('v1_path needs profile dcp-jcs-v1')
    attempts = got.get('attempts', [])
    if not (isinstance(attempts, list) and all(a in model.KNOWN_PROFILES for a in attempts)):
        problems.append(f'attempts {attempts!r} is not a list of known profiles')
    for warning in got.get('warnings', []):
        if not (isinstance(warning, dict) and warning.get('class') in SCANNER_CLASSES and isinstance(warning.get('offset'), int)):
            problems.append(f'invalid warning {warning!r}')
    return problems


def run_corpus(corpus, r2):
    mismatches, outcomes = [], {}
    revisions = {r['id']: r for r in corpus.get('expectation_revisions', [])}
    for c in r2['cases']:
        got = run_case(case_bytes(c))
        want = {'result': 'accept', 'canonical_sha256': c['canonical_sha256']} if c['expected'] == 'accept' \
            else {'result': 'reject', 'class': c['reject_class']}
        if c['id'] in revisions:
            want = revisions[c['id']]['design_expected']
        diff = {k: (want[k], got.get(k)) for k in want if got.get(k) != want[k]}
        problems = result_problems(got, 'document')
        outcomes[c['id']] = {'source': 'r2', 'got': got, 'valid': not problems, 'problems': problems,
                             'pass': not diff and not problems}
        if diff:
            mismatches.append({'id': c['id'], 'differences': diff})
    for c in corpus['cases']:
        kwargs = {'mode': c['mode'], 'transport': c['transport'], 'historical': c.get('historical')}
        if 'policy' in c:
            kwargs['policy'] = c['policy']
        kwargs.update(c.get('options', {}))
        got = run_case(case_bytes(c), **kwargs)
        diff = {k: (v, got.get(k)) for k, v in c['expected'].items() if got.get(k) != v}
        problems = result_problems(got, c['mode'])
        outcomes[c['id']] = {'source': 'design', 'got': got, 'valid': not problems, 'problems': problems,
                             'pass': not diff and not problems}
        if diff:
            mismatches.append({'id': c['id'], 'differences': diff})
    return mismatches, outcomes


def hashes():
    files = {p: ROOT / p for p in ('tools/canonicalization-lab/model.py', 'tools/canonicalization-lab/generate_corpus.py',
                                    'tools/canonicalization-lab/run.py', 'docs/proposals/canonicalization-candidate/corpus.json',
                                    'docs/proposals/canonicalization-candidate/baseline-corpus.json')}
    if DESIGN.exists():
        files['docs/proposals/canonicalization-candidate/README.md'] = DESIGN
    return {p: sha(f.read_bytes()) for p, f in files.items()}


def controls(corpus, r2, r2_bytes, corpus_bytes):
    """Each control weakens the data or the model on purpose; each must be caught."""
    out = {}

    def caught_invalid(mutated, rule):
        """Caught only when validation fails for the rule the control breaks."""
        try:
            validate(mutated, r2, r2_bytes)
            return False, ''
        except Invalid as e:
            lines = [line for line in str(e).splitlines() if rule in line]
            return bool(lines), (lines or str(e).splitlines())[0]

    flipped = copy.deepcopy(corpus)
    targets = ['m-pair-dup-then-frac', 'o-sel-02', 'x-max-sci-padded']
    for c in flipped['cases']:
        if c['id'] in targets:
            c['expected'] = {'result': 'reject', 'class': 'SYNTAX'} if c['expected']['result'] != 'reject' \
                else dict(c['expected'], **{'class': 'NUMBER_NOT_INTEGER'})
    out['three-flipped-expectations'] = strict_run(flipped, r2, None, targets)
    by_id = lambda k, cid: next(c for c in k['cases'] if c['id'] == cid)  # noqa: E731
    for name, rule, mutate in [
        ('invalid-result-state', 'expected.result is not one of', lambda k: k['cases'][0]['expected'].update(result='maybe')),
        ('unknown-class', 'a reject needs exactly one known class', lambda k: k['cases'][0]['expected'].update({'class': 'NOT_A_CLASS'})),
        ('duplicate-id', 'duplicate id', lambda k: k['cases'].append(dict(copy.deepcopy(k['cases'][1]), input_json='[7]', input_sha256=sha(b'[7]')))),
        ('duplicate-r2-id', 'n-safe-max: duplicate id', lambda k: k['cases'][1].update(id='n-safe-max')),
        ('input-hash', 'do not match input_sha256', lambda k: k['cases'][2].update(input_sha256='0' * 64)),
        ('missing-pair-coverage', 'coverage: missing m-pair-sur-then-dup', lambda k: k['cases'].pop(0)),
        ('r2-reference', 'r2 corpus hash differs', lambda k: k['original_corpus'].update(sha256='0' * 64)),
        ('missing-why', 'no why', lambda k: k['cases'][3].pop('why')),
        ('bundle-without-policy', 'states its policy', lambda k: by_id(k, 'b-v2-escaped-key').pop('policy')),
        ('undeclared-same-input', 'undeclared', lambda k: by_id(k, 'o-pol-2').pop('same_input_as')),
        ('revision-without-reason', 'expectation revision without', lambda k: k['expectation_revisions'].append({'id': 'n-safe-max'})),
        ('repeats-r2-input', 'repeats the input of r2', lambda k: by_id(k, 'x-half').update(
            input_json='{"n":9007199254740991}', input_sha256=sha(b'{"n":9007199254740991}'))),
        ('unknown-case-field', 'unknown fields', lambda k: k['cases'][4].update(note='x')),
        ('bad-historical', 'invalid historical', lambda k: by_id(k, 'b-bom-v2-parser-fails').update(historical='repairs')),
    ]:
        mutated = copy.deepcopy(corpus)
        mutate(mutated)
        caught, reason = caught_invalid(mutated, rule)
        out[name] = {'caught': caught, 'reason': reason}
    model.MUTATION = 'crash'
    try:
        mismatches, outcomes = run_corpus(corpus, r2)
    finally:
        model.MUTATION = None
    errors = sum(o['got'].get('result') == 'MODEL_ERROR' for o in outcomes.values())
    out['model-failure-is-not-a-rejection'] = {'caught': errors == len(outcomes) == len(mismatches),
                                               'model_errors': errors, 'cases': len(outcomes)}
    stale = corpus_bytes + b' '  # any byte off the generator's output
    out['stale-corpus'] = {'caught': not fresh(stale)}
    for mutation, expected in MUTANTS.items():
        out[f'model-mutant-{mutation}'] = strict_run(corpus, r2, mutation, expected)
    # A mutant that only crashes must not pass as caught: the campaign is invalid instead.
    for mutation in ('crash', 'crash-bundle'):
        result = strict_run(corpus, r2, mutation, MUTANTS['class-order'])
        out[f'infrastructure-failure-invalidates-{mutation}'] = dict(result, caught=not result['caught'])
    # Exactly the class-order cases fail, but with a class that is not a valid state: invalidated too.
    result = strict_run(corpus, r2, 'class-order-invalid-class', MUTANTS['class-order'])
    out['invalid-class-invalidates-mutant'] = dict(
        result, caught=not result['caught'] and result['mismatches'] == sorted(MUTANTS['class-order'])
        and result['invalid_results'] == len(MUTANTS['class-order']))
    return out


def strict_run(corpus, r2, mutation, expected_ids):
    """Caught only if every case ran, every result is a valid state (no MODEL_ERROR, no timeout), and
    the mismatches are exactly `expected_ids`: the pertinent cases fail and every other case passes."""
    model.MUTATION = mutation
    try:
        mismatches, outcomes = run_corpus(corpus, r2)
    finally:
        model.MUTATION = None
    all_ids = sorted([c['id'] for c in r2['cases']] + [c['id'] for c in corpus['cases']])
    complete = sorted(outcomes) == all_ids
    invalid = sorted(i for i, o in outcomes.items() if not o['valid'])
    got = sorted(m['id'] for m in mismatches)
    return {'caught': complete and not invalid and got == sorted(expected_ids), 'complete': complete,
            'invalid_results': len(invalid), 'mismatches': got, 'expected_mismatches': sorted(expected_ids)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', default=str(CORPUS))
    parser.add_argument('--out', required=True)
    parser.add_argument('--controls', action='store_true')
    args = parser.parse_args()
    out = pathlib.Path(args.out)
    if out.exists():
        sys.exit(f'{out} exists: write evidence to a new path')
    corpus_bytes = pathlib.Path(args.corpus).read_bytes()
    corpus = json.loads(corpus_bytes)
    r2_path = ROOT / corpus['original_corpus']['path']
    r2_bytes = r2_path.read_bytes()
    r2 = json.loads(r2_bytes)
    read = pathlib.Path(args.corpus).resolve()
    shown = str(read.relative_to(ROOT)) if read.is_relative_to(ROOT) else str(read)
    report = {'python': sys.version.split()[0], 'corpus_read': {'path': shown, 'sha256': sha(corpus_bytes)},
              'r2_read': {'path': str(r2_path.relative_to(ROOT)), 'sha256': sha(r2_bytes)}, 'hashes': hashes()}
    try:
        validate(corpus, r2, r2_bytes)
    except Invalid as e:
        report['invalid'] = str(e).splitlines()
        out.write_text(json.dumps(report, indent=1) + '\n')
        print('INVALID DATA:\n' + str(e))
        sys.exit(2)
    report['generator_independent_of_model'] = independent_generator()
    report['corpus_fresh'] = fresh(corpus_bytes)
    if args.controls:
        report['controls'] = controls(corpus, r2, r2_bytes, corpus_bytes)
        ok = all(c['caught'] for c in report['controls'].values())
        for name, c in report['controls'].items():
            print(('CAUGHT  ' if c['caught'] else 'MISSED  ') + name)
    else:
        mismatches, outcomes = run_corpus(corpus, r2)
        errors = sorted(i for i, o in outcomes.items() if o['got'].get('result') == 'MODEL_ERROR')
        invalid = sorted(i for i, o in outcomes.items() if not o['valid'])
        report.update(r2_cases=len(r2['cases']), design_cases=len(corpus['cases']), mismatches=mismatches,
                      model_errors=errors, invalid_results=invalid, passed=sum(o['pass'] for o in outcomes.values()),
                      total=len(outcomes), outcomes=outcomes)
        ok = not mismatches and not invalid
        print(f'{report["passed"]}/{report["total"]} cases as expected ({len(r2["cases"])} r2 + {len(corpus["cases"])} design)')
        for m in mismatches[:20]:
            print('MISMATCH', m['id'], m['differences'])
    ok = ok and report['generator_independent_of_model'] and report['corpus_fresh']
    print(f'generator independent of the model: {report["generator_independent_of_model"]}; corpus fresh: {report["corpus_fresh"]}')
    out.write_text(json.dumps(report, indent=1, ensure_ascii=True) + '\n')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
