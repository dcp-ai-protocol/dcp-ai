"""Generator of tests/interop/v2/ed25519_ped1_vectors.json (MP-02 F5a). Review tooling, never production crypto.

Builds the P-ED-1 vectors of docs/reviews/mp02-ed25519-implementation-design.md (v0.2.1, § 5) with the affine
arithmetic of tools/ed25519-review/check_equations_independent.py, loaded without running it. The scalars are
public and synthetic (SHA-512 of fixed labels); no real key is generated or kept. Every expectation is a predicate of
this model; no SDK is used. tools/ed25519-review/check_ped1_vectors.py re-evaluates every case with its own
arithmetic.

Usage, from the repository root: python3 -I tools/ed25519-review/generate_ped1_vectors.py [OUT]
OUT defaults to tests/interop/v2/ed25519_ped1_vectors.json. An existing OUT with other bytes is never overwritten.
"""
import ast
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / 'tools/ed25519-review/check_equations_independent.py'
HISTORICAL = ROOT / 'tools/ed25519-review/corpus.json'
DEFAULT_OUT = ROOT / 'tests/interop/v2/ed25519_ped1_vectors.json'

# The model's constants and functions only (imports, defs and the P, L, D, IDENTITY, B assignments).
_tree = ast.parse(MODEL.read_text())
_names = {'P', 'L', 'D', 'IDENTITY', 'B'}
_nodes = [n for n in _tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef))
          or isinstance(n, ast.Assign) and all(isinstance(t, ast.Name) and t.id in _names for t in n.targets)]
_ns = {}
exec(compile(ast.Module(body=_nodes, type_ignores=[]), str(MODEL), 'exec'), _ns)
P, L, IDENTITY, B = _ns['P'], _ns['L'], _ns['IDENTITY'], _ns['B']
point, plus, times = _ns['point'], _ns['plus'], _ns['times']

# Codex review fixture ped1-mixed-a-and-r-cancel-reduced, copied by bytes
# (.claude/mp02-20261107/f5-mixed-a-and-r-positive.json, SHA-256 8f6bea81...): A = 7B + T, R = 11B + T.
MIXED_A_AND_R = {
    'message_hex': '6463702d706564312d696e646570656e64656e742f6d697865642d612d616e642d722f36',
    'public_key_hex': 'e9b2fe981587efae6478f48ba1fa60cec6126d0e26dde72a0a24f640dcd783e5',
    'signature_hex': 'c891dd2fc0ca87a7460193895e046a914c11b66fdffa8e6b7c3ba83138499c70'
                     '5632cbddcd3a23440bcfe74ad2a7d7145a4374736a7c1fccd40a1105062b2205',
}
SEARCH_BOUND = 4096


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def challenge(r_bytes, a_bytes, msg):
    return int.from_bytes(hashlib.sha512(r_bytes + a_bytes + msg).digest(), 'little')


def scalar(label):
    n = int.from_bytes(hashlib.sha512(b'dcp-ped1/' + label.encode()).digest(), 'little') % L
    assert n != 0
    return n


def encode(p):
    x, y = p
    return (y | ((x & 1) << 255)).to_bytes(32, 'little')


def neg(p):
    x, y = p
    return ((-x) % P, y)


def decode(raw):
    """The model's lenient decoding: y mod p, any sign bit with x = 0; None when y is not on the curve."""
    try:
        return point(raw)
    except (AssertionError, ValueError):
        return None


def canonical_rule(raw):
    """Condition 2 on bytes: y < p, and no sign bit when x = 0 (y = 1 or y = p - 1)."""
    y = int.from_bytes(raw, 'little') & ((1 << 255) - 1)
    return y < P and not (raw[31] >> 7 and y in (1, P - 1))


# E[8]: [L]Q has order dividing 8 for every point Q; one of order 8 generates the cyclic group E[8].
def _order8_generator():
    for seed in range(2, 200):
        q = decode(seed.to_bytes(32, 'little'))
        if q is None:
            continue
        t = times(L, q)
        if times(4, t) != IDENTITY:
            return t
    raise AssertionError('no point of order 8 found')


