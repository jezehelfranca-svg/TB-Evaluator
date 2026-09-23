// Typed attribute extraction from requirement lines and vendor offers.
// Covers the recurring electrical (V, A, kA/s, kVA, IP, Ex, conductors) and
// telecom (ports, U, fibre type/count, Cat, PoE, SPL, autonomy) parameters.
// Anything not recognised stays free text and is left to the engineer.

import { awgToMm2, formatValue, lookupUnit, parseNumber, UNIT_TOKENS, type Dim } from "./units";

export type Op = "=" | ">=" | "<=" | "in" | "range" | "present";

export type AttrValue =
  | { kind: "num"; values: number[]; unit: string; extra?: number } // extra: duration (s) for kA/s
  | { kind: "range"; min: number; max: number; unit: string }
  | { kind: "code"; code: string; rank?: number[] }
  | { kind: "text"; text: string };

export interface Attr {
  key: string;
  label: string;
  op: Op;
  value: AttrValue;
  raw: string;
  /** Status to use when this attribute fails (defaults to Deviation). */
  failAs?: "Clarify" | "Deviation";
}

// ---------------------------------------------------------------- helpers

const NUM = String.raw`[+-]?\d+(?:[.,]\d+)?`;

export function normaliseText(s: string): string {
  return (s || "")
    .replace(/[−–—]/g, "-")
    .replace(/[“”″]/g, '"')
    .replace(/[’′]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=");
}

interface Span {
  start: number;
  end: number;
}

function overlaps(spans: Span[], s: number, e: number) {
  return spans.some((x) => s < x.end && e > x.start);
}

const MIN_WORDS = /\b(min(?:imum)?\.?|at least|not less than|or (?:higher|above|better|more|greater)|and above|>=|>)\s*$/i;
const MIN_AFTER = /^\s*(\(?min(?:imum)?\.?\)?|or (?:higher|above|better|more|greater)|and above|\+(?!\d))/i;
const MAX_WORDS = /\b(max(?:imum)?\.?|not more than|not exceeding|up to|<=|<)\s*$/i;
const MAX_AFTER = /^\s*(\(?max(?:imum)?\.?\)?|or (?:less|lower|below)|and below)/i;

/** Look around a match for min/max qualifiers. */
function qualifier(text: string, start: number, end: number): ">=" | "<=" | null {
  const before = text.slice(Math.max(0, start - 28), start);
  const after = text.slice(end, end + 22);
  if (MIN_AFTER.test(after)) return ">=";
  if (MAX_AFTER.test(after)) return "<=";
  if (MIN_WORDS.test(before)) return ">=";
  if (MAX_WORDS.test(before)) return "<=";
  return null;
}

// ------------------------------------------------------------ code scanners

const CAT_ORDER = ["5", "5E", "6", "6A", "7", "7A", "8"];
const POE_ORDER = ["AF", "AT", "BT"];
const GAS_ORDER: Record<string, number> = { A: 1, B: 2, "B+H2": 2.5, C: 3 };

interface Found {
  attr: Attr;
  span: Span;
}

function scanCodes(text: string, ctx: string): Found[] {
  const out: Found[] = [];
  const push = (m: RegExpExecArray, attr: Omit<Attr, "raw">) =>
    out.push({ attr: { ...attr, raw: m[0].trim() }, span: { start: m.index, end: m.index + m[0].length } });

  // IP code (IEC 60529); "IP66/67" yields both codes.
  for (const m of text.matchAll(/\bIP\s?[:=]?\s?([0-6X])([0-9X])(?![\d.])(?:\s*\/\s*(?:IP\s?)?([0-6X])?([0-9X])(?![\d.]))?/gi)) {
    const q = qualifier(text, m.index!, m.index! + m[0].length);
    const codes = [`${m[1]}${m[2]}`.toUpperCase()];
    if (m[4]) codes.push(`${(m[3] || m[1]).toUpperCase()}${m[4].toUpperCase()}`);
    for (const c of codes)
      push(m as RegExpExecArray, {
        key: "ip_rating",
        label: "IP rating",
        op: q === "<=" ? "<=" : ">=",
        value: { kind: "code", code: `IP${c}` },
      });
  }
  for (const m of text.matchAll(/\bIK\s?(\d{2})\b/gi))
    push(m as RegExpExecArray, {
      key: "ik_rating",
      label: "IK impact rating",
      op: ">=",
      value: { kind: "code", code: `IK${m[1]}`, rank: [Number(m[1])] },
    });
  for (const m of text.matchAll(/\bNEMA\s?(?:Type\s?)?(\d{1,2}X?)\b(?!\s*-?\s*\d)/gi))
    push(m as RegExpExecArray, {
      key: "nema_type",
      label: "NEMA enclosure type",
      op: "=",
      value: { kind: "code", code: `NEMA ${m[1].toUpperCase()}` },
    });

  // Hazardous area classification.
  const exCtx = /\b(ex|atex|iecex|zone|hazardous|explosion|flame\s?proof|ii[abc])\b/i.test(ctx);
  for (const m of text.matchAll(/\bZone\s?(0|1|2|20|21|22)\b/gi)) {
    const z = Number(m[1]);
    push(m as RegExpExecArray, {
      key: z >= 20 ? "dust_zone" : "gas_zone",
      label: z >= 20 ? "Dust hazardous zone" : "Gas hazardous zone",
      op: "<=", // equipment certified for Zone 1 is suitable for Zone 2
      value: { kind: "code", code: `Zone ${z}`, rank: [z % 20] },
    });
  }
  for (const m of text.matchAll(/\b(?:Gr(?:oup)?\.?\s?)?II\s?([ABC](?:\s?\+\s?H2)?)(?![a-z])/g)) {
    const g = m[1].replace(/\s/g, "").toUpperCase();
    push(m as RegExpExecArray, {
      key: "gas_group",
      label: "Gas group",
      op: ">=",
      value: { kind: "code", code: `II${g}`, rank: [GAS_ORDER[g] ?? 0] },
    });
  }
  if (exCtx)
    for (const m of text.matchAll(/\bT([1-6])\b(?!\s*(?:line|mm|\)))/g))
      push(m as RegExpExecArray, {
        key: "temp_class",
        label: "Temperature class",
        op: ">=", // T6 is stricter than T4
        value: { kind: "code", code: `T${m[1]}`, rank: [Number(m[1])] },
      });
  for (const m of text.matchAll(/\bE\s?Ex\s?(d|db|e|eb|ia|ib|ic|nA|nR|n|p|pxb|q|m|mb|t|tb)\b|\bEx\s?(d|db|de|e|eb|ia|ib|ic|nA|nR|n|p|pxb|q|m|mb|t|tb)\b/g)) {
    const c = (m[1] || m[2]).toLowerCase();
    push(m as RegExpExecArray, {
      key: `ex_protection:${c}`,
      label: `Ex protection "${c}"`,
      op: "present",
      value: { kind: "code", code: `Ex ${c}` },
      failAs: "Clarify",
    });
  }

  // Telecom cabling and network.
  for (const m of text.matchAll(/\bCat(?:egory)?\s?\.?\s?(5e|6a|7a|5|6|7|8)\b/gi)) {
    const c = m[1].toUpperCase();
    push(m as RegExpExecArray, {
      key: "cable_category",
      label: "Cable category",
      op: ">=",
      value: { kind: "code", code: `Cat.${c.replace("E", "e")}`, rank: [CAT_ORDER.indexOf(c)] },
    });
  }
  for (const m of text.matchAll(/\b(OM[1-5]|OS[12])\b/gi)) {
    const c = m[1].toUpperCase();
    push(m as RegExpExecArray, {
      key: "fiber_type",
      label: "Fibre type",
      op: ">=",
      value: { kind: "code", code: c, rank: [c.startsWith("OS") ? 1 : 0, Number(c[2])] },
    });
  }
  for (const m of text.matchAll(/\b(single[\s-]?mode|SMF|multi[\s-]?mode|MMF)\b/gi)) {
    const sm = /single|smf/i.test(m[1]);
    push(m as RegExpExecArray, {
      key: "fiber_mode",
      label: "Fibre mode",
      op: "=",
      value: { kind: "code", code: sm ? "Single-mode" : "Multimode" },
    });
  }
  for (const m of text.matchAll(/\b802\.3\s?(af|at|bt)\b|\bPoE\s?(\+\+|\+)?(?![a-z])/gi)) {
    const c = m[1] ? m[1].toUpperCase() : m[2] === "++" ? "BT" : m[2] === "+" ? "AT" : "AF";
    push(m as RegExpExecArray, {
      key: "poe",
      label: "PoE class",
      op: ">=",
      value: { kind: "code", code: `802.3${c.toLowerCase()}`, rank: [POE_ORDER.indexOf(c)] },
    });
  }

  // Power system conductors: "3W+E", "4wire", "3P4W", "3Ph+N+E".
  for (const m of text.matchAll(/\b3\s?P\s?([34])\s?W\b|\b([34])\s?W(?:ire)?\s?(\+\s?P?E)?(?![a-z])|\b3\s?-?\s?Ph(?:ase)?\s?(\+\s?N)?\s?(\+\s?P?E)?(?![a-z])/gi)) {
    // A bare "3W"/"4W" is only a conductor count in a power-system context ("3W" is also a 3-watt speaker).
    if (m[2] && !m[3] && !/wire/i.test(m[0]) && (!/\b(\d+\s?k?V|ph(ase)?|neutral|earth|switchgear|mcc|busduct|bus duct)\b/i.test(ctx) || /speaker|horn|siren|amplifier|beacon/i.test(ctx)))
      continue;
    let wires: number, earth: boolean;
    if (m[1]) (wires = Number(m[1])), (earth = false);
    else if (m[2]) (wires = Number(m[2])), (earth = !!m[3]);
    else (wires = m[4] ? 4 : 3), (earth = !!m[5]);
    if (!m[1] && !m[2] && !m[4] && !m[5]) {
      push(m as RegExpExecArray, { key: "phases", label: "Phases", op: "=", value: { kind: "code", code: "3-phase" } });
      continue;
    }
    push(m as RegExpExecArray, {
      key: "conductors",
      label: "System conductors",
      op: "=",
      value: { kind: "code", code: `${wires}W${earth ? "+E" : ""}`, rank: [wires, earth ? 1 : 0] },
    });
  }
  for (const m of text.matchAll(/\bForm\s?([1-4])\s?([ab])?\b/gi)) {
    const f = Number(m[1]);
    const sub = (m[2] || "").toLowerCase();
    push(m as RegExpExecArray, {
      key: "form_separation",
      label: "Form of separation",
      op: ">=",
      value: { kind: "code", code: `Form ${f}${sub}`, rank: [f, sub === "b" ? 2 : sub === "a" ? 1 : 0] },
    });
  }
  const PROTO =
    /\b(Modbus)(?:[\s-]?(TCP|RTU))?\b|\b(Profibus|Profinet|DNP3|BACnet|RSTP|PRP|HSR|SNMP|OPC[\s-]?UA|EtherNet\/IP|SIP|LLDP|VRRP|OSPF)\b/gi;
  for (const m of text.matchAll(PROTO)) {
    const fam = (m[1] || m[3]).toUpperCase().replace(/[\s-]/g, "");
    const variant = (m[2] || "").toUpperCase();
    push(m as RegExpExecArray, {
      key: `protocol:${fam}`,
      label: `${m[1] ? "Modbus" : m[3]} protocol`,
      op: "present",
      value: { kind: "code", code: variant ? `${fam} ${variant}` : fam },
    });
  }

  // Standards and listings: presence check.
  const STD =
    /\b(IEC|EN|UL|IEEE|ANSI|NEMA|ISO|BS|TIA|EIA|ITU-T|NFPA|SAES|ASTM|CSA|DIN|VDE|IECEx|ATEX)(?:[\s/-]*(?:TIA|EIA)?[\s/-]*)((?:[A-Z]{1,2}-)?\d[\d.]*[a-z]{0,3}(?:[-/][\dA-Za-z.]+)*)?(?![\w])/g;
  for (const m of text.matchAll(STD)) {
    const org = m[1];
    const num = m[2];
    if (!num && !/^(UL|ATEX|IECEx|CE|CSA)$/.test(org)) continue;
    if (org === "NEMA" && num && /^\d{1,2}X?$/.test(num)) continue; // NEMA enclosure type, handled above
    if (org === "IEEE" && num && /^802\.3(af|at|bt)$/i.test(num)) continue; // PoE class, handled above
    const norm = normStandard(`${org} ${num || ""}`);
    push(m as RegExpExecArray, {
      key: `standard:${norm}`,
      label: norm,
      op: "present",
      value: { kind: "text", text: norm },
    });
  }
  return out;
}

