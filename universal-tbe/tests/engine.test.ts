import { describe, expect, it } from "vitest";
import { extractAttributes, requirementAttributes, type Attr } from "../src/engine/attributes";
import { compareAttr } from "../src/engine/compare";
import { explicitQty, offeredQty } from "../src/engine/qty";
import { newBidder, newProject, inScope, effectiveStatus, topSections } from "../src/engine/project";
import { suggest, conflict } from "../src/engine/rules";
import { bidderStats, rankingReady } from "../src/engine/scoring";
import { statusFromText } from "../src/engine/status";
import { tqRegister } from "../src/engine/tq";
import { runChecks } from "../src/engine/checks";
import type { Project, Row } from "../src/engine/types";

const byKey = (attrs: Attr[], key: string) => attrs.filter((a) => a.key === key);
const one = (attrs: Attr[], key: string) => {
  const f = byKey(attrs, key);
  expect(f, `expected one ${key} in ${JSON.stringify(attrs.map((a) => a.key))}`).toHaveLength(1);
  return f[0];
};
const check = (req: string, offer: string, confirmed = false) => {
  const r = requirementAttributes(req);
  expect(r.length).toBeGreaterThan(0);
  return r.map((a) => compareAttr(a, extractAttributes(offer), confirmed));
};

describe("attribute extraction: telecom spec lines (BOTB client sheets)", () => {
  it("IP rating with 'or Higher'", () => {
    const a = one(requirementAttributes("- Protection Rating : IP68 or Higher"), "ip_rating");
    expect(a.op).toBe(">=");
    expect(a.value).toMatchObject({ code: "IP68" });
  });
  it("minimum fibre count", () => {
    const a = one(requirementAttributes("- Fiber Capacity : Minimum 144 Fiber Splices"), "fiber_count");
    expect(a.op).toBe(">=");
    expect(a.value).toMatchObject({ values: [144] });
  });
  it("operating temperature range", () => {
    const a = one(requirementAttributes("- Operating Temperature : -50°C to +65°C"), "temperature_range");
    expect(a.value).toMatchObject({ kind: "range", min: -50, max: 65 });
  });
  it("standards and listings", () => {
    expect(requirementAttributes("- UL 1863 Compliant").map((a) => a.key)).toContain("standard:UL 1863");
    expect(requirementAttributes("- EIA-310-D compliant").map((a) => a.key)).toContain("standard:EIA 310-D");
    expect(requirementAttributes("FLAME-RETARDANT as per IEC 60332-3-23 (CAT. B)").map((a) => a.key)).toContain("standard:IEC 60332-3-23");
  });
  it("rack units, rack width and PDU ratings", () => {
    const r = requirementAttributes("- 45 U, 19\", Gray");
    expect(one(r, "rack_units").value).toMatchObject({ values: [45] });
    expect(one(r, "rack_width").op).toBe("=");
    const pdu = requirementAttributes("- 6x BS1363 UK Outlets Basic PDU (16A, 4kW, 1U Horizontal Rack-mounted type)");
    expect(pdu.map((a) => a.key)).toEqual(expect.arrayContaining(["standard:BS 1363", "rated_current", "power", "rack_units"]));
  });
  it("UPS autonomy from '2-hour battery backup'", () => {
    const a = one(requirementAttributes("rack-mounted UPS with 2-hour battery backup"), "autonomy");
    expect(a.value).toMatchObject({ values: [7200] });
  });
  it("cable category, fibre type, PoE", () => {
    expect(one(requirementAttributes("2 × Category 6A Unshielded Keystone Jacks (RJ45)"), "cable_category").value).toMatchObject({ code: "Cat.6A" });
    expect(one(requirementAttributes("24 core OS2 single mode fibre"), "fiber_type").value).toMatchObject({ code: "OS2" });
    expect(one(requirementAttributes("PoE+ (IEEE 802.3at) ports"), "poe").value).toMatchObject({ code: "802.3at" });
  });
  it("does not read quantities or '3 sets' as attributes", () => {
    expect(requirementAttributes("Proximity Card Reader").length).toBe(0);
    expect(requirementAttributes("6 Sets of cabinets").length).toBe(0);
  });
  it("a 3 W loudspeaker is power, not a 3-wire system", () => {
    const r = requirementAttributes("Ceiling loudspeaker 3W, 100V line");
    expect(r.map((a) => a.key)).toContain("power");
    expect(r.map((a) => a.key)).not.toContain("conductors");
  });
});

