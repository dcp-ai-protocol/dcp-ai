"""Executable DESIGN MODEL of the non-normative dcp-jcs-v2 candidate.

It states the design of docs/proposals/canonicalization-candidate/README.md as code: transport
extraction of the validated unit, a byte-level ingress scan with a total precedence of classes,
profile selection and policy, and a synthetic bundle path whose SHA-256 commitment checks stand in for
the hashes and signatures of a real verifier.

This is an experimental design tool. It is not an SDK, not a verifier, and not dcp-jcs-v1: it computes
SHA-256 for the synthetic commitments, but it signs nothing, verifies no signature and opens no
connection. Only tools/canonicalization-lab/run.py imports it. Its expectations live in the corpus,
written by generate_corpus.py without this module.
"""
import hashlib

MAX = 2**53 - 1
MAX_DEPTH = 64
V1, V2 = 'dcp-jcs-v1', 'dcp-jcs-v2'
KNOWN_PROFILES = (V1, V2)
ENCODING = ('BOM', 'UTF8_INVALID')
VALUE_LEVEL = ('SURROGATE_UNPAIRED', 'DUPLICATE_KEY', 'NUMBER_NOT_INTEGER', 'NUMBER_OUT_OF_RANGE', 'DEPTH_EXCEEDED')
WS = b' \t\n\r'
SIMPLE_ESCAPES = {ord('"'): 0x22, ord('\\'): 0x5C, ord('/'): 0x2F, ord('b'): 0x08, ord('f'): 0x0C,
                  ord('n'): 0x0A, ord('r'): 0x0D, ord('t'): 0x09}
HEX = b'0123456789abcdefABCDEF'

# Set only by run.py's negative controls, to prove the corpus detects a weaker design.
MUTATION = None


def text(s):
    return tuple(ord(c) for c in s)


BUNDLE, MANIFEST, PROFILE_FIELD, SIGNED_BUNDLE = text('bundle'), text('manifest'), text('canonicalization_profile'), text('signed_bundle')


class Obj:
    def __init__(self, offset):
        self.offset, self.members, self.end = offset, [], None  # members: (key cps, key offset, value)


class Arr:
    def __init__(self, offset):
        self.offset, self.items, self.end = offset, [], None


class Str:
    def __init__(self, offset, cps, end):
        self.offset, self.cps, self.end = offset, tuple(cps), end


class Num:
    def __init__(self, offset, value, end):
        self.offset, self.value, self.end = offset, value, end  # value: int, or a class when out of domain


class Lit:
    def __init__(self, offset, value, end):
        self.offset, self.value, self.end = offset, value, end


class SyntaxStop(Exception):
    def __init__(self, offset):
        self.offset = offset


def exact_integer(lexeme):
    """N4 on a lexeme that already matches the RFC 8259 number grammar: the exact value as an int,
    or the class of rejection. The exponent saturates at len(lexeme) + 17; no big arithmetic."""
    neg = lexeme.startswith(b'-')
    body = lexeme[1:] if neg else lexeme
    cut = max(body.find(b'e'), body.find(b'E'))
    mantissa, exponent = (body[:cut], body[cut + 1:]) if cut >= 0 else (body, b'')
    int_part, _, frac = mantissa.partition(b'.')
    digits = (int_part + frac).lstrip(b'0')
    if not digits:
        return 0
    cap = len(lexeme) + 17
    sign = -1 if exponent.startswith(b'-') else 1
    magnitude = exponent.lstrip(b'+-').lstrip(b'0') or b'0'
    x = cap if len(magnitude) > len(str(cap)) else min(int(magnitude), cap)
    scale = sign * x - len(frac)
    stripped = digits.rstrip(b'0')
    scale += len(digits) - len(stripped)
    if scale < 0:
        return 'NUMBER_NOT_INTEGER'
    if len(stripped) + scale > 16:
        return 'NUMBER_OUT_OF_RANGE'
    value = int(stripped) * 10**scale
    if value > MAX:
        return 'NUMBER_OUT_OF_RANGE'
    return -value if neg else value