export function normStandard(s: string): string {
  return s
    .toUpperCase()
    .replace(/:\s?(19|20)\d\d\b/, "") // drop edition year
    .replace(/[\s-]+/, " ")
    .replace(/[.\s]+$/, "")
    .trim();
}

// ------------------------------------------------------- number scanners

function keyForDim(dim: Dim, ctx: string, unitRaw: string, pair: boolean): { key: string; label: string; op: Op; failAs?: "Clarify" } | null {
  const c = ctx.toLowerCase();
  switch (dim) {
    case "voltage":
      if (pair || /insulation|cable|withstand|max(imum)? (operating )?voltage/.test(c))
        return { key: "voltage_rating", label: "Voltage rating", op: ">=" };
      return { key: "voltage", label: "Voltage", op: "=" };
    case "current":
      if (/^ka$/i.test(unitRaw)) {
        if (/\bicu\b|\bics\b|breaking/.test(c)) return { key: "breaking_capacity", label: "Breaking capacity", op: ">=" };
        if (/\bipk\b|\bip\s*[:=]|peak|making/.test(c)) return { key: "peak_current", label: "Peak withstand current", op: ">=" };
        if (/\bicw\b|short[\s-]?time|withstand/.test(c)) return { key: "short_time_current", label: "Short-time withstand current", op: ">=" };
        return { key: "short_circuit", label: "Short-circuit rating", op: ">=" };
      }
      return { key: "rated_current", label: "Rated current", op: ">=" };
    case "power":
      return { key: "power", label: "Power", op: ">=" };
    case "apparent_power":
      return { key: "apparent_power", label: "Apparent power", op: ">=" };
    case "reactive_power":
      return { key: "reactive_power", label: "Reactive power", op: ">=" };
    case "frequency":
      if (/radio|band|vhf|uhf|antenna|wi-?fi|wlan|ghz/.test(c) || !/^hz$/i.test(unitRaw))
        return { key: "radio_frequency", label: "Frequency band", op: "=", failAs: "Clarify" };
      return { key: "frequency", label: "Frequency", op: "=" };
    case "length":
      if (unitRaw === '"' || /^inch/i.test(unitRaw)) {
        if (/rack|19"|23"/.test(c)) return { key: "rack_width", label: "Rack width", op: "=" };
        return { key: "size_in", label: "Size (in)", op: "=", failAs: "Clarify" };
      }
      if (/transmission|reach|link distance|coverage/.test(c)) return { key: "reach", label: "Transmission distance", op: ">=" };
      if (/spacing|rung|clearance|deflection/.test(c)) return { key: "spacing", label: "Spacing", op: "<=", failAs: "Clarify" };
      if (/radius/.test(c)) return { key: "radius", label: "Radius", op: ">=", failAs: "Clarify" };
      if (/length|straight|run|distance/.test(c)) return { key: "length", label: "Length", op: ">=" };
      if (/thick/.test(c)) return { key: "thickness", label: "Thickness", op: ">=", failAs: "Clarify" };
      return { key: "length", label: "Length", op: ">=", failAs: "Clarify" };
    case "area":
      return { key: "conductor_size", label: "Conductor size", op: ">=" };
    case "temperature":
      if (/ambient|site|design/.test(c)) return { key: "ambient_temperature", label: "Ambient temperature rating", op: ">=" };
      return { key: "temperature_rating", label: "Temperature rating", op: ">=" };
    case "time":
      if (/batter|backup|back-up|autonomy|ups|standby|hold[- ]?up/.test(c)) return { key: "autonomy", label: "Battery autonomy", op: ">=" };
      if (/response|switch[- ]?over|transfer|boot|recovery/.test(c)) return { key: "response_time", label: "Response time", op: "<=" };
      return null;
    case "sound":
      if (/reduction|attenuation|isolation|insertion loss/.test(c)) return { key: "attenuation", label: "Noise reduction", op: ">=" };
      if (/noise|ambient/.test(c) && !/spl|output|speaker|horn|siren/.test(c)) return { key: "noise_level", label: "Noise level", op: "<=" };
      return { key: "spl", label: "Sound pressure level", op: ">=" };
    case "data_rate":
      return { key: "data_rate", label: "Data rate", op: ">=" };
    case "rack_units":
      return { key: "rack_units", label: "Rack units", op: ">=" };
    case "ports":
      return { key: "ports", label: "Port count", op: ">=" };
    case "fibers":
      return { key: "fiber_count", label: "Fibre count", op: ">=" };
    case "pairs":
      return { key: "pair_count", label: "Pair count", op: ">=" };
    case "resolution":
      return { key: "resolution", label: "Resolution", op: ">=" };
    case "mass":
      if (/hold|lock|force|pull/.test(c)) return { key: "holding_force", label: "Holding force", op: ">=" };
      if (/load|capacity/.test(c)) return { key: "load_capacity", label: "Load capacity", op: ">=" };
      return null;
    case "charge":
      return { key: "battery_capacity", label: "Battery capacity", op: ">=" };
    case "illuminance":
      return { key: "illuminance", label: "Minimum illumination", op: "<=" };
    case "frame_rate":
      return { key: "frame_rate", label: "Frame rate", op: ">=" };
  }
  return null;
}

