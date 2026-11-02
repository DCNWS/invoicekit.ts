/**
 * @invoicekit/einvoice — EN 16931 invoice validation in the browser or Node.
 *
 * The engine is the pure-Go validator from github.com/dcnws/invoicekit.go
 * compiled to WebAssembly, so a document validated here produces exactly the
 * same verdict as the Go library, the `einv` CLI and the hosted API — with no
 * network round trip and no document leaving the machine.
 */

import type { InvoiceModel } from './model.js';

export type Syntax = 'CII' | 'UBL';

// The invoice model, in the same JSON shape `einv parse` returns and `einv gen`
// accepts. Re-exported so a caller can type a document viewer or a generator
// without importing the shape from a second place.
export type {
  Address, AllowanceCharge, Account, Attribute, Card, Contact, Delivery,
  FinancialAccount, InvoiceModel, Item, ItemPrice, Line, Mandate, Party,
  Payment, Period, Reference, Seller, TaxExempt, TaxID, Totals, VATRate,
} from './model.js';

export interface Options {
  /** Force a syntax instead of detecting it from the document. */
  syntax?: Syntax;
  /** Restrict the Schematron phases to run (see phases()). */
  phases?: string[];
  /**
   * Name of a country (CIUS) rule set to check on top of EN 16931, e.g.
   * "xrechnung". Unknown names are an error; cius() lists what is available.
   */
  cius?: string;
  /**
   * Name of a network's own rule-set bundle to validate against instead of this
   * build's EN 16931 artefacts, e.g. "peppol" for Peppol BIS Billing 3.0. The
   * bundle ships its own copy of the norm, versions included, which is what
   * makes the verdict match the network's validator. A `cius` still runs on top
   * of it. profiles() lists what is available.
   */
  profile?: string;
}

export interface Finding {
  /** Rule id, e.g. "BR-02" or "BR-CO-15". */
  id: string;
  /** Rule set the assertion belongs to, e.g. "xrechnung". Absent when only
   *  EN 16931 ran. */
  source?: string;
  /** Severity as the rule set declares it: "fatal", "warning" or
   *  "information". */
  flag?: string;
  message: string;
  /** XPath of the node the rule was applied to. */
  context?: string;
  /** Present only if the validator could not evaluate the rule itself. */
  error?: string;
}

/** One structural problem against the syntax's XML schema. These are kept
 *  apart from `findings` because they carry no EN 16931 rule id: the document
 *  is not shaped like an invoice, independently of what it says. */
export interface SchemaFinding {
  /** XPath of the element whose content is at fault. */
  location: string;
  message: string;
}

export interface ValidationResult {
  syntax: Syntax;
  /** False if any business rule, softer constraint, internal error or schema
   *  problem was found. */
  valid: boolean;
  findings: Finding[];
  fatal: number;
  warn: number;
  internal: number;
  /** The country rule set that ran, when one was asked for. */
  cius?: string;
  /** The rule-set bundle that ran, when one was asked for. Its presence means
   *  the findings come from the bundle's artefacts, not this build's. */
  profile?: string;
  /** Present only when the document fails the schema itself. */
  schema?: SchemaFinding[];
}

/** A named rule set this build carries, with the phases it declares per
 *  syntax. `name` is what to pass as `Options.cius` or `Options.profile`. */
export interface RuleSet {
  name: string;
  /** Version of the artefacts, as upstream states it. */
  version: string;
  phases: Partial<Record<Syntax, string[]>>;
}

/** A country (CIUS) rule set this build carries, e.g. "xrechnung". */
export type CiusProfile = RuleSet;

/** A published network rule-set bundle this build carries, e.g. "peppol". */
export type ProfileInfo = RuleSet;

/** Thrown when the input is not an EN 16931 invoice at all. */
export class EinvoiceError extends Error {}

/** PDF/A bytes, as a `File` read with `arrayBuffer()` or `fs.readFile`. */
export type PdfBytes = Uint8Array | ArrayBuffer;

/**
 * An invoice document, as text or as the bytes it was read from.
 *
 * Bytes are accepted so that `fs.readFile(path)` without an encoding and
 * `file.arrayBuffer()` in a browser work as well as a string does: both are
 * ordinary ways to get an XML document, and passing the result straight in is
 * what callers do. A byte-order mark is honoured, and a UTF-16 document is read
 * as UTF-16, so the encoding of the file does not change the verdict.
 */
export type XmlSource = string | Uint8Array | ArrayBuffer;

