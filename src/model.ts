/**
 * The syntax-neutral invoice model.
 *
 * One shape serves both directions: `einv parse` returns it from a document,
 * `einv render` (and the CLI's `einv gen`) writes a document from it, and the
 * hosted API accepts the same JSON. Field names follow the EN 16931 terms
 * rather than either syntax, so nothing is named after a UBL or CII element.
 *
 * Amounts are plain JSON numbers. A missing total means "compute it": rendering
 * works the sums out by the arithmetic EN 16931 requires, and parsing reports
 * the amounts the document itself states, wrong ones included.
 *
 * A field marked "CII only" or "UBL only" is carried by that syntax and dropped
 * by the other, which the reader reports as an issue rather than losing quietly.
 */

/** A postal address: BG-5 seller, BG-8 buyer, BG-15 deliver-to. */
export interface Address {
  line1?: string; // BT-35 / BT-50 / BT-75
  line2?: string; // BT-36 / BT-51 / BT-76
  line3?: string; // BT-162 / BT-163 / BT-165, e.g. a P.O. box
  city?: string; // BT-37 / BT-52 / BT-77
  zone?: string; // BT-39 / BT-54 / BT-79, the country subdivision
  postalCode?: string; // BT-38 / BT-53 / BT-78
  country: string; // BT-40 / BT-55 / BT-80, ISO 3166-1 alpha-2
}

/** BT-41 to BT-43. Only the seller has a contact group in EN 16931. */
export interface Contact {
  name?: string;
  phone?: string;
  email?: string;
}

/** A tax or registration identifier: BT-31, BT-32, BT-48. */
export interface TaxID {
  value: string;
  scheme?: string; // the register the number was issued against: "VAT" for a VAT number,
  // "FC" for the German fiscal number a profile writes in its place; empty means the
  // source document did not say
}

/** BG-17 payer account, BT-91 the account a mandate debits. */
export interface FinancialAccount {
  iban?: string;
  bic?: string;
  name?: string;
  otherId?: string;
}

/** BT-19 accounting reference, and BT-133 on a line. */
export interface Account {
  id?: string;
  type?: string; // CII only, advisory
}

/** BG-18 payment card means. */
export interface Card {
  pan: string; // BT-87 (BT-97 in CII prose), masked in practice
  holder?: string; // BT-88
  type?: string; // CII only
  scheme?: string; // UBL only
}

/** BG-19 direct debit mandate. */
export interface Mandate {
  id?: string; // BT-89
  bank?: FinancialAccount; // BT-91
}

/** BG-16 payment instructions. */
export interface Payment {
  code: string; // BT-81, UNTDID 4461
  name?: string; // BT-82
  remitInfo?: string; // BT-83
  card?: Card;
  mandate?: Mandate;
}

/** A date range: BT-26 document level, BT-72/BT-73 delivery, BT-134/BT-135 line. */
export interface Period {
  start?: string;
  end?: string;
  text?: string;
}

/** BG-13 delivery. */
export interface Delivery {
  name?: string; // BT-70 deliver-to party name
  receiverId?: string; // BT-71 deliver-to location identifier
  address?: Address;
  period?: Period; // CII only
  shipTrade?: string; // CII only, goods shipment ID
  shipPlace?: string; // CII only, goods shipment location
  arrivalDate?: string; // BT-72
  departureDate?: string; // BT-73
}

/** BG-3 order reference and BG-24 document reference. */
export interface Reference {
  type?: string; // buyerOrder, salesOrder, contract, despatchAdvice, receivingAdvice, timesheet, ...
  id: string;
  name?: string; // BT-122 for a document reference
}

/** BG-20 allowance and BG-21 charge, at document or line level. */
export interface AllowanceCharge {
  amount: number;
  percent?: number; // BT-94 / BT-101 / BT-139 / BT-144
  // The amount the percentage was taken on: BT-93 / BT-100 / BT-137 / BT-142. A
  // document states it, and a conversion has to carry it, since a percentage
  // measured against a different base is different money. Left out, a writer
  // measures it against the line net or the invoice total.
  basis?: number;
  reason?: string; // BT-97 / BT-104
  reasonCode?: string; // BT-98 / BT-105, UNTDID 5189
  taxCategory?: string; // BT-95 / BT-102
  taxRate?: number; // BT-96 / BT-103
}

/** BG-32 item attribute: BT-160 name, BT-161 value. */
export interface Attribute {
  name: string;
  value: string;
}

