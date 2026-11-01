# @invoicekit/einvoice

EN 16931 e-invoice validation in the browser or in Node. Same engine as the Go
library and the `einv` CLI, compiled to WebAssembly — no server round trip, no
Java, no XSLT, no network calls, and the customer's invoice data never leaves
the machine it is typed on.

Supports both syntaxes mandated by EN 16931:

* **CII** — UN/CEFACT Cross Industry Invoice (Factur-X, ZUGFeRD, XRechnung)
* **UBL** — OASIS UBL Invoice / CreditNote 2.1 (Peppol BIS, OpenPeppol)

Each syntax is checked twice over: against the business rules of the official
EN 16931 Schematron, and against the XML schema of the syntax itself, which
catches elements that are out of order, repeated or unknown. Profiles layer the
rules a network or country adds — Peppol BIS Billing 3.0 and XRechnung are in
this build.

This is the engine that runs at
[invoicekit.dcnws.com](https://invoicekit.dcnws.com): paste or drop an invoice
and it answers in the browser, uploading nothing. The
[full EN 16931 rule list](https://invoicekit.dcnws.com/en16931-rules.html) —
1,569 rule ids, 1,792 assertions — is generated from the same release.

## Install

```sh
npm install @invoicekit/einvoice
```

The WebAssembly binary and its Go runtime glue ship in `assets/`: 9.4 MB of
wasm, 2.3 MB gzipped, and the 17 KB of Go glue it needs. **The package is not
on the registry yet**, so until it is, that install line resolves nowhere.
What does work is the tarball attached to each
[release](https://github.com/DCNWS/invoicekit.ts/releases): same contents, the
same engine the tests just ran against, installed by URL.

```sh
npm install https://github.com/DCNWS/invoicekit.ts/releases/download/v0.2.1/invoicekit-einvoice-0.2.1.tgz
```

To work on the package itself, build the binaries from the Go sources first —
they are not committed, and the tests need them:

```sh
./scripts/build-wasm.sh          # expects ../invoicekit.go, or pass its path
npm install && npm test
```

## Use

```ts
import { loadEinvoice } from '@invoicekit/einvoice';

const einvoice = await loadEinvoice();          // 9.4 MB wasm, 2.3 MB gzipped

const res = einvoice.validate(xml);             // syntax auto-detected
if (!res.valid) {
  for (const f of res.findings) {
    console.log(f.id, f.message);               // e.g. BR-CO-10 Total mismatch
  }
}

einvoice.detect(xml);                           // 'CII' | 'UBL'
einvoice.phases('CII');                         // ['EN16931-model-phase', ...]

// EN 16931 plus a national CIUS in one pass
const de = einvoice.validate(xml, { cius: 'xrechnung' });
for (const f of de.findings) console.log(f.source, f.id);   // 'xrechnung BR-DE-16'
einvoice.cius();                              // [{ name, version, phases }]

// A network's own bundle in place of this build's EN 16931 artefacts
const bis = einvoice.validate(xml, { profile: 'peppol' });  // Peppol BIS Billing 3.0
bis.profile;                                  // 'peppol' — whose artefacts spoke
einvoice.profiles();                          // [{ name, version, phases }]

// Factur-X / ZUGFeRD: a PDF that carries its own invoice XML inside
const audit = einvoice.inspect(pdfBytes);     // Uint8Array, e.g. fs.readFile
audit.ok;                                     // would a conformance validator accept the PDF?
audit.findings;                               // envelope: pdfa.*, fx.* — with stable ids
audit.rules?.valid;                           // the invoice inside, business rules
const de = einvoice.inspect(pdfBytes, { cius: 'xrechnung' });  // rules for the payload only

const doc = einvoice.extract(pdfBytes);       // { name, envelope, xml } — the attachment

// The model: read a document into it, write a model out, convert between syntaxes
const read = einvoice.parse(xml);
read.invoice.id;                              // the amounts as stated, wrong ones included
read.issues;                                  // what it says that the model cannot hold

const made = einvoice.render(read.invoice, { syntax: 'CII', profile: 'peppol' });
made.rules.valid;                             // the document it just wrote, checked
made.problems;                                // e.g. a payable that disagrees with its lines

const other = einvoice.convert(xml);          // UBL to CII, or CII to UBL
other.source;                                 // 'UBL' — what it started as
```

Load it in a browser the same way; nothing Node-specific is required:

```html
<script type="module">
  import { loadEinvoice } from 'https://cdn.example/einvoice/dist/index.js';
  const einvoice = await loadEinvoice();
</script>
```

`loadEinvoice()` memoises the instantiation, so calling it per form submit does
not re-download or re-instantiate the module.

### API

| Member | Returns |
| --- | --- |
| `validate(xml, { syntax?, phases?, cius?, profile? })` | `{ syntax, valid, findings, schema, fatal, warn, internal, cius?, profile? }` |
| `detect(xml)` | `'CII'` \| `'UBL'` |
| `phases(syntax?)` | `string[]` — phase ids available for that syntax |
| `cius()` | `Array<{ name, version, phases: { CII, UBL } }>` — national rule sets this build carries |
| `profiles()` | `Array<{ name, version, phases: { CII, UBL } }>` — network bundles this build carries |
| `inspect(pdf, { cius?, profile? })` | `{ envelope, payload?, declared?, pages, ok, findings, rules? }` — hybrid PDF (Factur-X, ZUGFeRD, Order-X) audited once |
| `extract(pdf)` | `{ name, envelope, xml }` — the invoice XML attachment, uncompressed |
| `embedPDF(pdf, xml, { profile?, conformance?, … }, opts?)` | `{ pdf: Uint8Array, check }` — hybrid PDF written from an ordinary PDF plus an invoice XML, audited after writing |
| `parse(xml)` | `{ invoice, syntax, issues }` — the document read into the EN 16931 model |
| `render(model, { syntax?, profile?, cius?, phases? })` | `{ xml, syntax, rules, problems }` — a model written out, and that document checked |
| `convert(xml, opts?)` | `{ xml, syntax, source, invoice, rules, problems, issues }` — a document rewritten in the other syntax |
| `version` | engine version string |

`syntax` forces one grammar instead of detecting it; `phases` restricts which
rule phases run (see `phases()`). `cius` adds a country rule set on top of the
norm. `profile` validates against a network's published bundle instead of this
build's EN 16931 artefacts — the bundle carries its own copy of the norm, so the
verdict is the one that network's validator would give. A `cius` still runs on
top of a `profile`. An unknown name in either throws `EinvoiceError` listing
what is available, rather than quietly checking less. Every finding says which
rule set wrote it in `source` — `en16931`, `xrechnung`, `peppol` — and
`result.cius` / `result.profile` echo what ran.

`inspect` returns two verdicts that do not move together, and keeps them apart on
purpose. `ok` and `findings` describe the PDF envelope — PDF/A, XMP, the
attachment and its metadata. `rules` is a `validate` result for the XML inside,
against whichever rule set you asked for; it is absent when the PDF carries no
XML at all, or when the engine could not read what it does carry, in which case a
`fx.rules` finding in `findings` says why. A well-formed envelope can hold an
invoice that breaks BR-CO-15, and repairing the PDF would not repair that.

`embedPDF` goes the other way: an ordinary PDF and an invoice XML in, one
Factur-X / ZUGFeRD file out. It returns `check`, the audit of the bytes it just
wrote, because a generator that announces "done" without looking is selling a
file a recipient may reject. The envelope it writes is always complete; what comes
back is only as clean as the PDF you handed it — unembedded fonts, transparency and
missing markup belong to the page content, and `check.findings` reports them as
`pdfa.*` errors instead of pretending otherwise. The third argument is the
PDF-side settings (`profile`, `conformance`, `title`, `tagged`, `now`, …); the
fourth is the rule set to run over the invoice inside, which is the same options
object `validate` takes.

```ts
const made = einvoice.embedPDF(pdfBytes, xml, { title: 'Invoice INV-2026-041', lang: 'en-GB' });
made.check.ok;                       // would a conformance validator accept it?
made.check.envelope;                 // 'Factur-X EN 16931'
made.check.rules?.valid;             // the invoice inside, business rules
fs.writeFileSync('invoice.pdf', made.pdf);
```

`validate`, `parse` and `render` answer three different questions, which is why
they are three calls. `validate` asks whether a document obeys the rules. `parse`
asks what it says: a document that breaks BR-CO-15 parses with the wrong total in
hand, because the job is to read the invoice a customer has sent, not to refuse
it. `render` writes a model out and validates the document it produced, so a model
that cannot satisfy the rule set you named fails there rather than in someone's
inbox. `render` accepts a model object or a JSON string, and refuses a key the
model has no room for — a key nothing in the standard carries is a value about to
be lost, and a silent drop is the worst way to find that out. The `InvoiceModel`
types are exported for TypeScript callers. The `issues` on `parse` and `convert`
list what a source document said that has no term in the model, each with the
place in the document it was found; a document that fits completely comes back
with an empty list, never `null`.

`findings` is always an array — valid documents yield `[]` — so the JSON shape
never changes between cases. Severity split:

* `fatal` — a failed EN 16931 business rule (the document is not conformant)
* `warn` — a soft or informational rule
* `internal` — engine diagnostics; should be zero, report it if it is not

`countById(findings)` reduces findings to `{ 'BR-21': 1, ... }`.

## Speed

The engine is native Go compiled to WebAssembly, and the port is slower than
the library it comes from: about **31 ms per document** validating the official
CEF corpus in Node 26 on one core of a Ryzen 9 5950X — around 32 documents a
second, so a page validates the file someone dropped on it in a few tens of
milliseconds. A browser is the same module with a different host; the first
validation also pays for compiling the binary, which is why a long-lived page
or worker is cheaper per document than a fresh one.

The native figures — 7.9 ms a document, 125 a second on one core — are measured
in [the Go repository](https://github.com/DCNWS/invoicekit.go#speed), where the
benchmark lives.

## What it does not check

* Anything the XML schema does not say. `result.schema` reports elements that
  are unknown, out of order, repeated or missing, but the schema cannot tell you
  that an amount is wrong; that is what the rules are for.
* Any profile you do not ask for. `{ cius: 'xrechnung' }` adds the German BR-DE,
  BR-DEX, BR-DE-CVD and BR-TMP rules; `{ profile: 'peppol' }` swaps in Peppol BIS
  Billing 3.0. French Factur-X adds no Schematron rules beyond EN 16931 — what it
  adds is the hybrid PDF envelope, covered by `inspect()` and `extract()`.
* Anything about the invoice being *true*. Conformance is not a legality or
  tax opinion.

## Tests

```sh
npm test          # builds, then node --test test/
```

The suite boots the wasm module in Node over the fixtures in `test/fixtures` —
the same samples the Go suite uses, plus hybrid PDFs written by the Go CLI —
and then, if the official CEF corpus is present, runs 44 reference documents
through it expecting zero findings. Point `EINVOICE_REF` at the corpus if it is
not at `../ref-en16931`; without it those cases skip rather than fail.

## Licence

MIT for this package. The rule sets inside the WebAssembly binary are other
people's copyright, redistributed unmodified as data: the EN 16931 Schematrons
(EUPL-1.2, European Commission), the XRechnung sets (Apache-2.0, German Federal
CoSIT) and the Peppol BIS bundle (CEN EN 16931 business terms under EUPL-1.2 plus
the OpenPEPPOL extensions under Apache-2.0, Peppol AISBL). See `NOTICE.md` and
`LICENSES/` here, and the same files in
[`invoicekit.go`](https://github.com/DCNWS/invoicekit.go).