class Scanner:
    """One iterative pass (no recursion, any depth). In unit mode the input is valid UTF-8 without a
    BOM and every value-level violation is recorded with its offset. In transport mode only the
    grammar is checked, string bytes are not decoded, and nothing else is validated."""

    def __init__(self, data, transport=False, depth_base=0):
        self.b, self.n, self.i = data, len(data), 0
        self.transport, self.depth_base = transport, depth_base
        self.violations = []  # (class, offset)

    def fail(self, at=None):
        raise SyntaxStop(self.i if at is None else at)

    def ws(self):
        while self.i < self.n and self.b[self.i] in WS:
            self.i += 1

    def string(self):
        start = self.i
        self.i += 1  # opening quote
        cps = []
        while True:
            if self.i >= self.n:
                self.fail()
            c = self.b[self.i]
            if c == 0x22:
                self.i += 1
                return Str(start, cps, self.i)
            if c < 0x20:
                self.fail()
            if c != 0x5C:
                if c < 0x80:
                    cps.append(c)
                    self.i += 1
                else:
                    width = 2 if c < 0xE0 else 3 if c < 0xF0 else 4
                    if self.transport:
                        cps.append(0x110000 + c)  # raw byte: never equal to a scalar value
                        self.i += 1
                    else:
                        cps.append(ord(self.b[self.i:self.i + width].decode('utf-8')))
                        self.i += width
                continue
            escape_at = self.i
            if self.i + 1 >= self.n:
                self.fail(self.n)
            e = self.b[self.i + 1]
            if e in SIMPLE_ESCAPES:
                cps.append(SIMPLE_ESCAPES[e])
                self.i += 2
                continue
            if e != ord('u'):
                self.fail(self.i + 1)
            unit = self.hex4(self.i + 2)
            self.i += 6
            if 0xD800 <= unit <= 0xDBFF:
                low = self.low_surrogate_at(self.i)
                if low is not None:
                    cps.append(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00))
                    self.i += 6
                    continue
                self.violate('SURROGATE_UNPAIRED', escape_at)
            elif 0xDC00 <= unit <= 0xDFFF:
                self.violate('SURROGATE_UNPAIRED', escape_at)
            cps.append(unit)

    def hex4(self, at):
        for k in range(4):
            if at + k >= self.n or self.b[at + k] not in HEX:
                self.fail(min(at + k, self.n))
        return int(self.b[at:at + 4], 16)

    def low_surrogate_at(self, at):
        """The low surrogate a syntactically complete \\uXXXX escape at `at` names, else None."""
        if self.b[at:at + 2] != b'\\u' or at + 6 > self.n or any(x not in HEX for x in self.b[at + 2:at + 6]):
            return None
        unit = int(self.b[at + 2:at + 6], 16)
        return unit if 0xDC00 <= unit <= 0xDFFF else None

    def number(self):
        start = self.i
        if self.b[self.i] == 0x2D:
            self.i += 1
        if self.i >= self.n or not 0x30 <= self.b[self.i] <= 0x39:
            self.fail()
        if self.b[self.i] == 0x30:
            self.i += 1
        else:
            while self.i < self.n and 0x30 <= self.b[self.i] <= 0x39:
                self.i += 1
        if self.i < self.n and self.b[self.i] == 0x2E:
            self.i += 1
            self.digits()
        if self.i < self.n and self.b[self.i] in b'eE':
            self.i += 1
            if self.i < self.n and self.b[self.i] in b'+-':
                self.i += 1
            self.digits()
        if self.transport:
            return Num(start, None, self.i)
        value = exact_integer(self.b[start:self.i])
        if isinstance(value, str):
            self.violate(value, start)
        return Num(start, value, self.i)

    def digits(self):
        if self.i >= self.n or not 0x30 <= self.b[self.i] <= 0x39:
            self.fail()
        while self.i < self.n and 0x30 <= self.b[self.i] <= 0x39:
            self.i += 1

    def literal(self):
        for word, value in ((b'true', True), (b'false', False), (b'null', None)):
            if self.b[self.i] == word[0]:
                start = self.i
                for k, ch in enumerate(word):
                    if start + k >= self.n or self.b[start + k] != ch:
                        self.fail(start + k)
                self.i = start + len(word)
                return Lit(start, value, self.i)
        self.fail()

    def violate(self, cls, offset):
        if not self.transport:
            self.violations.append((cls, offset))

    def parse(self):
        """The root value. Raises SyntaxStop at the first byte that cannot extend a valid prefix."""
        stack = []  # [container, pending key, key offset, seen keys]
        root = None
        state = 'value'
        while True:
            if state == 'value':
                self.ws()
                if self.i >= self.n:
                    self.fail()
                c = self.b[self.i]
                if c in b'{[':
                    depth = self.depth_base + len(stack) + 1
                    if depth == MAX_DEPTH + 1:
                        self.violate('DEPTH_EXCEEDED', self.i)
                    node = Obj(self.i) if c == 0x7B else Arr(self.i)
                    self.i += 1
                    stack.append([node, None, None, set()])
                    state = 'first'
                    continue
                if c == 0x22:
                    node = self.string()
                elif c == 0x2D or 0x30 <= c <= 0x39:
                    node = self.number()
                else:
                    node = self.literal()
            elif state == 'first':
                self.ws()
                frame = stack[-1]
                closer = 0x7D if isinstance(frame[0], Obj) else 0x5D
                if self.i < self.n and self.b[self.i] == closer:
                    self.i += 1
                    node = stack.pop()[0]
                    node.end = self.i
                elif isinstance(frame[0], Obj):
                    self.key(frame)
                    state = 'value'
                    continue
                else:
                    state = 'value'
                    continue
            elif state == 'after':
                self.ws()
                frame = stack[-1]
                closer = 0x7D if isinstance(frame[0], Obj) else 0x5D
                if self.i < self.n and self.b[self.i] == 0x2C:
                    self.i += 1
                    if isinstance(frame[0], Obj):
                        self.ws()
                        self.key(frame)
                    state = 'value'
                    continue
                if self.i < self.n and self.b[self.i] == closer:
                    self.i += 1
                    node = stack.pop()[0]
                    node.end = self.i
                else:
                    self.fail()
            # A value is complete: attach it.
            if not stack:
                root = node
                self.ws()
                if self.i != self.n:
                    self.fail()
                return root
            frame = stack[-1]
            if isinstance(frame[0], Obj):
                frame[0].members.append((frame[1], frame[2], node))
            else:
                frame[0].items.append(node)
            state = 'after'

    def key(self, frame):
        if self.i >= self.n or self.b[self.i] != 0x22:
            self.fail()
        k = self.string()
        if k.cps in frame[3]:
            self.violate('DUPLICATE_KEY', k.offset)
        frame[3].add(k.cps)
        self.ws()
        if self.i >= self.n or self.b[self.i] != 0x3A:
            self.fail()
        self.i += 1
        frame[1], frame[2] = k.cps, k.offset


