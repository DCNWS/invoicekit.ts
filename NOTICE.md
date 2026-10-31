# Notices and licences

## Code

The TypeScript in this package is licensed under the MIT licence (see
`LICENSE`). The engine it loads is the Go validator
[`github.com/dcnws/invoicekit.go`](https://github.com/dcnws/invoicekit.go),
also MIT: `assets/einv.wasm` is that program compiled to WebAssembly, with no
source of its own.

## Rule sets inside the WebAssembly binary

`assets/einv.wasm` carries the official validation artefacts as data, embedded
by the Go build so the validator works offline with no downloads. They are
someone else's copyright, redistributed **unmodified**, and embedding them does
not change their licence:

* **EN 16931 Schematrons** (validation artefacts 1.3.x), European Union through
  the Connecting Europe Facility, EUPL v1.2 — full text in
  `LICENSES/EUPL-1.2.txt`.
  Source: <https://github.com/ConnectingEurope/eInvoicing-EN16931>
* **XRechnung CIUS rule sets** v2.6.0 for XRechnung 3.0.2, KoSIT on behalf of
  the German Bundesministerium des Innern, Apache-2.0 — `LICENSES/Apache-2.0.txt`.
  Source: <https://projekte.kosit.org/xrechnung/xrechnung-schematron>, tag `v2.6.0`
* **Peppol BIS Billing 3.0** release 3.0.21 rule sets, OpenPEPPOL AISBL: the CEN
  EN 16931 business terms (European Union, EUPL v1.2, reproduced with permission
  from CEN) plus the OpenPEPPOL extensions (Apache-2.0) — statement in
  `LICENSES/Peppol-BIS-3.0-notice.txt`.
  Source: <https://github.com/OpenPeppol/peppol-bis-invoice-3> (`rules/sch`)

The Go repository keeps those files in the clear under
`internal/en16931/schemas/`, with their upstream headers intact, and a test
(`TestProfileArtefactsUnmodified`) fails the build the moment an embedded
artefact drifts from the released one. Peppol BIS Billing 3.0 is a trademark of
OpenPEPPOL; the rules are used to check documents, not to imply anything about
who stands behind this software. If you redistribute this package, keep the rule
sets unmodified and keep this notice.

## Test fixtures

`test/fixtures/invoice-pdfa3.pdf` and `test/fixtures/invoice-plain.pdf` are
one-page invoice PDFs rendered by GPL Ghostscript from a source of ours; the
fonts in them are the URW base 35 faces (Underware licence, GPL-compatible) and
the colour profile is Ghostscript's own. `test/fixtures/hybrid-a3.pdf` and
`hybrid-plain.pdf` are those files with an invoice attached by the engine's own
`einv embed`, so they are reproducible byte for byte:

```
go run ./cmd/einv embed -now 2026-10-31T09:00:00Z \
  -o test/fixtures/hybrid-a3.pdf fixtures/invoice-pdfa3.pdf fixtures/cii-xrechnung.xml
```

`test/fixtures/cii-xrechnung.xml` is `XRechnung-O.xml` and `ubl-min.xml` is
`Invoice-Min_content_with_VAT.xml`, both CEF reference examples
(<https://github.com/ConnectingEurope/eInvoicing-EN16931>, EUPL v1.2), kept
unmodified. `ubl-peppol.xml` is ours: an example written to pass Peppol BIS
Billing 3.0.

## No warranty

The rule sets and this validator are provided as-is. Nothing here is legal or
tax advice; compliance with your national e-invoicing mandate remains your
responsibility.