/** One envelope finding. These are PDF/A and Factur-X rules, not business
 *  rules: a finding here says what a conformance validator would do with the
 *  file, and `rule` is a stable id to react to instead of the message. */
export interface PdfFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/** The audit of a hybrid PDF — an invoice PDF carrying its own XML, as
 *  Factur-X, ZUGFeRD and Order-X do. Identical to `einv check -json`.
 *
 *  Two verdicts, kept apart on purpose: `ok` and `findings` are the envelope,
 *  and `rules` is the business-rule verdict on the invoice inside. They do not
 *  move together — a perfectly acceptable Factur-X envelope can carry an invoice
 *  that breaks BR-CO-15, and fixing the PDF will not fix that. */
export interface CheckResult {
  /** The label the caller gave the document, empty in the browser build. */
  name?: string;
  /** The profile the PDF envelope declares, e.g. "Factur-X EN 16931". */
  envelope?: string;
  /** Filename of the invoice XML inside the PDF, when there is one. */
  payload?: string;
  /** What the XML itself says it is — the half that can disagree. */
  declared?: string;
  pages?: number;
  /** True when a conformance validator would accept the envelope. */
  ok: boolean;
  findings?: PdfFinding[];
  /** The invoice inside, checked against the rule set `inspect` was given.
   *  Absent when the PDF carries no XML, or when its XML could not be read as
   *  an invoice — in that second case a `fx.rules` finding says why. */
  rules?: ValidationResult;
}

/** The invoice XML read out of a hybrid PDF. */
export interface HybridPayload {
  name: string;
  envelope: string;
  xml: string;
}

/**
 * The envelope `embedPDF` writes. These are PDF-side settings only: the rule set
 * the invoice is checked against is the separate last argument of `embedPDF`,
 * because `profile` here means the Factur-X profile the PDF declares, not a
 * network's rule-set bundle.
 */
export interface EmbedOptions {
  /**
   * Profile to declare, e.g. "factur-x/en16931", "factur-x/basic wl",
   * "order-x/extended". Empty means read it from the XML's BT-24 — almost always
   * right. Asking for a profile the XML contradicts is an error: the envelope
   * would claim something the invoice is not.
   */
  profile?: string;
  /** PDF/A-3 flavour to declare: "B" (default), "U" or "A". "A" demands a tagged,
   *  marked-up document, which `tagged` has to assert because this package does
   *  not fabricate structure the content stream does not have. */
  conformance?: 'B' | 'U' | 'A';
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** Application that produced the page content (`/Creator`), not the one that
   *  wrote the envelope. */
  creator?: string;
  /** Document language tag, e.g. "en-GB". PDF/A wants it for text whose language
   *  a reader cannot infer. */
  lang?: string;
  /** Declare the document tagged (`/MarkInfo` plus a structure tree). Set it only
   *  when the content stream really is marked up. */
  tagged?: boolean;
  /** RFC 3339 timestamp to write into XMP, /Info and the attachment parameters.
   *  Defaults to now; pin it to make the output byte-for-byte reproducible. */
  now?: string;
}

/** What `embedPDF` produced: the hybrid file's bytes, and the audit of exactly
 *  those bytes. The audit is not a forecast — it is the verdict on what you are
 *  about to send, from the same engine `inspect` runs. */
export interface EmbedResult {
  pdf: Uint8Array;
  check: CheckResult;
}

/** A document read back into the model: what it says, not whether it obeys. */
export interface ParseResult {
  invoice: InvoiceModel;
  syntax: Syntax;
  /**
   * What the document said that the model has no room for — a tax category
   * outside VAT, an element from a schema this build does not read, a second
   * copy of something the model holds once. Each entry says where in the
   * document it was found. A document that fits the model completely comes back
   * with an empty list.
   */
  issues: string[];
}

export interface RenderOptions extends Options {
  /** The syntax to write. Defaults to UBL. */
  syntax?: Syntax;
}

/** A document rendered from a model, with a verdict on that document. */
export interface RenderResult {
  xml: string;
  syntax: Syntax;
  /** The business-rule and schema verdict on the document just written. */
  rules: ValidationResult;
  /** Advisory problems in the model itself, such as totals that disagree. */
  problems: string[];
}

/** A document read, rewritten in the other syntax, and checked. */
export interface ConvertResult extends RenderResult {
  source: Syntax;
  invoice: InvoiceModel;
  issues: string[];
}

