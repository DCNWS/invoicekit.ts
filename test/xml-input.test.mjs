// What the document-taking methods accept, and what they say when they get
// something else. TypeScript stops a typed caller from passing bytes to a
// string parameter; the JavaScript escape hatch is where this actually bites,
// and a Buffer handed to validate() used to come back as the engine's
// "object is not an EN 16931 invoice root element" — a parsing complaint that
// describes the document rather than the mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEinvoice } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ubl = readFileSync(path.join(here, 'fixtures', 'ubl-min.xml'), 'utf8');
const cii = readFileSync(path.join(here, 'fixtures', 'cii-xrechnung.xml'), 'utf8');

const einvoice = await loadEinvoice();

const utf8 = (s) => new TextEncoder().encode(s);
const utf16le = (s) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe;                    // BOM
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) & 0xff;
    out[3 + i * 2] = s.charCodeAt(i) >> 8;
  }
  return out;
};

test('bytes are accepted wherever XML text is, and give the same verdict', () => {
  const asText = einvoice.validate(ubl);
  for (const [label, input] of [
    ['Buffer', Buffer.from(ubl, 'utf8')],
    ['Uint8Array', utf8(ubl)],
    ['ArrayBuffer', utf8(ubl).buffer],
  ]) {
    const res = einvoice.validate(input);
    assert.equal(res.syntax, asText.syntax, label);
    assert.equal(res.valid, asText.valid, label);
    assert.deepEqual(res.findings, asText.findings, label);
  }
});

test('detect, parse and convert accept bytes too', () => {
  assert.equal(einvoice.detect(Buffer.from(cii, 'utf8')), 'CII');
  assert.equal(einvoice.detect(utf8(cii).buffer), 'CII');

  const fromBytes = einvoice.parse(new Uint8Array(utf8(cii)));
  const fromText = einvoice.parse(cii);
  assert.deepEqual(fromBytes.invoice, fromText.invoice);
  assert.equal(fromBytes.syntax, 'CII');

  // Compared against the same document as text, rather than against a verdict:
  // what this test is about is that the delivery mechanism changes nothing.
  const rewrote = einvoice.convert(Buffer.from(cii, 'utf8'));
  const alsoRewrote = einvoice.convert(cii);
  assert.equal(rewrote.source, 'CII');
  assert.equal(rewrote.syntax, 'UBL');
  assert.equal(rewrote.rules.valid, alsoRewrote.rules.valid);
  assert.deepEqual(rewrote.rules.findings, alsoRewrote.rules.findings);
  assert.deepEqual(rewrote.issues, alsoRewrote.issues);
});

test('a byte-order mark does not change what the document says', () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(ubl)]);
  const res = einvoice.validate(withBom);
  assert.ok(res.valid, JSON.stringify(res.findings.slice(0, 3)));
  assert.equal(einvoice.detect(withBom), 'UBL');
});

test('a UTF-16 document is read as UTF-16', () => {
  const res = einvoice.validate(utf16le(ubl));
  assert.equal(res.syntax, 'UBL');
  assert.ok(res.valid, JSON.stringify(res.findings.slice(0, 3)));
});

test('a wrong argument type is reported as a wrong argument, not a bad document', () => {
  const cases = [
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { invoice: 'here it is' }],
    ['a DOM-ish thing', { nodeType: 1, nodeName: 'Invoice' }],
  ];
  for (const [label, input] of cases) {
    for (const method of ['validate', 'detect', 'parse', 'convert']) {
      assert.throws(
        () => einvoice[method](input),
        (err) => {
          assert.ok(err instanceof TypeError, `${method}(${label}): expected a TypeError, got ${err}`);
          assert.match(err.message, new RegExp(`^${method}\\(\\)`), `${method}(${label})`);
          assert.match(err.message, /string or bytes/, `${method}(${label})`);
          // The engine's parse-level complaint must not be what a caller reads.
          assert.doesNotMatch(err.message, /root element/, `${method}(${label})`);
          return true;
        },
        `${method}(${label}) should throw a TypeError naming the method`,
      );
    }
  }
});

test('bytes that are not XML text say so, rather than quoting the parser', () => {
  const notText = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0xc3, 0x28]);
  for (const method of ['validate', 'detect', 'parse', 'convert']) {
    assert.throws(
      () => einvoice[method](notText),
      (err) => {
        assert.match(err.message, /not UTF-8|not XML text/, `${method}: ${err.message}`);
        return true;
      },
      `${method} on undecodable bytes should complain about the bytes`,
    );
  }
});

test('a document that really is broken is still reported by the engine', () => {
  // The guard must not swallow the useful errors it sits in front of.
  assert.throws(() => einvoice.validate('<?xml version="1.0"?><nope/>'), (err) => {
    assert.match(err.message, /root element|not an EN 16931/i, err.message);
    return true;
  });
  assert.throws(() => einvoice.validate('not xml at all'), (err) => {
    assert.match(err.message, /XML|root element/i, err.message);
    return true;
  });
});
