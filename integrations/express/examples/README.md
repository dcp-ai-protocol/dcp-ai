# Examples

Both run offline on the shared admission vectors (`tests/interop/v2/admission_vectors.json`):
synthetic keys and bundles, the operator's trust set and `strict-v1` profile, and a clock fixed at
the vectors' time.

From the repository root, first build the workspace SDK in a subshell so the following command still starts at that root:

```bash
(cd sdks/typescript && npm install && npm run build)
cd integrations/express && npm install && npm run build
node examples/strict-v1-body.mjs      # the recommended transport, checked over real HTTP
node examples/strict-v1.mjs           # the shortest strict-v1 setup
```

## `strict-v1-body.mjs`: the bundle in the JSON body

Sends real HTTP requests to a server on `127.0.0.1`, checks every outcome, closes the server and
exits 1 if any outcome is not the expected one. `--report FILE` writes the results as JSON.

| Request | Expected |
|---|---|
| Trusted hybrid bundle in `signed_bundle` of the body | `200`; the route runs with `req.dcpAgent.admission`, `actionAuthorized: false` |
| Bundle of an unknown principal | `403`, `TRUST_PRINCIPAL_UNKNOWN`; the route does not run |
| Bundle signed for another verifier | `403`, `PROFILE_AUDIENCE_MISMATCH` and `VERIFICATION_FAILED`; the route does not run |
| Body over the budget | `413` from the body parser: the middleware, verification, trust and revocation never run |
| The same hybrid bundle in `X-DCP-Bundle` | `431` from Node before Express sees the request (only when the bundle exceeds `http.maxHeaderSize`) |

Counters record how far each request got (Express, past the body parser, the trust source, the
revocation source, the route), so the `413` is shown to stop before verification, not only before
the route.

An admitted bundle is **evidence**: authentic and signed for a principal you trust. It is not a
permission to run the action; `actionAuthorized` is always `false`, and your own authorization
decides what the request may do.

### Why the body

A hybrid V2 bundle carries Ed25519 and ML-DSA-65 keys and signatures: the base bundle of the
vectors is 32,996 bytes (33,014 in `{"signed_bundle": …}`). Node's default limit for all request
headers together is 16 KiB (`http.maxHeaderSize`), so the bundle in `X-DCP-Bundle` is refused with
`431` before any middleware runs. Proxies and load balancers have header limits of their own. The
header stays supported for bundles that fit every limit on the path; this example does not raise
`maxHeaderSize`, and neither should you to make a hybrid bundle fit.

### The body budget

`BODY_BUDGET_BYTES` (64 KiB) is this example's choice, not a limit of the protocol: about twice its
largest bundle. Set yours for your deployment:

- Measure the largest bundle you accept. It grows with the audit trail (each entry of the vectors'
  bundle is about 530 bytes) and with PQ checkpoints, and other fields of your request body add to
  it.
- Pass the budget to the body parser before `dcpVerify` (`express.json({ limit })`), and keep the
  same or a larger limit on every proxy in front of the server.
- Anything above the budget gets `413` before verification. Too small a budget refuses valid
  evidence; too large a one lets a client make the server parse large bodies.
