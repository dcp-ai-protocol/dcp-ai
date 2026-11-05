"""Guards the historical body of spec/AUDIT-v2.0-FINAL.md: only its context note may change.

Run: python3 -m unittest discover -s scripts -p 'test_docs*.py'
"""
import hashlib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# SHA-256 of spec/AUDIT-v2.0-FINAL.md from "## Gap Verification Matrix" to the end, as recorded on 05/11/2026.
AUDIT_BODY_SHA256 = "5e819ee3d63026254351a97621eac7b53c7fbb7201d957121be11f2956f0e5ee"


class HistoricalAuditRecord(unittest.TestCase):
    def test_body_keeps_its_bytes(self):
        data = (ROOT / "spec/AUDIT-v2.0-FINAL.md").read_bytes()
        body = data[data.index(b"## Gap Verification Matrix"):]
        self.assertEqual(hashlib.sha256(body).hexdigest(), AUDIT_BODY_SHA256)


if __name__ == "__main__":
    unittest.main()