describe("attribute extraction: electrical (AGSA switchgear)", () => {
  const r = requirementAttributes("690V, 3ph, 3W+E, 4000A, 50Hz, 80kA for 1sec");
  it("voltage, conductors, current, frequency, short-time rating", () => {
    expect(one(r, "voltage").value).toMatchObject({ values: [690] });
    expect(one(r, "conductors").value).toMatchObject({ code: "3W+E" });
    expect(one(r, "rated_current").value).toMatchObject({ values: [4000] });
    expect(one(r, "frequency").value).toMatchObject({ values: [50] });
    expect(one(r, "short_time_current").value).toMatchObject({ values: [80000], extra: 1 });
  });
  it("squashed PDF text still parses", () => {
    expect(one(requirementAttributes("11kV,3ph,3wire,4000A,50Hz,40kAfor1sec"), "short_time_current").value).toMatchObject({ values: [40000], extra: 1 });
  });
  it("400/230V is a system voltage, 0.6/1kV is an insulation rating", () => {
    expect(one(requirementAttributes("400/230V, 50Hz, 15kA/1sec, 1000A"), "voltage").value).toMatchObject({ values: [400] });
    const cable = one(requirementAttributes("AC POWER CABLE 600/1000V"), "voltage_rating");
    expect(cable.value).toMatchObject({ values: [600, 1000] });
  });
  it("alternative values in one line", () => {
    const a = one(requirementAttributes("690V & 400V Switchgear, 4000A/2500A"), "voltage");
    expect(a.op).toBe("in");
    expect(one(requirementAttributes("690V & 400V Switchgear, 4000A/2500A"), "rated_current").value).toMatchObject({ values: [2500] });
  });
  it("AWG sizes convert to mm²", () => {
    const a = one(requirementAttributes("3 x C x 12 AWG"), "conductor_size");
    expect((a.value as { values: number[] }).values[0]).toBeCloseTo(3.31, 1);
  });
  it("hazardous area marking", () => {
    const r2 = requirementAttributes("Explosion proof, Ex d IIB T4, Zone 1");
    expect(r2.map((a) => a.key)).toEqual(expect.arrayContaining(["ex_protection:d", "gas_group", "temp_class", "gas_zone"]));
  });
});

describe("comparisons", () => {
  const results = (req: string, offer: string, confirmed = false) => check(req, offer, confirmed).map((c) => c.result);
  it("IP: lower second digit fails, IPx7 does not imply IPx6", () => {
    expect(results("IP66", "IP65")).toEqual(["fail"]);
    expect(results("IP66", "IP67")).toEqual(["not_stated"]);
    expect(results("IP66", "IP66/67")).toEqual(["pass"]);
    expect(results("IP54", "IP66")).toEqual(["exceeds"]);
  });
  it("short-time withstand: Icw 65 kA < 80 kA; missing duration is a query", () => {
    expect(results("80kA for 1sec", "MNS 3.0, 690V, 5000A, Icw 65kA (Main Busbars)")).toEqual(["fail"]);
    expect(results("80kA/1s", "Icw 80 kA")).toEqual(["not_stated"]);
    expect(results("80kA/1s", "80kA 1s")).toEqual(["pass"]);
  });
  it("higher current exceeds; far larger power is flagged", () => {
    expect(results("4000A", "5000A")).toEqual(["exceeds"]);
    const c = check("Soft starter for 560kW motor", "2000kW Motor");
    expect(c[0].result).toBe("exceeds");
    expect(c[0].oversize).toBe(true);
  });
  it("3-phase requirement is answered by a 3W+E / 4W conductor statement", () => {
    expect(results("690V, 3ph", "690V 3W+E")).toEqual(["pass", "pass"]);
  });
  it("repeated identical values in description and spec collapse", () => {
    const a = requirementAttributes("690V Main Switchboard | 690V, 4000A").filter((x) => x.key === "voltage");
    expect(a).toHaveLength(1);
    expect(a[0].op).toBe("=");
  });
  it("system voltage and conductors must match", () => {
    expect(results("400V", "690V")).toEqual(["fail"]);
    expect(results("400V, 3W+E", "400V 4wire")).toEqual(["pass", "fail"]);
  });
  it("busduct straight length short of requirement", () => {
    expect(results("Straight length: 15m", "Straight length: 11.13m")).toEqual(["fail"]);
  });
  it("temperature range must be covered", () => {
    expect(results("-50°C to +65°C", "-40°C to +70°C")).toEqual(["fail"]);
    expect(results("-20°C to +55°C", "-40°C to +70°C")).toEqual(["exceeds"]);
  });
  it("cabling, fibre and protocols", () => {
    expect(results("Cat.6A", "Cat 6 UTP")).toEqual(["fail"]);
    expect(results("OS2 fibre", "OM4 multimode")).toContain("fail");
    expect(results("Modbus TCP", "Modbus RTU")).toEqual(["fail"]);
  });
  it("hazardous area: better gas group and T-class exceed", () => {
    expect(results("Ex d IIB T4", "Ex d IIC T6 certified")).toEqual(["pass", "exceeds", "exceeds"]);
  });
  it("vendor confirmation answers a line with no stated value", () => {
    expect(results("UL 1863 Compliant", "Comply", true)).toEqual(["confirmed"]);
    expect(results("UL 1863 Compliant", "")).toEqual(["not_stated"]);
  });
});

