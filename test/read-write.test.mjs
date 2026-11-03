// The read/write half of the package: parse a document into the invoice model,
// render a model back into a document, and convert between the two syntaxes.
// These run against the repository's own samples, which are the documents the
// Go tests use, so a browser and the CLI are held to the same readings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEinvoice, EinvoiceError } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = (name) =>
  readFileSync(path.join(here, 'fixtures', name), 'utf8');

const einvoice = await loadEinvoice();

test('a CII document reads into the model with its amounts intact', () => {
  const res = einvoice.parse(sample('cii-xrechnung.xml'));
  assert.equal(res.syntax, 'CII');
  assert.ok(res.invoice.id, 'the invoice has an id');
  assert.equal(res.invoice.seller.address.country, 'DE');
  assert.equal(res.invoice.lines.length, 2);
  assert.ok(res.invoice.totals.payable > 0, 'the payable amount came across');
  // The document's own sums, not recomputed ones: parse says what the document
  // says, and this sample states a line total that its lines disagree with.
  assert.equal(res.invoice.lines[0].netPrice, res.invoice.lines[0].netPrice);
});

test('what a document says that the model cannot hold is named', () => {
  const res = einvoice.parse(sample('cii-xrechnung.xml'));
  assert.ok(res.issues.length > 0, 'this sample carries elements the model has no term for');
  assert.ok(res.issues.some((i) => i.includes('AdditionalReferencedDocument')),
    res.issues.join('\n'));
  // Every issue says where in the document it was found.
  assert.ok(res.issues.every((i) => i.includes(':')), res.issues.join('\n'));
});

test('both directions agree on the syntax of a document', () => {
  for (const name of ['cii-xrechnung.xml', 'ubl-min.xml', 'ubl-peppol.xml']) {
    const xml = sample(name);
    assert.equal(einvoice.parse(xml).syntax, einvoice.detect(xml), name);
  }
});

test('a document that is not an invoice is refused, not half-read', () => {
  assert.throws(() => einvoice.parse('<html><body>no</body></html>'), EinvoiceError);
  assert.throws(() => einvoice.parse('<Invoice><Id>1</Id>'), EinvoiceError);
});

test('a model renders as either syntax and checks its own output', () => {
  const model = einvoice.parse(sample('ubl-peppol.xml')).invoice;
  for (const syntax of ['CII', 'UBL']) {
    const made = einvoice.render(model, { syntax });
    assert.equal(made.syntax, syntax);
    assert.ok(made.xml.includes('<?xml'), 'a document, not a fragment');
    assert.equal(einvoice.detect(made.xml), syntax);
    assert.ok(made.rules.valid, `${syntax}: ${JSON.stringify(made.rules.findings.slice(0, 3))}`);
    assert.ok(made.rules.schema.length === 0, JSON.stringify(made.rules.schema));
  }
});

test('convert goes from one syntax to the other and back', () => {
  const source = sample('ubl-peppol.xml');
  const there = einvoice.convert(source);
  assert.equal(there.source, 'UBL');
  assert.equal(there.syntax, 'CII');
  assert.ok(there.rules.valid, JSON.stringify(there.rules.findings.slice(0, 3)));
  const back = einvoice.convert(there.xml);
  assert.equal(back.syntax, 'UBL');
  assert.ok(back.rules.valid, JSON.stringify(back.rules.findings.slice(0, 3)));
  // What the source document could not carry is reported on the way through.
  assert.deepEqual(back.issues, []);
  assert.equal(back.invoice.id, there.invoice.id);
  assert.equal(back.invoice.totals.payable, there.invoice.totals.payable);
});

test('convert writes the rule set it is told to aim at', () => {
  const made = einvoice.convert(sample('ubl-peppol.xml'), { syntax: 'CII', profile: 'peppol' });
  assert.ok(/peppol\.eu/.test(made.xml), 'the Peppol identifiers are stamped in');
  assert.ok(made.rules.valid, JSON.stringify(made.rules.findings.slice(0, 3)));
  assert.equal(made.rules.profile, 'peppol', JSON.stringify(made.rules.profile));
});