const UNIT_ALT = UNIT_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s?")).join("|");

function scanNumbers(text: string, ctx: string, masked: Span[]): Found[] {
  const out: Found[] = [];
  const used: Span[] = [...masked];
  const add = (start: number, end: number, attr: Attr) => {
    used.push({ start, end });
    out.push({ attr, span: { start, end } });
  };

  // Short-time withstand current: "80kA/1s", "40 kA for 1 sec", "65kA 1s", "40kAfor1sec".
  for (const m of text.matchAll(new RegExp(`(${NUM})\\s*kA\\s*(?:\\/|for|,|x)?\\s*(${NUM})\\s*(?:s|sec|secs|second|seconds)\\b`, "gi"))) {
    const s = m.index!, e = s + m[0].length;
    if (overlaps(used, s, e)) continue;
    add(s, e, {
      key: "short_time_current",
      label: "Short-time withstand current",
      op: ">=",
      value: { kind: "num", values: [parseNumber(m[1]) * 1e3], unit: "A", extra: parseNumber(m[2]) },
      raw: m[0].trim(),
    });
  }

  // Dimensions "W x D x H" (2 or 3 values) with a unit or (W)/(D)/(H) tags.
  const DIM = `(${NUM})\\s*(mm|cm|m)?(?![a-z])\\s*(?:\\(?\\s*[WDHL]\\s*\\)?)?`;
  for (const m of text.matchAll(new RegExp(`${DIM}\\s*[x×*]\\s*${DIM}(?:\\s*[x×*]\\s*${DIM})?`, "gi"))) {
    const s = m.index!, e = s + m[0].length;
    if (overlaps(used, s, e)) continue;
    const tagged = /\(\s*[WDHL]\s*\)|\b[WDHL]\b/i.test(m[0]);
    const unit = m[6] || m[4] || m[2];
    if (!unit && !tagged) continue;
    const f = unit === "m" ? 1000 : unit === "cm" ? 10 : 1;
    const vals = [m[1], m[3], m[5]].filter(Boolean).map((v) => parseNumber(v) * f);
    add(s, e, { key: "dimensions", label: "Dimensions", op: "=", value: { kind: "num", values: vals, unit: "mm" }, raw: m[0].trim(), failAs: "Clarify" });
  }

  // Ranges: "-50°C to +65°C", "0 ~ 40 °C", "100-240VAC".
  const RANGE = new RegExp(`(${NUM})\\s*(${UNIT_ALT})?\\s*(?:to|~|\\.\\.|-(?=\\s*\\+?\\d))\\s*(${NUM})\\s*(${UNIT_ALT})(?![a-z0-9])`, "gi");
  for (const m of text.matchAll(RANGE)) {
    const s = m.index!, e = s + m[0].length;
    if (overlaps(used, s, e)) continue;
    const u = lookupUnit(m[4]);
    if (!u || (m[2] && lookupUnit(m[2])?.dim !== u.dim)) continue;
    const a = parseNumber(m[1]) * (m[2] ? lookupUnit(m[2])!.factor : u.factor);
    const b = parseNumber(m[3]) * u.factor;
    if (!(a < b)) continue;
    const k = keyForDim(u.dim, ctx, m[4], false);
    if (!k) continue;
    const key = u.dim === "temperature" ? "temperature_range" : k.key;
    const label = u.dim === "temperature" ? "Operating temperature range" : k.label;
    add(s, e, { key, label, op: "range", value: { kind: "range", min: a, max: b, unit: u.canonical }, raw: m[0].trim() });
  }

  // AWG conductor sizes.
  for (const m of text.matchAll(/\b(\d{1,2}(?:\/0)?)\s*AWG\b/gi)) {
    const s = m.index!, e = s + m[0].length;
    if (overlaps(used, s, e)) continue;
    const g = m[1].endsWith("/0") ? 1 - Number(m[1].split("/")[0]) : Number(m[1]);
    add(s, e, {
      key: "conductor_size",
      label: "Conductor size",
      op: ">=",
      value: { kind: "num", values: [Math.round(awgToMm2(g) * 100) / 100], unit: "mm²" },
      raw: m[0].trim(),
    });
  }

  // Fractional inches: 1/2" coax, 1-1/4" conduit, 1/2.8" image sensor.
  for (const m of text.matchAll(/(?<![\w./])(?:(\d+)[\s-])?(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:"|-?\s?inch(?:es)?\b)/gi)) {
    const s = m.index!, e = s + m[0].length;
    if (overlaps(used, s, e)) continue;
    const v = (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
    add(s, e, { key: "size_in", label: "Size (in)", op: "=", value: { kind: "num", values: [v * 0.0254], unit: "m" }, raw: m[0].trim(), failAs: "Clarify" });
  }

  // Plain numbers with units, including pairs like "600/1000V" or "0.6/1 kV".
  const SINGLE = new RegExp(`(?<![\\w.])(${NUM})(?:\\s*\\/\\s*(${NUM}))?\\s*-?\\s*(${UNIT_ALT})(?![a-z0-9²])`, "gi");
  const byKey = new Map<string, Found[]>();
  for (const m of text.matchAll(SINGLE)) {
    const s = m.index!, e = s + m[0].length;
    if (overlaps(used, s, e)) continue;
    const u = lookupUnit(m[3]);
    if (!u) continue;
    // Test conditions ("97 dB @ 6 W @ 1 m", "at 1.3 kHz") are not requirements.
    if (/(@|\bat)\s*$/i.test(text.slice(Math.max(0, s - 4), s))) continue;
    // UL 94 flammability class "5VA" is not volt-amperes.
    if (u.dim === "apparent_power" && /UL\s?94|flammab|V-?0/i.test(ctx) && /^5\s*VA$/i.test(m[0].trim())) continue;
    // "600/1000V" (Uo/U, ascending) is an insulation rating; "400/230V" (L-L/L-N) is a system voltage.
    const systemPair = !!m[2] && u.dim === "voltage" && parseNumber(m[1]) > parseNumber(m[2]);
    const pair = !!m[2] && !systemPair;
    const k = keyForDim(u.dim, ctx, m[3], pair);
    if (!k) continue;
    const vals = [parseNumber(m[1]) * u.factor];
    if (pair) vals.push(parseNumber(m[2]) * u.factor);
    const q = qualifier(text, s, e);
    const op: Op = q ?? k.op;
    const f: Found = {
      attr: { key: k.key, label: k.label, op, value: { kind: "num", values: vals, unit: u.canonical }, raw: m[0].trim(), failAs: k.failAs },
      span: { start: s, end: e },
    };
    used.push(f.span);
    out.push(f);
    const list = byKey.get(k.key) ?? [];
    list.push(f);
    byKey.set(k.key, list);
  }
  // Repeated values of one parameter in a single line ("690V & 400V",
  // "4000A/2500A") describe alternatives, not cumulative demands.
  const depthAt = (pos: number) => {
    let d = 0;
    for (let i = 0; i < pos; i++) d += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    return d;
  };
  for (const list of byKey.values()) {
    // "Rated Power: 6 W (Tappings - 6W, 3W, 1.5W)": the value outside brackets is the requirement.
    const outside = list.filter((f) => depthAt(f.span.start) <= 0);
    if (outside.length && outside.length < list.length)
      for (const f of list.filter((x) => depthAt(x.span.start) > 0)) {
        out.splice(out.indexOf(f), 1);
        list.splice(list.indexOf(f), 1);
      }
    for (const op of ["=", ">=", "<="] as const) {
      const same = list.filter((f) => f.attr.op === op && f.attr.value.kind === "num" && f.attr.value.values.length === 1 && f.attr.value.extra === undefined);
      if (same.length < 2) continue;
      const vals = [...new Set(same.map((f) => (f.attr.value as { values: number[] }).values[0]))];
      const unit = (same[0].attr.value as { unit: string }).unit;
      const merged: Attr = {
        ...same[0].attr,
        op: op === "=" ? "in" : op,
        value: { kind: "num", values: op === "=" ? vals : [op === ">=" ? Math.min(...vals) : Math.max(...vals)], unit },
        raw: [...new Set(same.map((f) => f.attr.raw))].join(" / "),
      };
      if (op === "=" && vals.length === 1) merged.op = "=";
      same[0].attr = merged;
      for (const f of same.slice(1)) out.splice(out.indexOf(f), 1);
    }
  }
  return out;
}

// ---------------------------------------------------------- public API

/**
 * Extract typed attributes from text. `label` (the part before ":" in a
 * "- Key : Value" spec line) and surrounding context steer key selection.
 */
export function extractAttributes(text: string, context = ""): Attr[] {
  const t = normaliseText(text);
  const ctx = `${context} ${t}`;
  const codes = scanCodes(t, ctx);
  const nums = scanNumbers(t, ctx, codes.map((c) => c.span));
  const seen = new Set<string>();
  return [...codes, ...nums]
    .sort((a, b) => a.span.start - b.span.start)
    .map((f) => f.attr)
    .filter((a) => {
      const sig = `${a.key}|${a.op}|${describeValue(a.value)}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
}

/** Split a "- Label : Value" specification line. */
export function splitSpecLine(line: string): { label: string; value: string } {
  const t = normaliseText(line).replace(/^\s*[-•*·](?!\d)\s*/, "").trim();
  const m = t.match(/^([^:;]{2,60}?)\s*[:;]\s*(.+)$/);
  if (m && !/\d/.test(m[1])) return { label: m[1].trim(), value: m[2].trim() };
  return { label: "", value: t };
}

/** Attributes required by a requirement line (label-aware). */
export function requirementAttributes(line: string, parentContext = ""): Attr[] {
  const { label, value: v } = splitSpecLine(line);
  // "IP: 66 as minimum" -> "IP66 as minimum"
  const value = /^(ip|ingress protection|protection|ip rating)$/i.test(label) && /^[0-6X][0-9X]\b/i.test(v) ? `IP${v}` : v;
  const attrs = extractAttributes(value, `${parentContext} ${label}`);
  // An explicit "Ex" / flameproof / explosion-proof demand with no concept code.
  if (/explosion[\s-]?proof|flame[\s-]?proof|\bEx\b|ATEX|IECEx|hazardous area/i.test(line) && !attrs.some((a) => a.key.startsWith("ex_protection") || a.key.startsWith("standard:ATEX") || a.key.startsWith("standard:IECEX"))) {
    attrs.push({ key: "ex_certified", label: "Hazardous-area certification", op: "present", value: { kind: "text", text: "Ex certified" }, raw: "Ex / explosion-proof", failAs: "Clarify" });
  }
  return attrs;
}

export function describeValue(v: AttrValue, key = ""): string {
  switch (v.kind) {
    case "num":
      if (key === "rack_width" || key === "size_in") return v.values.map((x) => `${Math.round((x / 0.0254) * 100) / 100}"`).join(" / ");
      if (v.unit === "mm" && v.values.length > 1) return v.values.map((x) => `${Math.round(x)}`).join(" x ") + " mm";
      return v.values.map((x) => formatValue(x, v.unit)).join(" / ") + (v.extra ? ` for ${v.extra} s` : "");
    case "range":
      return `${formatValue(v.min, v.unit)} to ${formatValue(v.max, v.unit)}`;
    case "code":
      return v.code;
    case "text":
      return v.text;
  }
}

export function describeAttr(a: Attr): string {
  const opText: Record<Op, string> = { "=": "", ">=": "≥ ", "<=": "≤ ", in: "one of ", range: "covers ", present: "" };
  return `${a.label}: ${opText[a.op]}${describeValue(a.value, a.key)}`;
}