describe("quantities", () => {
  it("required qty from spec text", () => {
    expect(explicitQty("Proximity Card Reader | Qty: 14 Sets")).toEqual({ qty: 14, uom: "SET" });
  });
  it("trailing quantity at the end of an offer line", () => {
    expect(offeredQty("KXC-II 40507 4000A bolt-on busduct, IP55, 1 set")?.qty).toBe(1);
  });
  it("offered qty only from explicit forms", () => {
    expect(offeredQty("3 x 42U Rittal cabinets quoted")?.qty).toBe(3);
    expect(offeredQty("Qty: 24 Hanwha QNV-C6083R")?.qty).toBe(24);
    expect(offeredQty("Hanwha QNO-C6083R cameras")).toBeNull();
  });
});

describe("status from imported text", () => {
  it("empty or unrecognised text is not compliance", () => {
    expect(statusFromText("")).toBeNull();
    expect(statusFromText("Hanwha QNO-C6083R")).toBeNull();
  });
  it("recognises statuses", () => {
    expect(statusFromText("[Clarify] UPS autonomy")).toBe("Clarify");
    expect(statusFromText("Comply")).toBe("Comply");
    expect(statusFromText("Not quoted")).toBe("Not Quoted");
    expect(statusFromText("Deviation: 6 panels vs 9")).toBe("Deviation");
  });
});

// A small security/telecom tabulation used by the rule and scoring tests.
function sample(): Project {
  const p = newProject({ projectName: "Test", docNo: "TBE-1" });
  const rows: Row[] = [
    { id: "s1", level: 1, no: "S.8", desc: "Security CCTV & ACS", spec: "" },
    { id: "i1", level: 2, no: "S.8.2", desc: "24 Port Fiber Optic Patch Panel", spec: "24 Port Fiber Optic Patch Panel | Qty: 9 Sets" },
    { id: "i2", level: 2, no: "S.8.3", desc: "Outdoor CCTV Cabinet", spec: "Field Equipment Cabinet, IP66 | Qty: 3 Sets" },
    { id: "l1", level: 3, no: "", desc: "", spec: "- Protection Rating : IP66 or Higher" },
    { id: "l2", level: 3, no: "", desc: "", spec: "- UL 1863 Compliant" },
    { id: "s2", level: 1, no: "S.9", desc: "Radio", spec: "" },
    { id: "i3", level: 2, no: "S.9.1", desc: "Handheld radio", spec: "UHF handheld radio, IP67" },
  ];
  p.rows = rows;
  const a = newBidder("Alpha Systems", "ALPHA");
  const b = newBidder("Beta Telecom", "BETA");
  b.scope = ["s1"];
  p.bidders = [a, b];
  return p;
}