def primary(violations):
    """The value-level class that is notified: the earliest offset; equal offsets cannot occur in a
    single pass, but the order is total anyway (VALUE_LEVEL)."""
    if not violations:
        return None
    by_offset = min(violations, key=lambda v: (v[1], VALUE_LEVEL.index(v[0])))
    if MUTATION in ('class-order', 'class-order-invalid-class'):
        by_class = min(violations, key=lambda v: (VALUE_LEVEL.index(v[0]), v[1]))
        if MUTATION == 'class-order-invalid-class' and by_class != by_offset:
            return ('NOT_A_CLASS', by_class[1])  # the same cases fail, with a result that is not a valid state
        return by_class
    return by_offset


def scan_unit(data, depth_base=0):
    """Layer 1 encoding (earliest offset; a BOM is at 0), layer 2 grammar (first byte that cannot
    extend a valid prefix), layer 3 value-level (earliest offset). Returns (primary, root, all)."""
    if data.startswith(b'\xef\xbb\xbf'):
        return ('BOM', 0), None, [('BOM', 0)]
    try:
        data.decode('utf-8')
    except UnicodeDecodeError as e:
        return ('UTF8_INVALID', e.start), None, [('UTF8_INVALID', e.start)]
    scanner = Scanner(data, depth_base=depth_base)
    try:
        root = scanner.parse()
    except SyntaxStop as stop:
        if MUTATION == 'syntax-not-first' and scanner.violations:
            return primary(scanner.violations), None, scanner.violations
        return ('SYNTAX', stop.offset), None, scanner.violations + [('SYNTAX', stop.offset)]
    return primary(scanner.violations), root, scanner.violations


