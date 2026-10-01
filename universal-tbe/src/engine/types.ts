// Core data model for a Technical Bid Evaluation (TBE) project.
// A project is one tabulation (one MR / package / system) evaluated across N bidders.

export const SCHEMA = "universal-tbe/1" as const;

export type Status =
  | "Pending" // not evaluated yet (the default; never counts as compliant)
  | "Confirm" // vendor confirmed the requirement as specified
  | "Comply" // evaluator judged the offer compliant
  | "Clarify" // information missing or unclear -> technical query
  | "Deviation" // offer does not meet the requirement -> technical query
  | "Exception" // vendor explicitly takes exception
  | "Not Quoted" // in the bidder's scope but not offered
  | "Out of Scope" // bidder was not asked to quote this section
  | "N/A"; // requirement cancelled / by others / not applicable

export type Discipline = "electrical" | "telecom" | "mixed" | "other";

/** 1 = section / group heading, 2 = equipment item, 3 = specification line under an item. */
export type RowLevel = 1 | 2 | 3;

export type BoqStatus = "active" | "cancelled" | "by_others" | "option";

export interface Row {
  id: string;
  level: RowLevel;
  no: string;
  desc: string;
  spec: string;
  qty?: number | null;
  uom?: string | null;
  boqStatus?: BoqStatus;
  /** Evaluator flag: a failure on this row is safety/ratings critical. */
  critical?: boolean;
}

export interface Evidence {
  docId: string;
  page: number; // 1-indexed page of the quotation document
  quote: string; // verbatim text taken from that page
}

export interface Cell {
  status: Status;
  /** What the vendor offered (model, value, description) as written in the offer. */
  offered?: string;
  offeredQty?: number | null;
  /** Evaluator comment / query text (e.g. HEC comments). */
  note?: string;
  /** Vendor reply to the technical query. */
  reply?: string;
  evidence?: Evidence[];
  updated?: string;
}

export interface Bidder {
  id: string;
  name: string;
  short: string;
  quoteRef: string;
  quoteDate?: string;
  /** "all", or ids of section rows (level 1) the bidder was asked to quote. */
  scope: "all" | string[];
}

export interface QuoteDoc {
  id: string;
  bidderId: string;
  name: string;
  sha256: string;
  pages: string[]; // extracted text per page, index 0 = page 1
  addedAt: string;
}

export interface Revision {
  rev: string;
  date: string;
  description: string;
  prepared: string;
  checked: string;
  approved: string;
}

export interface Meta {
  projectName: string;
  projectShort: string;
  docNo: string;
  mrNo: string;
  system: string;
  discipline: Discipline;
  client: string;
  contractor: string;
  location: string;
  classification: string;
  notes: string;
  revisions: Revision[];
}

export interface Policy {
  /** Status suggested when the offered quantity exceeds the required quantity. */
  overQuantity: "Clarify" | "Deviation" | "Comply";
  /** Offered value above this multiple of a minimum requirement is flagged for clarification (0 = off). */
  oversizeFactor: number;
  /** Include "Not Quoted" lines in the TQ register. */
  notQuotedInTq: boolean;
  /** Warn when a line is marked compliant without attached quotation evidence. */
  requireEvidence: boolean;
}

export interface Project {
  schema: typeof SCHEMA;
  id: string;
  savedAt: string;
  meta: Meta;
  policy: Policy;
  rows: Row[];
  bidders: Bidder[];
  /** cells[rowId][bidderId] */
  cells: Record<string, Record<string, Cell>>;
  /** Purchaser remarks / conclusion per row. */
  remarks: Record<string, string>;
  docs: QuoteDoc[];
}