/** BG-29 price details of a line. */
export interface ItemPrice {
  baseQuantity?: number; // BT-149, the quantity the price is quoted for
  baseUnitCode?: string;
  allowance?: number; // BT-147, off the gross price
}

/** BG-31 invoice line item. */
export interface Item {
  name: string; // BT-153
  description?: string; // BT-154
  sellerId?: string; // BT-155
  customerId?: string; // BT-156
  standardId?: string; // BT-157, e.g. an EAN or GTIN
  stdScheme?: string;
  classIds?: string[]; // BT-158 commodity classification
  classScheme?: string;
  origin?: string; // BT-159 country code
  units?: string; // BT-130 fallback when the line has no unit code
  price?: ItemPrice;
  attributes?: Attribute[];
}

/** The reason a line or a VAT line is not standard rated: BT-120, BT-121. */
export interface TaxExempt {
  reason?: string;
  reasonCode?: string;
  amount?: number; // carried by neither syntax; advisory
}

/** BG-25 invoice line. */
export interface Line {
  id: string; // BT-126
  note?: string; // BT-127
  quantity: number; // BT-129
  unit?: string; // the unit as written, when the document spelled it out
  unitCode?: string; // BT-130, UNTDID 6
  grossPrice?: number; // BT-148
  netPrice: number; // BT-146
  allowances?: AllowanceCharge[]; // BG-27
  charges?: AllowanceCharge[]; // BG-28
  taxCategory: string; // BT-151
  taxRate: number; // BT-152
  taxExempt?: TaxExempt;
  item: Item;
  period?: Period; // BG-26
  attributes?: Attribute[]; // BG-32, written as attributes of the item
  extension?: number; // CII only, the invoiced quantity beyond the agreed one
  account?: Account; // BT-133
}

/** BG-23 VAT breakdown line. */
export interface VATRate {
  category: string; // BT-118
  percent: number; // BT-119
  taxable?: number; // BT-116, 0 means derive
  amount?: number; // BT-117, 0 means derive
  exempt?: TaxExempt;
}

/** The derived amounts. A missing field is computed on the way out. */
export interface Totals {
  lineTotal?: number; // BT-106
  allowanceTotal?: number; // BT-107
  chargeTotal?: number; // BT-108
  taxExclusive?: number; // BT-109
  taxTotal?: number; // BT-110
  taxInclusive?: number; // BT-112
  payable?: number; // BT-115
}

/** A trade party: BG-4 seller, BG-7 buyer, BG-10 payee. */
export interface Party {
  name: string; // BT-27 / BT-44 / BT-59
  subdivision?: string; // a second home for address.zone, which wins if both are set
  address: Address;
  contact?: Contact;
  taxIds?: TaxID[];
  regIds?: string[]; // BT-30 / BT-47 legal registration identifiers
  regScheme?: string; // the register they come from, as an ICD code: 0189 is the German commercial register
  eaddress?: string; // BT-34 / BT-49 electronic address
  easScheme?: string; // the scheme of eaddress; 0188 is implied by an email address
  identifier?: string; // BT-29 seller, BT-46 buyer
  idScheme?: string; // the scheme of identifier, e.g. 0088
}

/** BG-4, the supplier. EN 16931 expects a name, an address and a tax number. */
export interface Seller extends Party {
  tradingName?: string; // BT-28, used instead of the legal name
}

/** An invoice or credit note in EN 16931 terms, in neither syntax yet. */
export interface InvoiceModel {
  id: string; // BT-1
  issueDate: string; // BT-2, YYYY-MM-DD
  typeCode?: string; // BT-3, UNTDID 1001: 380 invoice, 381 credit note
  currency: string; // BT-5
  notes?: string[]; // BT-22
  processType?: string; // BT-23 business process type
  guideline?: string; // BT-24 the specification the document claims
  buyerReference?: string; // BT-10, the Leitweg-ID in German administration
  dueDate?: string; // BT-9
  accounting?: Account; // BT-19
  seller: Seller;
  buyer: Party;
  payee?: Party; // BG-10, name and registration id in the norm
  sellerAccount?: FinancialAccount; // BG-17
  buyerAccount?: FinancialAccount; // CII extra
  payment?: Payment;
  delivery?: Delivery;
  references?: Reference[];
  period?: Period; // BG-14
  terms?: string[]; // BT-20 payment terms
  allowances?: AllowanceCharge[]; // BG-20
  charges?: AllowanceCharge[]; // BG-21
  lines: Line[];
  totals?: Totals;
  vatBreakdown?: VATRate[]; // BG-23; absent means derive from the lines
  prepaid?: number; // BT-113
  rounding?: number; // BT-114
}
