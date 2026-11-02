// Exercises the published TypeScript surface end to end: WASM boot in Node,
// then the official CEF reference corpus through the same code path a browser
// customer would hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEinvoice, countById, EinvoiceError } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = process.env.EINVOICE_REF ?? path.join(here, '..', '..', '..', 'ref-en16931');

const xmlIn = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.xml')).sort() : [];

const einvoice = await loadEinvoice();

// The bundled engine and the package carry the same version by contract: the
// tarball ships assets built from the engine release it is named after, so a
// mismatch means a stale binary or a version bump that forgot to rebuild.
test('the bundled engine reports the package version', () => {
  const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  assert.match(einvoice.version, /^\d+\.\d+\.\d+$/);
  assert.equal(einvoice.version, pkg.version);
});

test('UBL reference documents are valid', () => {
  const dir = path.join(ref, 'test', 'testfiles');
  const files = xmlIn(dir);
  if (files.length === 0) {
    console.log(`skip: no UBL corpus in ${dir}`);
    return;
  }
  for (const f of files) {
    const xml = readFileSync(path.join(dir, f), 'utf8');
    assert.equal(einvoice.detect(xml), 'UBL', f);
    const res = einvoice.validate(xml);
    assert.equal(res.syntax, 'UBL', f);
    assert.ok(res.valid, `${f}: ${JSON.stringify(res.findings.slice(0, 3))}`);
    assert.equal(res.findings.length, 0, f);
  }
});

test('CII reference documents are valid', () => {
  const dir = path.join(ref, 'cii', 'examples');
  const files = xmlIn(dir);
  if (files.length === 0) {
    console.log(`skip: no CII corpus in ${dir}`);
    return;
  }
  for (const f of files) {
    const xml = readFileSync(path.join(dir, f), 'utf8');
    assert.equal(einvoice.detect(xml), 'CII', f);
    const res = einvoice.validate(xml);
    assert.ok(res.valid, `${f}: ${JSON.stringify(res.findings.slice(0, 3))}`);
    assert.equal(res.fatal, 0, f);
    assert.equal(res.warn, 0, f);
  }
});

test('a missing invoice number fires BR-21', () => {
  const dir = path.join(ref, 'test', 'testfiles');
  const files = xmlIn(dir);
  if (files.length === 0) return;
  const xml = readFileSync(path.join(dir, files[0]), 'utf8');
  const broken = xml.replace('<cbc:ID>1</cbc:ID>', '');
  assert.notEqual(broken, xml, 'fixture shape changed');

  const res = einvoice.validate(broken);
  assert.equal(res.valid, false);
  assert.ok(res.fatal > 0);
  assert.equal(res.findings.length, res.fatal + res.warn);
  assert.ok('BR-21' in countById(res.findings), JSON.stringify(res.findings.slice(0, 5)));
});

test('JSON shape is stable for valid and invalid documents', () => {
  const dir = path.join(ref, 'test', 'testfiles');
  const files = xmlIn(dir);
  if (files.length === 0) return;
  const xml = readFileSync(path.join(dir, files[0]), 'utf8');
  const good = einvoice.validate(xml);
  const bad = einvoice.validate(xml.replace('<cbc:ID>1</cbc:ID>', ''));
  assert.ok(good.valid && !bad.valid);
  for (const res of [good, bad]) {
    assert.deepEqual(
      Object.keys(res).sort(),
      ['fatal', 'findings', 'internal', 'schema', 'syntax', 'valid', 'warn']
    );
    assert.ok(Array.isArray(res.findings));
    assert.ok(Array.isArray(res.schema));
    for (const f of res.findings) assert.equal(typeof f.message, 'string');
  }
});

test('phase selection narrows the rule set', () => {
  const phases = einvoice.phases('CII');
  assert.ok(phases.includes('codelist_phase'), phases.join(','));
  assert.ok(phases.length >= 2);
  const dir = path.join(ref, 'cii', 'examples');
  const files = xmlIn(dir);
  if (files.length === 0) return;
  const res = einvoice.validate(readFileSync(path.join(dir, files[0]), 'utf8'), {
    phases: ['codelist_phase'],
  });
  assert.ok(res.valid);
});

test('non-invoice input raises EinvoiceError', () => {
  for (const input of ['hello', '<not-an-invoice/>', '']) {
    assert.throws(() => einvoice.validate(input), (err) => {
      assert.ok(err instanceof EinvoiceError, `${input}: ${err}`);
      return true;
    }, input);
  }
  assert.throws(() => einvoice.detect('hello'), EinvoiceError);
  // `null` is not a document of any kind, so it is a wrong argument rather than
  // a bad one: the wrapper now answers with a TypeError naming the argument,
  // where it used to pass it through and let the engine complain about a root
  // element that was never there.
  assert.throws(() => einvoice.validate(null), TypeError);
});

const xrSample = () =>
  readFileSync(path.join(here, 'fixtures', 'cii-xrechnung.xml'), 'utf8');

test('cius() lists the profile rule sets this build carries', () => {
  const profiles = einvoice.cius();
  assert.ok(Array.isArray(profiles) && profiles.length > 0, 'no CIUS rule sets in this build');
  const xr = profiles.find((p) => p.name === 'xrechnung');
  assert.ok(xr, `xrechnung missing from ${JSON.stringify(profiles)}`);
  assert.ok(xr.version, 'the version should come from the artefacts themselves');
  for (const syntax of ['CII', 'UBL']) {
    const phases = xr.phases[syntax];
    assert.ok(Array.isArray(phases) && phases.includes('xrechnung-model'),
      `${syntax}: ${JSON.stringify(xr.phases)}`);
  }
});

