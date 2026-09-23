// Unit normalisation for electrical and telecom quantities.

export type Dim =
  | "voltage"
  | "current"
  | "power"
  | "apparent_power"
  | "reactive_power"
  | "frequency"
  | "length"
  | "area"
  | "temperature"
  | "time"
  | "sound"
  | "data_rate"
  | "rack_units"
  | "ports"
  | "fibers"
  | "pairs"
  | "resolution"
  | "mass"
  | "charge"
  | "illuminance"
  | "frame_rate";

export interface UnitDef {
  dim: Dim;
  factor: number; // multiply to get the canonical unit
  canonical: string;
}

const U = (dim: Dim, factor: number, canonical: string): UnitDef => ({ dim, factor, canonical });

// Keys are lower-case unit tokens as they appear after a number.
export const UNITS: Record<string, UnitDef> = {
  v: U("voltage", 1, "V"),
  vac: U("voltage", 1, "V"),
  vdc: U("voltage", 1, "V"),
  kv: U("voltage", 1e3, "V"),
  kvac: U("voltage", 1e3, "V"),
  ma: U("current", 1e-3, "A"),
  a: U("current", 1, "A"),
  amp: U("current", 1, "A"),
  amps: U("current", 1, "A"),
  ka: U("current", 1e3, "A"),
  w: U("power", 1, "W"),
  watt: U("power", 1, "W"),
  watts: U("power", 1, "W"),
  kw: U("power", 1e3, "W"),
  mw: U("power", 1e6, "W"),
  va: U("apparent_power", 1, "VA"),
  kva: U("apparent_power", 1e3, "VA"),
  mva: U("apparent_power", 1e6, "VA"),
  var: U("reactive_power", 1, "var"),
  kvar: U("reactive_power", 1e3, "var"),
  mvar: U("reactive_power", 1e6, "var"),
  hz: U("frequency", 1, "Hz"),
  khz: U("frequency", 1e3, "Hz"),
  mhz: U("frequency", 1e6, "Hz"),
  ghz: U("frequency", 1e9, "Hz"),
  mm: U("length", 1e-3, "m"),
  cm: U("length", 1e-2, "m"),
  m: U("length", 1, "m"),
  mtr: U("length", 1, "m"),
  meter: U("length", 1, "m"),
  meters: U("length", 1, "m"),
  metre: U("length", 1, "m"),
  metres: U("length", 1, "m"),
  km: U("length", 1e3, "m"),
  '"': U("length", 0.0254, "m"),
  inch: U("length", 0.0254, "m"),
  inches: U("length", 0.0254, "m"),
  mm2: U("area", 1, "mm²"),
  "mm²": U("area", 1, "mm²"),
  sqmm: U("area", 1, "mm²"),
  "°c": U("temperature", 1, "°C"),
  degc: U("temperature", 1, "°C"),
  "℃": U("temperature", 1, "°C"),
  "deg c": U("temperature", 1, "°C"),
  s: U("time", 1, "s"),
  sec: U("time", 1, "s"),
  secs: U("time", 1, "s"),
  second: U("time", 1, "s"),
  seconds: U("time", 1, "s"),
  min: U("time", 60, "s"),
  mins: U("time", 60, "s"),
  minute: U("time", 60, "s"),
  minutes: U("time", 60, "s"),
  h: U("time", 3600, "s"),
  hr: U("time", 3600, "s"),
  hrs: U("time", 3600, "s"),
  hour: U("time", 3600, "s"),
  hours: U("time", 3600, "s"),
  db: U("sound", 1, "dB"),
  dba: U("sound", 1, "dB"),
  "db(a)": U("sound", 1, "dB"),
  kbps: U("data_rate", 1e3, "bit/s"),
  mbps: U("data_rate", 1e6, "bit/s"),
  gbps: U("data_rate", 1e9, "bit/s"),
  gbe: U("data_rate", 1e9, "bit/s"),
  u: U("rack_units", 1, "U"),
  port: U("ports", 1, "ports"),
  ports: U("ports", 1, "ports"),
  core: U("fibers", 1, "fibers"),
  cores: U("fibers", 1, "fibers"),
  fiber: U("fibers", 1, "fibers"),
  fibers: U("fibers", 1, "fibers"),
  fibre: U("fibers", 1, "fibers"),
  fibres: U("fibers", 1, "fibers"),
  splice: U("fibers", 1, "fibers"),
  splices: U("fibers", 1, "fibers"),
  pair: U("pairs", 1, "pairs"),
  pairs: U("pairs", 1, "pairs"),
  mp: U("resolution", 1, "MP"),
  megapixel: U("resolution", 1, "MP"),
  kg: U("mass", 1, "kg"),
  lb: U("mass", 0.45359237, "kg"),
  lbs: U("mass", 0.45359237, "kg"),
  ah: U("charge", 1, "Ah"),
  lux: U("illuminance", 1, "lx"),
  lx: U("illuminance", 1, "lx"),
  fps: U("frame_rate", 1, "fps"),
};

/** Unit tokens sorted longest-first so the regex prefers "kva" over "kv". */
export const UNIT_TOKENS = Object.keys(UNITS).sort((a, b) => b.length - a.length);

export function lookupUnit(token: string): UnitDef | undefined {
  return UNITS[token.toLowerCase().replace(/\s+/g, " ")];
}

/** American Wire Gauge to mm². */
export function awgToMm2(awg: number): number {
  const d = 0.127 * Math.pow(92, (36 - awg) / 39); // diameter in mm
  return (Math.PI / 4) * d * d;
}

/** Parse a number written with either decimal point or decimal comma. */
export function parseNumber(raw: string): number {
  let s = raw.replace(/\s+/g, "").replace(/[−–—]/g, "-");
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  return Number(s);
}

/** Format a canonical value back in a readable unit. */
export function formatValue(value: number, canonical: string): string {
  const round = (n: number) => String(Math.round(n * 1000) / 1000);
  const scale: Record<string, [number, string][]> = {
    V: [[1e3, "kV"], [1, "V"]],
    A: [[1e3, "kA"], [1, "A"]],
    W: [[1e6, "MW"], [1e3, "kW"], [1, "W"]],
    VA: [[1e6, "MVA"], [1e3, "kVA"], [1, "VA"]],
    var: [[1e6, "Mvar"], [1e3, "kvar"], [1, "var"]],
    Hz: [[1e9, "GHz"], [1e6, "MHz"], [1e3, "kHz"], [1, "Hz"]],
    m: [[1e3, "km"], [1, "m"], [1e-3, "mm"]],
    s: [[3600, "h"], [60, "min"], [1, "s"]],
    "bit/s": [[1e9, "Gbit/s"], [1e6, "Mbit/s"], [1e3, "kbit/s"]],
  };
  const steps = scale[canonical];
  // Rated currents read better in amperes (4000 A); fault levels in kA (80 kA).
  if (canonical === "A" && Math.abs(value) < 1e4) return `${round(value)} A`;
  if (steps) {
    const abs = Math.abs(value);
    for (const [f, u] of steps) {
      if (abs >= f || f === steps[steps.length - 1][0]) {
        const v = value / f;
        if (canonical === "s" && f === 3600 && !Number.isInteger(v)) continue;
        if (canonical === "s" && f === 60 && !Number.isInteger(v)) continue;
        return `${round(v)} ${u}`;
      }
    }
  }
  return `${round(value)} ${canonical}`;
}
