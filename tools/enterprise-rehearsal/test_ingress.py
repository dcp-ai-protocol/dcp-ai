"""Run using the isolated Python consumer, with -I."""
import base64
import importlib.util
import json
from pathlib import Path
import sys

assert sys.flags.isolated == 1
spec = importlib.util.spec_from_file_location('rehearsal_ingress', Path(__file__).with_name('ingress_python.py'))
ingress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingress)
corpus = json.loads(Path(sys.argv[1]).read_text())
assert corpus['format'] == 'mp05-application-ingress-cases-v1'
assert len(corpus['cases']) == 20
results, ids = [], set()
for item in corpus['cases']:
    assert item['id'] not in ids
    ids.add(item['id'])
    try:
        ingress.parse_request(base64.b64decode(item['bytes_b64'], validate=True), item['max_bytes'])
        observed = {'accepted': True, 'reason': None}
    except ingress.IngressError as exc:
        observed = {'accepted': False, 'reason': exc.reason}
        assert exc.status == (413 if exc.reason == 'BODY_BUDGET' else 400)
    assert observed == item['expected'], (item['id'], observed, item['expected'])
    results.append({'id': item['id'], 'observed': observed})
print(json.dumps({'status': 'pass', 'cases': len(results), 'results': results}, indent=2))