test('an unknown CIUS name is an error, not a quiet EN 16931-only check', () => {
  assert.throws(() => einvoice.validate(xrSample(), { cius: 'peppol' }), (err) => {
    assert.ok(err instanceof EinvoiceError, String(err));
    assert.match(String(err), /xrechnung/, 'the message should say what is available');
    return true;
  });
});

// The shipped sample is EN 16931 clean; only the German rules have anything to
// say about it, and upstream declares those three as warnings rather than fatal
// errors. A build that lost the artefacts would pass a test that only checks
// the EN 16931 verdict, which is why this one pins the profile findings too.
test('the XRechnung sample earns German warnings on top of a clean EN 16931 run', () => {
  const xml = xrSample();
  assert.equal(einvoice.validate(xml).findings.length, 0, 'EN 16931 alone should be clean');
  const res = einvoice.validate(xml, { cius: 'xrechnung' });
  assert.equal(res.cius, 'xrechnung');
  assert.equal(res.internal, 0, 'every CIUS rule must be evaluable');
  assert.equal(res.fatal, 0, JSON.stringify(res.findings.slice(0, 3)));
  assert.ok(!res.valid, 'the sample declares no XRechnung business process');
  const ids = Object.keys(countById(res.findings));
  for (const id of ['BR-DE-21', 'BR-DE-27', 'BR-DE-28']) {
    assert.ok(ids.includes(id), `expected ${id} in ${ids.join(',')}`);
  }
  for (const f of res.findings) {
    assert.equal(f.source, 'xrechnung', f.id);
    assert.equal(f.flag, 'warning', `${f.id} flag`);
  }
});

test('CIUS rules run for UBL documents too', () => {
  const dir = path.join(ref, 'test', 'testfiles');
  const files = xmlIn(dir);
  if (files.length === 0) return;
  const res = einvoice.validate(readFileSync(path.join(dir, files[0]), 'utf8'), {
    cius: 'xrechnung',
  });
  assert.equal(res.syntax, 'UBL');
  assert.equal(res.cius, 'xrechnung');
  assert.equal(res.internal, 0);
});

const peppolSample = () =>
  readFileSync(path.join(here, 'fixtures', 'ubl-peppol.xml'), 'utf8');

test('profiles() lists the rule-set bundles this build carries', () => {
  const bundles = einvoice.profiles();
  assert.ok(Array.isArray(bundles) && bundles.length > 0, 'no profile bundles in this build');
  const peppol = bundles.find((p) => p.name === 'peppol');
  assert.ok(peppol, `peppol missing from ${JSON.stringify(bundles)}`);
  assert.match(peppol.version, /Peppol/, 'the version should say whose artefacts these are');
  for (const syntax of ['CII', 'UBL']) {
    const phases = peppol.phases[syntax];
    assert.ok(Array.isArray(phases) && phases.length > 0, `${syntax}: ${JSON.stringify(peppol.phases)}`);
  }
});

test("the Peppol sample is clean under Peppol's own bundle", () => {
  const res = einvoice.validate(peppolSample(), { profile: 'peppol' });
  assert.equal(res.syntax, 'UBL');
  assert.equal(res.profile, 'peppol');
  assert.equal(res.internal, 0, 'every rule of the bundle must be evaluable');
  assert.ok(res.valid, JSON.stringify(res.findings.slice(0, 3)));
  assert.equal(res.findings.length, 0);
});

// A bundle carries its own copy of the norm, so a document can earn a different
// verdict from the one this build's EN 16931 artefacts give it: the network's
// artefacts replace ours instead of adding to them. Type 381 is a perfectly
// valid UNTDID 1001 invoice type; it is only Peppol BIS Billing that rules it
// out, and that is exactly the difference a customer on the network needs.
test("the peppol bundle stands in for this build's EN 16931 artefacts", () => {
  const xml = peppolSample().replace(
    '<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>',
    '<cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode>'
  );

  const base = einvoice.validate(xml);
  assert.deepEqual(Object.keys(countById(base.findings)), ['BR-CL-01'], JSON.stringify(base.findings));
  assert.equal(base.findings[0].source, 'en16931');

  const res = einvoice.validate(xml, { profile: 'peppol' });
  assert.equal(res.profile, 'peppol');
  assert.equal(res.internal, 0, 'every rule of the bundle must be evaluable');
  const byId = countById(res.findings);
  assert.ok(byId['BR-CL-01'], 'the bundle carries its own copy of the norm');
  assert.ok(byId['PEPPOL-EN16931-P0100'], JSON.stringify(res.findings));
  const norm = res.findings.find((f) => f.id === 'BR-CL-01');
  assert.equal(norm.source, 'peppol-cen', 'the finding must be credited to the bundle, not our copy');
});

test('a country rule set still runs on top of a bundle', () => {
  const res = einvoice.validate(peppolSample(), { profile: 'peppol', cius: 'xrechnung' });
  assert.equal(res.profile, 'peppol');
  assert.equal(res.cius, 'xrechnung');
  assert.equal(res.internal, 0);
});

test('an unknown profile name is an error, not a quiet EN 16931-only run', () => {
  assert.throws(() => einvoice.validate(peppolSample(), { profile: 'peppol-bis' }), (err) => {
    assert.ok(err instanceof EinvoiceError, String(err));
    assert.match(String(err), /peppol/, 'the message should say what is available');
    return true;
  });
});