T8 = _order8_generator()
E8 = [times(i, T8) for i in range(8)]
SMALL_ORDER = sorted(encode(t) for t in E8)
assert len(set(SMALL_ORDER)) == 8 and all(times(8, t) == IDENTITY for t in E8)


def order(t):
    return next(n for n in (1, 2, 4, 8) if times(n, t) == IDENTITY)


def label(t):
    """A unique name for a point of E[8]: its order and the first 4 and last bytes of its encoding."""
    e = encode(t).hex()
    return f'order-{order(t)}-{e[:8]}-{e[-2:]}'


def small_order(raw):
    p = decode(raw)
    return p is not None and encode(p) in SMALL_ORDER


CONDITIONS = ('s_range', 'a_encoding', 'r_encoding', 'a_small_order', 'r_small_order', 'equation')


def predicates(pk, sig, msg):
    """Every predicate of design § 5 over the exact bytes, and the conditions that fail."""
    out = {'lengths_valid': len(pk) == 32 and len(sig) == 64}
    if not out['lengths_valid']:
        return {**out, 'accept': False, 'failing': ['lengths'], 'kind': 'length'}
    r_bytes, s = sig[:32], int.from_bytes(sig[32:], 'little')
    a, r = decode(pk), decode(r_bytes)
    k_full = challenge(r_bytes, pk, msg)
    k = k_full % L
    both = a is not None and r is not None
    lhs = times(s, B)
    out.update({
        's_below_l': s < L,
        'a_decodes': a is not None,
        'r_decodes': r is not None,
        'a_canonical': canonical_rule(pk),
        'r_canonical': canonical_rule(r_bytes),
        'a_small_order': small_order(pk),
        'r_small_order': small_order(r_bytes),
        'equation_points': both and lhs == plus(r, times(k, a)),
        'equation_full_challenge': both and lhs == plus(r, times(k_full, a)),
        'equation_cofactored': both and times(8, lhs) == times(8, plus(r, times(k, a))),
        'bytes_match': a is not None and encode(plus(lhs, neg(times(k, a)))) == r_bytes,
    })
    failing = [c for c, ok in zip(CONDITIONS, (
        out['s_below_l'], out['a_decodes'] and out['a_canonical'], out['r_decodes'] and out['r_canonical'],
        not out['a_small_order'], not out['r_small_order'], out['equation_points'])) if not ok]
    out['accept'] = not failing
    out['failing'] = failing
    out['kind'] = 'accept' if not failing else 'isolated' if len(failing) == 1 else 'combined'
    return out


def case(case_id, pk, sig, msg, construction, **extra):
    return {'id': case_id, 'public_key_hex': pk.hex(), 'signature_hex': sig.hex(), 'message_hex': msg.hex(),
            'construction': construction, **extra, **predicates(pk, sig, msg)}


def sign_normal(label, msg):
    """A synthetic key A = [a]B and a signature with R = [r]B, S = r + k a mod L."""
    a, r = scalar(f'{label}/a'), scalar(f'{label}/r')
    pk, r_bytes = encode(times(a, B)), encode(times(r, B))
    k = challenge(r_bytes, pk, msg) % L
    return pk, r_bytes + ((r + k * a) % L).to_bytes(32, 'little')


def sign_small_a(label, a_bytes, msg):
    """A whose point T is in E[8] (a_bytes may be a non-canonical encoding); R = [r]B, S = r, with [k]T = O."""
    t = decode(a_bytes)
    for counter in range(SEARCH_BOUND):
        r = scalar(f'{label}/r/{counter}')
        r_bytes = encode(times(r, B))
        if times(challenge(r_bytes, a_bytes, msg) % L, t) == IDENTITY:
            return r_bytes + r.to_bytes(32, 'little'), counter
    raise AssertionError(f'{label}: bounded search found nothing')