def extract_unit(data):
    """Envelope transport: the exact bytes of the one `signed_bundle` member of a top-level object.
    The envelope is checked for its encoding outside the unit and for its grammar; nothing in it is
    re-serialized. Returns (start, end, envelope depth of the unit) or a transport rejection."""
    if data.startswith(b'\xef\xbb\xbf'):
        return {'class': 'TRANSPORT_INVALID', 'detail': 'BOM', 'offset': 0}
    scanner = Scanner(data, transport=True)
    try:
        root = scanner.parse()
    except SyntaxStop as stop:
        return {'class': 'TRANSPORT_INVALID', 'detail': 'SYNTAX', 'offset': stop.offset}
    if not isinstance(root, Obj):
        return {'class': 'TRANSPORT_INVALID', 'detail': 'NOT_AN_OBJECT', 'offset': root.offset}
    found = [m for m in root.members if m[0] == SIGNED_BUNDLE]
    if not found:
        return {'class': 'TRANSPORT_INVALID', 'detail': 'NO_SIGNED_BUNDLE', 'offset': None}
    if len(found) > 1:
        return {'class': 'TRANSPORT_AMBIGUOUS', 'detail': 'SIGNED_BUNDLE_REPEATED', 'offset': found[1][1]}
    start, end = found[0][2].offset, found[0][2].end
    for part, base in ((data[:start], 0), (data[end:], end)):
        try:
            part.decode('utf-8')
        except UnicodeDecodeError as e:
            return {'class': 'TRANSPORT_INVALID', 'detail': 'UTF8_INVALID', 'offset': base + e.start}
    return start, end, 1


def last(node, key):
    """The value of the LAST member named `key`, as this model assumes; historical adapters need measurement."""
    if not isinstance(node, Obj):
        return None
    found = None
    for k, _, v in node.members:
        if k == key:
            found = v
    return found


def read_profile(root):
    """The exact path signed_bundle.bundle.manifest.canonicalization_profile, nothing elsewhere."""
    node = last(last(last(root, BUNDLE), MANIFEST), PROFILE_FIELD)
    if node is None:
        return 'absent', None
    if isinstance(node, Str) and node.cps == text(V1):
        return V1, node.offset
    if isinstance(node, Str) and node.cps == text(V2):
        return V2, node.offset
    return 'unknown', node.offset


def escape(cps):
    out = ['"']
    for cp in cps:
        if cp == 0x22:
            out.append('\\"')
        elif cp == 0x5C:
            out.append('\\\\')
        elif cp in (0x08, 0x09, 0x0A, 0x0C, 0x0D):
            out.append({0x08: '\\b', 0x09: '\\t', 0x0A: '\\n', 0x0C: '\\f', 0x0D: '\\r'}[cp])
        elif cp < 0x20:
            out.append('\\u%04x' % cp)
        else:
            out.append(chr(cp))
    out.append('"')
    return ''.join(out)


def canonical(node):
    """Output rules shared by dcp-jcs-v1 and the candidate, on a unit with no violation (so with no
    duplicate key and only exact in-domain integers)."""
    if isinstance(node, Obj):
        members = {k: v for k, _, v in node.members}
        return '{' + ','.join(escape(k) + ':' + canonical(members[k]) for k in sorted(members)) + '}'
    if isinstance(node, Arr):
        return '[' + ','.join(canonical(v) for v in node.items) + ']'
    if isinstance(node, Str):
        return escape(node.cps)
    if isinstance(node, Num):
        return str(node.value)
    return {True: 'true', False: 'false', None: 'null'}[node.value]


def digest(node):
    return 'sha256:' + hashlib.sha256(canonical(node).encode('utf-8')).hexdigest()


def equals(node, s):
    return isinstance(node, Str) and node.cps == text(s)


def commitments(root):
    """The synthetic bundle's hash checks, in order; the first failure, or None. Stand-ins for the
    payload hashes, the audit chain and the composite signature over the manifest: NOT signatures."""
    b, s = last(root, BUNDLE), last(root, text('signature'))
    m = last(b, MANIFEST)
    intent = last(b, text('intent'))
    payload, payload_hash = last(intent, text('payload')), last(intent, text('payload_hash'))
    entries = last(b, text('audit_entries'))
    if not all(isinstance(x, Obj) for x in (b, s, m, intent)) or payload is None or not isinstance(entries, Arr):
        return 'structure'
    if not equals(payload_hash, digest(payload)):
        return 'payload_hash'
    if not (isinstance(last(m, text('intent_hash')), Str) and last(m, text('intent_hash')).cps == payload_hash.cps):
        return 'intent_hash'
    previous = 'GENESIS'
    for entry in entries.items:
        if not equals(last(entry, text('prev_hash')), previous):
            return 'audit_chain'
        previous = digest(entry)
    if not equals(last(s, text('manifest_hash')), digest(m)):
        return 'manifest_hash'
    return None


