#!/usr/bin/env node
// Times the WebAssembly build over the same documents the Go benchmarks run, so
// the two sets of numbers mean the same thing. The READMEs quote these: run this
// before changing a published figure.
//
//   ./scripts/bench-wasm.mjs [path-to-ref-en16931]
//
// Pin the process to one core to make runs comparable:
//   taskset -c 2 ./scripts/bench-wasm.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEinvoice } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = process.argv[2] ?? path.join(here, '..', '..', 'ref-en16931');

const einvoice = await loadEinvoice();

// Reference folders hold rule fragments whose root element is not an invoice at
// all, so a document counts only if the engine reads it as the syntax measured.
const readsAs = (xml, syntax) => {
	try {
		return einvoice.detect(xml) === syntax;
	} catch {
		return false;
	}
};

const fromDir = (dir, syntax) => {
	if (!existsSync(dir)) throw new Error(`no corpus at ${dir}`);
	const found = readdirSync(dir)
		.filter((f) => f.endsWith('.xml'))
		.sort()
		.map((f) => readFileSync(path.join(dir, f), 'utf8'))
		.filter((xml) => readsAs(xml, syntax));
	if (found.length === 0) throw new Error(`no ${syntax} documents in ${dir}`);
	return found;
};

// The UBL corpus is the 29 official CEF files; the CII document is the single
// XRechnung sample, repeated so one document still produces an average.
const corpora = [
	{ name: 'UBL', docs: fromDir(path.join(ref, 'test', 'testfiles'), 'UBL') },
	{ name: 'CII', docs: Array(25).fill(readFileSync(path.join(here, '..', 'test', 'fixtures', 'cii-xrechnung.xml'), 'utf8')) },
];

console.log(`engine ${einvoice.version}, node ${process.version}, ${new Date().toUTCString()}`);
for (const { name, docs } of corpora) {
	if (!readsAs(docs[0], name)) throw new Error(`the ${name} corpus starts with a document that is not ${name}`);
	// A warm-up pass first: the first call pays for the Go runtime boot and the
	// wasm page faults, which no caller pays twice.
	for (const doc of docs) einvoice.validate(doc);
	const started = performance.now();
	for (const doc of docs) einvoice.validate(doc);
	const elapsed = performance.now() - started;
	console.log(
		`${name}\t${docs.length} documents\t${(elapsed / docs.length).toFixed(1)} ms per document\t${Math.round((docs.length / elapsed) * 1000)} documents/second`,
	);
}