def sign_small_r(label, r_bytes, msg):
    """R whose point is in E[8] (r_bytes may be non-canonical); A = [a]B + T8, S = k a, with [k mod L]T8 = -R."""
    target = neg(decode(r_bytes))
    for counter in range(SEARCH_BOUND):
        a = scalar(f'{label}/a/{counter}')
        pk = encode(plus(times(a, B), T8))
        k = challenge(r_bytes, pk, msg) % L
        if times(k, T8) == target:
            return pk, r_bytes + ((k * a) % L).to_bytes(32, 'little'), counter
    raise AssertionError(f'{label}: bounded search found nothing')


def altered(c):
    """The same case with the last message byte changed (or one byte appended to an empty message)."""
    msg = bytes.fromhex(c['message_hex'])
    msg = msg[:-1] + bytes([msg[-1] ^ 1]) if msg else b'\x01'
    return case(f"{c['id']}/message-altered", bytes.fromhex(c['public_key_hex']), bytes.fromhex(c['signature_hex']),
                msg, f"{c['id']} with its message altered", control_of=c['id'])


def le(n):
    return n.to_bytes(32, 'little')


def non_canonical_small_order():
    """The non-canonical encodings whose point is in E[8]: y = p (y = 0, order 4), y = p + 1 (identity), and the
    sign bit with x = 0 (identity and the point of order 2)."""
    rows = [('y-p', le(P)), ('y-p-sign', le(P | 1 << 255)), ('y-p-plus-1', le(P + 1)),
            ('y-p-plus-1-sign', le((P + 1) | 1 << 255)), ('identity-sign', le(1 | 1 << 255)),
            ('order-2-sign', le((P - 1) | 1 << 255))]
    for name, raw in rows:
        assert not canonical_rule(raw) and small_order(raw), name
    return rows


def encodings_section():
    rows = []
    # y in [p, 2^255): y - p is any curve y below 19, with both sign bits.
    for v in range(19):
        for sign in (0, 1):
            raw = le((P + v) | sign << 255)
            rows.append(('y-at-least-p', f'y-p-plus-{v}' + ('-sign' if sign else ''), raw))
    rows += [('zero-x-sign-bit', 'identity-sign', le(1 | 1 << 255)),
             ('zero-x-sign-bit', 'order-2-sign', le((P - 1) | 1 << 255))]
    for t in sorted(E8, key=lambda t: (order(t), encode(t))):
        rows.append(('small-order', label(t), encode(t)))
    no_point = next(le(y) for y in range(2, P) if decode(le(y)) is None)
    rows += [('control', 'basepoint', encode(B)),
             ('control', 'mixed-order-point', bytes.fromhex(MIXED_A_AND_R['public_key_hex'])),
             ('control', 'normal-point', encode(times(scalar('encodings/normal'), B))),
             ('control', 'not-on-curve', no_point)]
    out = []
    for family, name, raw in rows:
        p = decode(raw)
        out.append({'id': f'encoding/{name}', 'family': family, 'encoding_hex': raw.hex(),
                    'canonical_rule': canonical_rule(raw), 'decodes': p is not None,
                    'small_order': None if p is None else encode(p) in SMALL_ORDER,
                    'order': None if p is None else (order(p) if encode(p) in SMALL_ORDER else 'not small')})
    return out


# The message of the normal control and of every synthetic negative of the signatures section, so that each
# negative has a valid control over the same bytes; the scalar searches vary only the labelled scalars.
COMMON_MESSAGE = b'dcp-ped1/signatures/common'