export interface Einvoice {
  readonly version: string;
  validate(xml: XmlSource, opts?: Options): ValidationResult;
  detect(xml: XmlSource): Syntax;
  phases(syntax?: Syntax): string[];
  cius(): CiusProfile[];
  profiles(): ProfileInfo[];
  inspect(pdf: PdfBytes, opts?: Options): CheckResult;
  extract(pdf: PdfBytes): HybridPayload;
  embedPDF(pdf: PdfBytes, xml: XmlSource, envelope?: EmbedOptions, opts?: Options): EmbedResult;
  /**
   * Read a document into the invoice model. Validate answers whether a document
   * obeys the rules; parse answers what it says — a document that breaks them
   * parses with the amounts it states, wrong ones included, which is why the two
   * are usually run over the same bytes. An error means the input is not an
   * invoice document at all: not XML, a root that is not an invoice, or XML that
   * stops partway through.
   */
  parse(xml: XmlSource): ParseResult;
  /**
   * Render a model as CII or UBL and validate the document produced, so a model
   * that cannot satisfy the named rule set fails here rather than in a
   * customer's inbox. The model may be an object or a JSON string. Unknown keys
   * are an error: a key the model has no room for is a value about to be lost.
   */
  render(model: InvoiceModel | string, opts?: RenderOptions): RenderResult;
  /**
   * Convert a document between the two syntaxes. Defaults to the other syntax
   * from the one detected, and reports what the source document said that the
   * model could not carry — the loss is stated, not hidden.
   */
  convert(xml: XmlSource, opts?: RenderOptions): ConvertResult;
}

export interface LoadOptions {
  /**
   * Base URL or directory holding `einv.wasm` and `wasm_exec.js`. In the browser
   * this defaults to the package's own `assets/` directory; in Node to the
   * installed package directory.
   */
  assetPath?: string;
}

type GoClass = { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): void };

declare global {
  // eslint-disable-next-line no-var
  var Go: (new () => GoClass) | undefined;
}

interface RawApi {
  version: string;
  validate(xml: string, opts?: Options): ValidationResult | { error: string };
  detect(xml: string): Syntax | { error: string };
  phases(syntax?: Syntax): string[] | { error: string };
  cius(): CiusProfile[] | { error: string };
  profiles(): ProfileInfo[] | { error: string };
  inspect(pdf: PdfBytes, opts?: Options): CheckResult | { error: string };
  extract(pdf: PdfBytes): HybridPayload | { error: string };
  embed(pdf: PdfBytes, xml: string, envelope?: EmbedOptions, opts?: Options): EmbedResult | { error: string };
  parse(xml: string): ParseResult | { error: string };
  render(model: unknown, opts?: RenderOptions): RenderResult | { error: string };
}

function isErr(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v &&
    typeof (v as { error: unknown }).error === 'string';
}

function unwrap<T>(v: T | { error: string }): T {
  if (isErr(v)) throw new EinvoiceError(v.error);
  return v as T;
}

/**
 * Normalise an XML argument to text, and complain about the argument rather
 * than the document when the argument is not a document at all.
 *
 * The engine speaks strings. Handing it a `Buffer` directly produced its
 * complaint about a root element, which reads as a parsing failure and sends a
 * caller looking at their XML when the mistake is in the call. TypeScript
 * rejects that call at compile time; JavaScript callers deserve a sentence that
 * names the mistake, so the conversion happens here and the type error is ours.
 */
function toXmlText(input: XmlSource, method: string): string {
  if (typeof input === 'string') return input;
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array)) {
    const got = input === null ? 'null' : typeof input;
    throw new TypeError(
      `${method}() takes XML as a string or bytes, not ${got}. ` +
      `readFileSync(path) without an encoding, or file.arrayBuffer(), gives bytes that work here.`);
  }
  // A BOM is the only encoding signal a byte string carries, so it decides the
  // decoder. XML permits UTF-16 documents, and decoding one as UTF-8 would
  // produce a nul-separated mess the parser would blame the document for.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    // fatal: a lone surrogate or an impossible sequence is a broken file, and
    // TextDecoder would otherwise hand the parser a replacement character and
    // let it guess.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new EinvoiceError(
      `${method}() was given bytes that are not UTF-8 XML text. ` +
      `A UTF-16 document needs its byte-order mark, and a non-XML file (a PDF, a spreadsheet) has no business here.`);
  }
}

