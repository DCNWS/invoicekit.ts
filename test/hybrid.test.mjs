// Hybrid PDFs — Factur-X / ZUGFeRD envelopes — through the browser build:
// audit, extract, and the extracted XML validated by the same instance.
// Nothing here touches the network; the PDF never leaves the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEinvoice, EinvoiceError } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => new Uint8Array(readFileSync(path.join(here, 'fixtures', name)));

const einvoice = await loadEinvoice();

test('a conformant hybrid PDF audits clean', () => {
  const res = einvoice.inspect(fixture('hybrid-a3.pdf'));
  assert.equal(res.ok, true, JSON.stringify(res.findings));
  assert.equal(res.envelope, 'Factur-X EN 16931');
  assert.equal(res.payload, 'factur-x.xml');
  assert.equal(res.declared, 'Factur-X EN 16931');
  assert.equal(res.pages, 1);
  const rules = res.findings.map((f) => f.rule);
  assert.ok(rules.includes('pdfa.tagged'), rules.join(','));
  for (const f of res.findings) {
    assert.ok(['error', 'warning', 'info'].includes(f.severity), f.severity);
    assert.ok(f.message.length > 0);
  }
});

test('an unembedded font is reported as an error, not a shrug', () => {
  const res = einvoice.inspect(fixture('hybrid-plain.pdf'));
  assert.equal(res.ok, false);
  const font = res.findings.find((f) => f.rule === 'pdfa.font');
  assert.ok(font, JSON.stringify(res.findings));
  assert.equal(font.severity, 'error');
  assert.match(font.message, /Helvetica/);
});

test('the extracted payload validates in the same instance', () => {
  const doc = einvoice.extract(fixture('hybrid-a3.pdf'));
  assert.equal(doc.name, 'factur-x.xml');
  assert.equal(doc.envelope, 'Factur-X EN 16931');
  assert.equal(einvoice.detect(doc.xml), 'CII');
  const res = einvoice.validate(doc.xml);
  assert.equal(res.syntax, 'CII');
  assert.ok(res.valid, JSON.stringify(res.findings.slice(0, 3)));
});

test('an ArrayBuffer is accepted where a Uint8Array is', () => {
  const bytes = fixture('hybrid-a3.pdf');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(einvoice.inspect(buffer).ok, true);
});

test('an ordinary PDF says so instead of returning an empty invoice', () => {
  const plain = new Uint8Array(readFileSync(path.join(here, 'fixtures', 'invoice-plain.pdf')));
  const doc = einvoice.inspect(plain);
  assert.equal(doc.ok, false);
  assert.equal(doc.payload, undefined);
  const rules = doc.findings.map((f) => f.rule);
  assert.ok(rules.includes('fx.payload'), rules.join(','));
  assert.throws(() => einvoice.extract(plain), EinvoiceError);
});

test('bytes that are not a PDF are refused with a message', () => {
  assert.throws(() => einvoice.inspect(new Uint8Array([1, 2, 3])), /not a PDF|PDF/i);
  assert.throws(() => einvoice.inspect('a string, not bytes'), EinvoiceError);
});

// The envelope answer and the business-rule answer are separate fields, and the
// rule set the caller picks applies to the invoice inside the PDF exactly as it
// does to a loose XML file.
test('inspect also runs the business rules over the invoice inside', () => {
  const res = einvoice.inspect(fixture('hybrid-a3.pdf'));
  assert.ok(res.rules, `no rules block: ${JSON.stringify(res)}`);
  assert.equal(res.rules.syntax, 'CII');
  assert.equal(res.rules.cius, undefined);
  assert.ok(res.rules.valid, JSON.stringify(res.rules.findings.slice(0, 3)));
});

test('a rule set chosen for inspect applies to the PDF, not only to loose XML', () => {
  const res = einvoice.inspect(fixture('hybrid-a3.pdf'), { cius: 'xrechnung' });
  assert.equal(res.rules.cius, 'xrechnung');
  assert.equal(res.rules.valid, false, 'the sample declares Factur-X, not XRechnung');
  assert.ok(res.rules.findings.some((f) => f.id.startsWith('BR-DE')),
    JSON.stringify(res.rules.findings.map((f) => f.id)));
  assert.equal(res.ok, true, 'the envelope verdict does not move with the rule set');
});

test('a PDF with no invoice inside gets an envelope verdict and nothing else', () => {
  const plain = new Uint8Array(readFileSync(path.join(here, 'fixtures', 'invoice-plain.pdf')));
  const res = einvoice.inspect(plain, { cius: 'xrechnung' });
  assert.equal(res.ok, false);
  assert.equal(res.rules, undefined, JSON.stringify(res));
});