describe("rules: suggested status", () => {
  it("short quantity is a deviation even when the ports match", () => {
    const p = sample();
    p.cells.i1 = { [p.bidders[0].id]: { status: "Pending", offered: "6 x 24-port OM4 FOPP assemblies" } };
    const s = suggest(p, 1, p.bidders[0]);
    expect(s.status).toBe("Deviation");
    expect(s.reasons.some((r) => /6 offered vs 9/.test(r.text))).toBe(true);
  });
  it("spec line: lower IP is a deviation, 'Comply' is a confirmation", () => {
    const p = sample();
    const A = p.bidders[0].id;
    p.cells.l1 = { [A]: { status: "Pending", offered: "IP65" } };
    p.cells.l2 = { [A]: { status: "Pending", offered: "Comply" } };
    expect(suggest(p, 3, p.bidders[0]).status).toBe("Deviation");
    expect(suggest(p, 4, p.bidders[0]).status).toBe("Confirm");
  });
  it("no offer text gives no suggestion; exclusions become Not Quoted", () => {
    const p = sample();
    const A = p.bidders[0].id;
    expect(suggest(p, 1, p.bidders[0]).status).toBeNull();
    p.cells.i2 = { [A]: { status: "Pending", offered: "Not included in our scope" } };
    expect(suggest(p, 2, p.bidders[0]).status).toBe("Not Quoted");
  });
  it("sections outside a bidder's scope are Out of Scope", () => {
    const p = sample();
    const B = p.bidders[1];
    expect(inScope(p.rows, p.rows[6], B)).toBe(false);
    expect(effectiveStatus(p, p.rows[6], B)).toBe("Out of Scope");
    expect(suggest(p, 6, B).status).toBe("Out of Scope");
  });
  it("flags a line marked compliant that the checks reject", () => {
    const p = sample();
    const A = p.bidders[0].id;
    p.cells.l1 = { [A]: { status: "Comply", offered: "IP54" } };
    expect(conflict("Comply", suggest(p, 3, p.bidders[0]))).toBe(true);
    expect(runChecks(p).some((i) => i.code === "conflict")).toBe(true);
  });
});

describe("scoring and TQ register", () => {
  it("compliance is against in-scope lines, not quoted lines", () => {
    const p = sample();
    const [A, B] = p.bidders.map((b) => b.id);
    // Alpha: one compliant line, everything else not quoted.
    p.cells.i1 = { [A]: { status: "Comply" }, [B]: { status: "Comply" } };
    for (const id of ["i2", "l1", "l2", "i3"]) (p.cells[id] ??= {})[A] = { status: "Not Quoted" };
    for (const id of ["i2", "l1", "l2"]) (p.cells[id] ??= {})[B] = { status: "Comply" };
    const [sa, sb] = bidderStats(p);
    expect(sa.compliance).toBe(20);
    expect(sb.inScope).toBe(4); // S.9 radio is out of Beta's scope
    expect(sb.compliance).toBe(100);
    expect(rankingReady([sa, sb])).toBe(true);
  });
  it("unevaluated lines block ranking and appear as blockers", () => {
    const p = sample();
    const stats = bidderStats(p);
    expect(stats[0].pending).toBe(5);
    expect(rankingReady(stats)).toBe(false);
    expect(runChecks(p).filter((i) => i.code === "pending")).toHaveLength(2);
  });
  it("TQ numbers per bidder with standard wording", () => {
    const p = sample();
    const A = p.bidders[0].id;
    p.cells.i1 = { [A]: { status: "Deviation", offered: "6 x FOPP" } };
    p.cells.i2 = { [A]: { status: "Not Quoted" } };
    const tq = tqRegister(p);
    expect(tq.map((t) => t.tqNo)).toEqual(["TQ-ALPHA-001", "TQ-ALPHA-002"]);
    expect(tq[1].query).toMatch(/confirm inclusion/);
  });
  it("top sections", () => {
    expect(topSections(sample().rows).map((r) => r.id)).toEqual(["s1", "s2"]);
  });
});