function baseOf(o?: LoadOptions): string {
  const base = o?.assetPath ?? new URL('../assets/', import.meta.url).href;
  return base.endsWith('/') ? base : base + '/';
}

function fileURLToPath(url: string): string {
  let p = url.replace(/^file:\/\//, '');
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  p = decodeURIComponent(p);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // windows: file:///C:/x -> C:/x
  return p;
}

async function readBytes(url: string): Promise<ArrayBuffer> {
  if (/^https?:/i.test(url) && typeof fetch === 'function') {
    const r = await fetch(url);
    if (!r.ok) throw new EinvoiceError(`could not read ${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  }
  const path = url.startsWith('file:') ? fileURLToPath(url) : url;
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return new Uint8Array(buf).buffer;
}

async function installGoRuntime(base: string): Promise<void> {
  if (typeof globalThis.Go === 'function') return;
  // wasm_exec.js needs require() for its Node-specific parts (fs, path).
  if (typeof process !== 'undefined' && process.versions?.node &&
      typeof (globalThis as Record<string, unknown>).require === 'undefined') {
    const { createRequire } = await import('node:module');
    (globalThis as Record<string, unknown>).require = createRequire(import.meta.url);
  }
  const src = new TextDecoder().decode(await readBytes(base + 'wasm_exec.js'));
  (0, eval)(src);
  if (typeof globalThis.Go !== 'function') {
    throw new EinvoiceError('wasm_exec.js did not define the Go runtime');
  }
}

async function awaitApi(): Promise<RawApi> {
  const w = globalThis as unknown as { einvoice?: RawApi };
  const deadline = Date.now() + 60000;
  while (!w.einvoice) {
    if (Date.now() > deadline) {
      throw new EinvoiceError('the WebAssembly module did not publish its API');
    }
    await new Promise(r => setTimeout(r, 10));
  }
  return w.einvoice;
}

let loading: Promise<Einvoice> | null = null;

/**
 * Load the validator. The WebAssembly module is instantiated once per process;
 * concurrent and subsequent calls share it.
 */
export function loadEinvoice(opts?: LoadOptions): Promise<Einvoice> {
  if (!loading) loading = instantiate(baseOf(opts));
  return loading;
}

async function instantiate(base: string): Promise<Einvoice> {
  await installGoRuntime(base);
  const go = new globalThis.Go!();
  const bytes = await readBytes(base + 'einv.wasm');
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  // go.run never settles for a server-style main(), so do not await it.
  void go.run(instance);
  const raw = await awaitApi();
  return {
    version: raw.version,
    validate(xml: XmlSource, o?: Options) {
      return unwrap<ValidationResult>(raw.validate(toXmlText(xml, 'validate'), o));
    },
    detect(xml: XmlSource) {
      return unwrap<Syntax>(raw.detect(toXmlText(xml, 'detect')));
    },
    phases(syntax?: Syntax) {
      return unwrap<string[]>(raw.phases(syntax));
    },
    cius() {
      return unwrap<CiusProfile[]>(raw.cius());
    },
    profiles() {
      return unwrap<ProfileInfo[]>(raw.profiles());
    },
    inspect(pdf: PdfBytes, o?: Options) {
      return unwrap<CheckResult>(raw.inspect(pdf, o));
    },
    extract(pdf: PdfBytes) {
      return unwrap<HybridPayload>(raw.extract(pdf));
    },
    embedPDF(pdf: PdfBytes, xml: XmlSource, e?: EmbedOptions, o?: Options) {
      return unwrap<EmbedResult>(raw.embed(pdf, toXmlText(xml, 'embedPDF'), e, o));
    },
    parse(xml: XmlSource) {
      return unwrap<ParseResult>(raw.parse(toXmlText(xml, 'parse')));
    },
    render(model: InvoiceModel | string, o?: RenderOptions) {
      return unwrap<RenderResult>(raw.render(model, o));
    },
    convert(xml: XmlSource, o?: RenderOptions) {
      const read = unwrap<ParseResult>(raw.parse(toXmlText(xml, 'convert')));
      const target: Syntax = o?.syntax ?? (read.syntax === 'CII' ? 'UBL' : 'CII');
      const made = unwrap<RenderResult>(raw.render(read.invoice, { ...o, syntax: target }));
      return { ...made, source: read.syntax, invoice: read.invoice, issues: read.issues };
    },
  };
}

/** Count findings by rule id — handy for dashboards and tests. */
export function countById(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.id] = (out[f.id] ?? 0) + 1;
  return out;
}