def signatures_section():
    out = []
    positives = []
    hist = {c['id']: c for c in json.loads(HISTORICAL.read_text())['cases']}
    for hid in ('rfc8032-test1-empty', 'rfc8032-test2-one-byte', 'rfc8032-test3-two-bytes',
                'public-key-mixed-order-k-multiple-of-8'):
        h = hist[hid]
        positives.append(case(f'signature/{hid}', bytes.fromhex(h['public_key_hex']), bytes.fromhex(h['signature_hex']),
                              bytes.fromhex(h['message_hex']), f'copied by bytes from historical {hid}'))
    m = MIXED_A_AND_R
    positives.append(case('signature/ped1-mixed-a-and-r-cancel-reduced', bytes.fromhex(m['public_key_hex']),
                          bytes.fromhex(m['signature_hex']), bytes.fromhex(m['message_hex']),
                          'copied by bytes from the Codex review fixture: A = 7B + T, R = 11B + T'))
    msg = COMMON_MESSAGE
    pk, sig = sign_normal('signatures/normal', msg)
    normal = case('signature/normal-key', pk, sig, msg, 'synthetic A = [a]B, R = [r]B, S = r + k a mod L')
    positives.append(normal)
    for c in positives:
        assert c['accept'], c['id']
        out += [c, altered(c)]
    # S + L of the valid normal signature: only the range fails.
    s = int.from_bytes(sig[32:], 'little') + L
    out.append(case('signature/normal-key-s-plus-l', pk, sig[:32] + s.to_bytes(32, 'little'), msg,
                    'signature/normal-key with S + L', s_high_bits_clear=s < 1 << 253))
    for t in sorted(E8, key=lambda t: (order(t), encode(t))):
        name = label(t)
        sig, counter = sign_small_a(f'a-small/{name}', encode(t), msg)
        out.append(case(f'signature/a-small-order/{name}', encode(t), sig, msg,
                        'A = T in E[8], R = [r]B, S = r; r searched until [k]T = O', search_counter=counter))
        pk, sig, counter = sign_small_r(f'r-small/{name}', encode(t), msg)
        out.append(case(f'signature/r-small-order/{name}', pk, sig, msg,
                        'R = T in E[8], A = [a]B + T8, S = k a; a searched until [k mod L]T8 = -R',
                        search_counter=counter))
    for name, raw in non_canonical_small_order():
        sig, counter = sign_small_a(f'a-non-canonical/{name}', raw, msg)
        out.append(case(f'signature/a-non-canonical-small-order/{name}', raw, sig, msg,
                        'non-canonical A of a point in E[8]; R = [r]B, S = r; r searched until [k]T = O',
                        search_counter=counter))
        pk, sig, counter = sign_small_r(f'r-non-canonical/{name}', raw, msg)
        out.append(case(f'signature/r-non-canonical-small-order/{name}', pk, sig, msg,
                        'non-canonical R of a point in E[8]; A = [a]B + T8, S = k a; a searched until [k mod L]T8 = -R',
                        search_counter=counter))
    return out


def objects_section():
    obj = {'dcp_ped1': 'v1-object', 'n': 1}
    canonical = json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()
    assert canonical == b'{"dcp_ped1":"v1-object","n":1}'
    pk, sig = sign_normal('objects/normal', canonical)
    t = next(t for t in E8 if order(t) == 8)
    a_sig, a_counter = sign_small_a('objects/a-small', encode(t), canonical)
    r_pk, r_sig, r_counter = sign_small_r('objects/r-small', encode(t), canonical)
    # R identity with a normal key: S = k a, so [S]B = O + [k]A.
    a = scalar('objects/r-identity/a')
    i_pk, i_r = encode(times(a, B)), encode(IDENTITY)
    i_sig = i_r + ((challenge(i_r, i_pk, canonical) % L) * a % L).to_bytes(32, 'little')
    cases = [case('object/normal-key', pk, sig, canonical, 'synthetic normal key over the canonical object'),
             case('object/a-small-order', encode(t), a_sig, canonical, 'A of order 8', search_counter=a_counter),
             case('object/r-small-order', r_pk, r_sig, canonical, 'R of order 8, A mixed', search_counter=r_counter),
             case('object/r-identity', i_pk, i_sig, canonical, 'R identity, normal A = [a]B, S = k a')]
    return {'object': obj, 'canonical_hex': canonical.hex(), 'cases': cases}