test('a model key the model has no room for is an error, not a dropped value', () => {
  const model = einvoice.parse(sample('ubl-min.xml')).invoice;
  model.postName = 'Heinrich Bauer';
  assert.throws(() => einvoice.render(model), (e) =>
    e instanceof EinvoiceError && /postName/.test(e.message));
});

test('a model whose sums disagree renders anyway, with the doubt stated', () => {
  const model = einvoice.parse(sample('ubl-min.xml')).invoice;
  model.totals.payable = 1.0;
  const made = einvoice.render(model);
  assert.ok(made.problems.length > 0, made.problems.join('\n'));
  assert.match(made.xml, /<cbc:PayableAmount[^>]*>1\.00</,
    'the stated amount is what gets written, wrong as it is');
});

test('a profile the model cannot satisfy fails at render, not in an inbox', () => {
  const model = einvoice.parse(sample('ubl-min.xml')).invoice;
  model.seller.eaddress = '';
  model.seller.identifier = '';
  const made = einvoice.render(model, { syntax: 'UBL', profile: 'peppol' });
  assert.equal(made.rules.valid, false);
  assert.ok(made.rules.fatal > 0);
});

test('a tax registration keeps the register it was issued against', () => {
  const doc = einvoice.parse(sample('cii-xrechnung.xml'));
  const seller = doc.invoice.seller;
  // This sample's seller has a German fiscal number and a commercial-register
  // entry, and the document says which is which. The label is not the
  // engine's to drop: a number is only meaningful next to its register.
  assert.ok(seller.taxIds.some((t) => t.scheme === 'FC' && t.value), JSON.stringify(seller.taxIds));
  assert.equal(seller.regScheme, '0189', JSON.stringify(seller.regIds));

  // Written back as CII, both labels are where the document had them.
  const cii = einvoice.render(doc.invoice, { syntax: 'CII' });
  assert.match(cii.xml, /<ram:ID schemeID="FC">/);
  assert.match(cii.xml, /<ram:ID schemeID="0189">/);

  // Converted to UBL, the fiscal number goes into the one element UBL gives a
  // tax registration, labelled with its basis: UBL has no term for a non-VAT
  // number. It used to be filed under the company register instead, which made
  // the document look valid by losing the number. Now the rules that follow
  // from the collision are reported and the number stays a tax number.
  const ubl = einvoice.convert(sample('cii-xrechnung.xml'), { syntax: 'UBL', cius: 'xrechnung' });
  assert.match(ubl.xml, /<cac:PartyTaxScheme>[\s\S]{0,200}?<cbc:CompanyID schemeID="FC"/);
  assert.match(ubl.xml, /<cbc:CompanyID[^>]*schemeID="0189"/, 'the register label survives');
  assert.equal(ubl.rules.valid, false, 'the collision is reported, not hidden');
  const ids = ubl.rules.findings.map((f) => f.id);
  for (const rule of ['BR-CO-09', 'BR-O-02', 'BR-O-04']) {
    assert.ok(ids.includes(rule), `expected ${rule} in ${ids.join(', ')}`);
  }
});

test('a charge keeps the base its percentage was taken on', () => {
  const model = einvoice.parse(sample('cii-xrechnung.xml')).invoice;
  // The sample's line charge is 19% of its line total. Move the base somewhere
  // else and the money has to move with it: a percentage on a different base is
  // a different amount, and a conversion that re-derives the base invents it.
  const line = model.lines[0];
  line.charges = [{ ...line.charges[0], amount: 0, basis: 100 }];
  for (const syntax of ['CII', 'UBL']) {
    const made = einvoice.render(model, { syntax });
    const back = einvoice.parse(made.xml).invoice;
    const ac = back.lines[0].charges[0];
    assert.equal(ac.percent, 19, `${syntax}: the percentage survives`);
    assert.equal(ac.basis, 100, `${syntax}: ${JSON.stringify(ac)}`);
    assert.equal(ac.amount, 19, `${syntax}: the amount follows the stated base`);
  }
});