test('a rule set this build does not carry is an error, not a finding', () => {
  assert.throws(() => einvoice.inspect(fixture('hybrid-a3.pdf'), { cius: 'xcyphexrechnung' }),
    /unknown CIUS/);
});

// Making a hybrid document, not just reading one. The point of the pair of tests
// below is that embed returns the audit of the bytes it wrote: a generator that
// announced "done" without looking would be selling a file a recipient rejects.
const testdata = path.join(here, 'fixtures');
const file = (name) => new Uint8Array(readFileSync(path.join(testdata, name)));
const sampleXML = readFileSync(path.join(testdata, 'cii-xrechnung.xml'), 'utf8');

test('the wasm build writes the same bytes as the CLI fixture', () => {
  const made = einvoice.embedPDF(file('invoice-pdfa3.pdf'), sampleXML, { now: '2026-10-31T09:00:00Z' });
  assert.ok(made.pdf instanceof Uint8Array, 'expected real bytes, not a Go wrapper');
  assert.ok(made.pdf.byteLength > file('invoice-pdfa3.pdf').byteLength, 'the envelope has to add something');
  assert.deepEqual(Buffer.from(made.pdf), Buffer.from(fixture('hybrid-a3.pdf')),
    'the browser build and the CLI must not drift into two dialects of the standard');
});

test('a clean source PDF comes back as a hybrid document that audits clean', () => {
  const made = einvoice.embedPDF(file('invoice-pdfa3.pdf'), sampleXML);
  assert.equal(made.check.ok, true, JSON.stringify(made.check.findings));
  assert.equal(made.check.envelope, 'Factur-X EN 16931');
  assert.equal(made.check.payload, 'factur-x.xml');
  assert.equal(made.check.declared, 'Factur-X EN 16931');
  assert.equal(made.check.pages, 1);
  assert.ok(made.check.rules.valid, JSON.stringify(made.check.rules.findings.slice(0, 3)));
  // The bytes are the file: reading them back is the verdict on the download.
  const again = einvoice.inspect(made.pdf);
  assert.equal(again.ok, true, JSON.stringify(again.findings));
  assert.equal(again.payload, 'factur-x.xml');
});

test('an unclean source stays unclean, and the report says so', () => {
  const made = einvoice.embedPDF(file('invoice-plain.pdf'), sampleXML);
  const font = made.check.findings.find((f) => f.rule === 'pdfa.font');
  assert.ok(font, JSON.stringify(made.check.findings));
  assert.equal(font.severity, 'error');
  assert.match(font.message, /Helvetica/);
  assert.equal(made.check.ok, false, 'no envelope can be glued over unembedded fonts');
  // The envelope half is complete all the same, which is why the two verdicts
  // are reported separately rather than as one score.
  assert.equal(made.check.payload, 'factur-x.xml');
  assert.ok(made.check.findings.every((f) => f.rule === 'pdfa.font' ||
    ['fx.fonts', 'pdfa.info', 'pdfa.outputintent', 'fx.pagemode', 'pdfa.structtree',
      'pdfa.tagged', 'fx.companion', 'pdfa.af'].includes(f.rule) ||
    f.rule.startsWith('pdfa.') || f.rule.startsWith('fx.')), JSON.stringify(made.check.findings));
});

test('the rule set asked for is the one that answers about the invoice inside', () => {
  const made = einvoice.embedPDF(file('invoice-pdfa3.pdf'), sampleXML, undefined, { cius: 'xrechnung' });
  assert.equal(made.check.rules.cius, 'xrechnung');
  assert.ok(made.check.rules.findings.some((f) => f.id.startsWith('BR-DE')),
    JSON.stringify(made.check.rules.findings.map((f) => f.id)));
  assert.equal(made.check.ok, true, 'the envelope verdict does not move with the rule set');
});

test('a profile the XML contradicts is refused instead of written as a label', () => {
  assert.throws(() => einvoice.embedPDF(file('invoice-pdfa3.pdf'), sampleXML, { profile: 'factur-x/minimum' }),
    /was asked for/);
  assert.throws(() => einvoice.embedPDF(file('invoice-pdfa3.pdf'), sampleXML, { conformance: 'C' }),
    /must be B, U or A/);
});

test('embed needs both halves, and says which is missing', () => {
  assert.throws(() => einvoice.embedPDF(file('invoice-pdfa3.pdf')),
    /expected the PDF bytes and the invoice XML/);
  assert.throws(() => einvoice.embedPDF(file('invoice-pdfa3.pdf'), ''), /no XML to embed/);
  assert.throws(() => einvoice.embedPDF('a string, not bytes', sampleXML), EinvoiceError);
});