def composite_section():
    context, payload = 'DCP-AI.v2.Intent', '{"dcp_ped1":"composite"}'
    dsm = context.encode() + b'\x00' + payload.encode()
    pk, sig = sign_normal('composite/normal', dsm)
    t = next(t for t in E8 if order(t) == 8)
    a_sig, counter = sign_small_a('composite/a-small', encode(t), dsm)
    return {'context': context, 'payload_canonical': payload, 'dsm_hex': dsm.hex(),
            'cases': [case('composite/normal-key', pk, sig, dsm, 'control: synthetic normal key over the DSM'),
                      case('composite/a-small-order', encode(t), a_sig, dsm, 'A of order 8 over the DSM',
                           search_counter=counter)]}


def historical_section():
    out = []
    for h in json.loads(HISTORICAL.read_text())['cases']:
        pk, sig, msg = (bytes.fromhex(h[k]) for k in ('public_key_hex', 'signature_hex', 'message_hex'))
        out.append({'id': h['id'], 'historical_category': h['category'], 'public_key_hex': h['public_key_hex'],
                    'signature_hex': h['signature_hex'], 'message_hex': h['message_hex'], **predicates(pk, sig, msg)})
    return out


def build():
    doc = {
        'title': 'DCP-AI P-ED-1 Ed25519 acceptance vectors',
        'design': 'docs/reviews/mp02-ed25519-implementation-design.md v0.2.3',
        'criterion': 'Accept iff 0 <= S < L; A and R are canonical encodings of curve points; neither A nor R is in '
                     'E[8]; and [S]B = R + [k]A with k = SHA-512(R || A || M) mod L, without cofactor. A DCP '
                     'criterion, not one of the RFC 8032 checks.',
        'scope': 'Predicates of an independent review model over exact bytes. Not a provider result, not a remote '
                 'admission claim. Synthetic public scalars; no real key.',
        'generated_by': 'tools/ed25519-review/generate_ped1_vectors.py',
        'checked_by': 'tools/ed25519-review/check_ped1_vectors.py',
        'sources_sha256': {'tools/ed25519-review/check_equations_independent.py': sha256(MODEL),
                           'tools/ed25519-review/corpus.json': sha256(HISTORICAL)},
        'copied_fixture': 'signature/ped1-mixed-a-and-r-cancel-reduced: bytes of the Codex review fixture f5-mixed-a-and-r-positive.json (local review evidence, not in the repository)',
        'predicates': {
            'canonical_rule': 'bytes: y < p (y is the encoding with bit 255 cleared), and no sign bit when y is 1 or p - 1',
            'a_decodes / r_decodes': 'lenient decoding (y mod p, any sign bit with x = 0) finds a curve point',
            'a_small_order / r_small_order': 'the decoded point is in E[8], whatever its encoding',
            'equation_points': '[S]B = R + [k]A on the decoded points, k = SHA-512(R || A || M) mod L, S as given',
            'equation_full_challenge': 'the same with the unreduced 512-bit k (information only)',
            'equation_cofactored': '[8][S]B = [8](R + [k]A) with the reduced k (information only)',
            'bytes_match': 'the canonical encoding of [S]B - [k]A equals the R bytes, A decoding: the libraries comparison',
            'failing': 'conditions of P-ED-1 that fail, in order: ' + ', '.join(CONDITIONS),
            'kind': 'accept, isolated (exactly one condition fails), combined (more than one) or length',
        },
        'constants': {'p_le_hex': le(P).hex(), 'l_le_hex': le(L).hex(), 'small_order_encodings_hex': [e.hex() for e in SMALL_ORDER]},
        'historical': historical_section(),
        'encodings': encodings_section(),
        'signatures': signatures_section(),
        'objects': objects_section(),
        'composite': composite_section(),
    }
    ids = [c['id'] for c in doc['historical'] + doc['encodings'] + doc['signatures'] + doc['objects']['cases']
           + doc['composite']['cases']]
    assert len(ids) == len(set(ids)), 'ids are not unique'
    return (json.dumps(doc, indent=1, ensure_ascii=False) + '\n').encode()


if __name__ == '__main__':
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    data = build()
    if out.exists() and out.read_bytes() != data:
        sys.exit(f'{out} exists with other bytes; not overwritten')
    out.write_bytes(data)
    print(out, hashlib.sha256(data).hexdigest())