def policy_error(policy):
    """A verifier configuration error, or None. There is no default: a model run enables the
    candidate only through an explicit list (a production default would be [dcp-jcs-v1])."""
    if policy is None:
        return 'MISSING'
    if not isinstance(policy, list) or not policy:
        return 'NOT_A_NON_EMPTY_LIST'
    if not all(isinstance(p, str) for p in policy):
        return 'NOT_STRINGS'
    if len(set(policy)) != len(policy):
        return 'REPEATED'
    if not all(p in KNOWN_PROFILES for p in policy):
        return 'UNKNOWN_PROFILE'
    return None


def evaluate(data, mode='document', transport='bare', policy=None, historical=None, depth_scope='unit'):
    """The design's decision for one input. `historical` is what today's parser of an SDK does with a
    unit the scanner cannot walk (encoding or grammar violation): 'fails', or the profile value it
    reads ('absent', V1, V2 or 'other'). It is never consulted for a unit the scanner can walk.

    'v1_path' is a delegation: the unit goes, unchanged, to today's dcp-jcs-v1 verifier, whose verdict
    this model neither computes nor simulates."""
    if MUTATION == 'crash' or (MUTATION == 'crash-bundle' and mode == 'bundle'):
        raise RuntimeError('deliberate model failure (negative control)')
    out = {'attempts': [], 'warnings': []}
    if mode == 'bundle':
        error = policy_error(policy)
        if error:
            return dict(out, result='reject', **{'class': 'POLICY_INVALID'}, detail=error)
    start, depth_base = 0, 0
    if transport == 'envelope':
        found = extract_unit(data)
        if isinstance(found, dict):
            return dict(out, result='reject', **{'class': found['class']}, detail=found['detail'],
                        transport_offset=found['offset'])
        start, end, envelope_depth = found
        data = data[start:end]
        if depth_scope == 'transport' or MUTATION == 'transport-depth':
            depth_base = envelope_depth
    out['unit'] = [start, start + len(data)]
    first, root, _ = scan_unit(data, depth_base)

    def rejected(cls, offset, **extra):
        return dict(out, result='reject', **{'class': cls}, offset=offset, **extra)

    if mode == 'document':
        if first:
            return rejected(*first)
        text_out = canonical(root)
        return dict(out, result='accept', canonical_sha256=hashlib.sha256(text_out.encode('utf-8')).hexdigest())

    if root is None:  # not walkable: only today's parser can say whether the v1 path proceeds
        if historical not in ('fails', 'absent', V1, V2, 'other'):
            raise ValueError('a unit with an encoding or grammar violation needs `historical`')
        if historical in ('absent', V1):
            if V1 not in policy:
                return rejected('PROFILE_NOT_ACCEPTED', None, profile=V1)
            return dict(out, result='v1_path', profile=V1, attempts=[V1],
                        warnings=[{'class': first[0], 'offset': first[1]}])
        return rejected(*first)

    selected, at = read_profile(root)
    if selected == 'unknown':
        return rejected('PROFILE_UNKNOWN', at)
    profile = V1 if selected in ('absent', V1) else V2
    if profile not in policy:
        return rejected('PROFILE_NOT_ACCEPTED', at, profile=profile)
    if profile == V1:
        warnings = [{'class': first[0], 'offset': first[1]}] if first else []
        return dict(out, result='v1_path', profile=V1, attempts=[V1], warnings=warnings)
    if first:
        return rejected(*first, profile=V2)
    failure = commitments(root)
    out['attempts'] = [V2]
    if failure is None:
        return dict(out, result='accept_v2', profile=V2, manifest_sha256=digest(last(last(root, BUNDLE), MANIFEST)))
    if MUTATION == 'fallback-v1':  # the forbidden retry: hand a failed v2 unit to the v1 path
        return dict(out, result='v1_path', profile=V1, attempts=[V2, V1])
    return rejected('COMMITMENT_MISMATCH', None, detail=failure, profile=V2)
