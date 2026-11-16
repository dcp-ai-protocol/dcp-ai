"""Application transport policy; selects no new DCP signature/profile format."""
import json
import re

from dcp_ai.v2 import canonicalize_v2
from dcp_ai.v2.experimental_candidate_ingress import experimental_candidate_ingress


class IngressError(ValueError):
    def __init__(self, reason, status=400):
        super().__init__(reason)
        self.reason = reason
        self.status = status
        self.code = 'APP_INGRESS_TOO_LARGE' if status == 413 else 'APP_INGRESS_REJECTED'


def _reason(code):
    if code in ('UTF8_INVALID', 'BOM'):
        return 'UTF8'
    if code == 'SURROGATE_UNPAIRED':
        return 'UNICODE'
    if code.startswith('NUMBER_'):
        return 'NUMBER_FORM'
    return code


def _non_portable_number(data):
    i, quoted = 0, False
    while i < len(data):
        c = data[i]
        if quoted:
            if c == 92:
                i += 2
            else:
                if c == 34:
                    quoted = False
                i += 1
        elif c == 34:
            quoted = True
            i += 1
        elif c == 45 or 48 <= c <= 57:
            end = i + 1
            while end < len(data) and data[end] in b'0123456789.eE+-':
                end += 1
            literal = data[i:end]
            if not re.fullmatch(rb'-?(0|[1-9][0-9]*)', literal) or literal == b'-0':
                return True
            i = end
        else:
            i += 1
    return False


def parse_request(data, max_bytes):
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError('raw bytes required')
    if type(max_bytes) is not int or max_bytes < 1:
        raise TypeError('positive body budget required')
    data = bytes(data)
    if len(data) > max_bytes:
        raise IngressError('BODY_BUDGET', 413)
    scanned = experimental_candidate_ingress(data)
    if scanned.status != 'accept':
        raise IngressError(_reason(scanned.reject_class))
    if _non_portable_number(data):
        raise IngressError('NUMBER_FORM')
    parsed = json.loads(data.decode('utf-8', errors='strict'))
    if canonicalize_v2(parsed).encode('utf-8') != scanned.canonical:
        raise RuntimeError('APP_INGRESS_PARSER_MISMATCH')
    return parsed
