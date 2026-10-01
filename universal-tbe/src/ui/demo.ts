// A small fictitious electrical + telecom tabulation for first use.

import { newBidder, newProject } from "../engine/project";
import type { Project, Row } from "../engine/types";

export function demoProject(): Project {
  const p = newProject({
    projectName: "Demo Plant Expansion",
    projectShort: "DEMO ELEC+TEL",
    docNo: "DEMO-TBE-001",
    mrNo: "DEMO-MR-001",
    system: "LV Switchgear, Fibre Optic and PAGA (demo data)",
    discipline: "mixed",
    client: "Demo Client",
    contractor: "Demo EPC",
    location: "Demo site",
    notes: "Fictitious data to show how the checks work. Replace with your project via Open.",
  });
  const R = (id: string, level: 1 | 2 | 3, no: string, desc: string, spec: string, qty?: number, uom?: string): Row => ({
    id,
    level,
    no,
    desc,
    spec,
    ...(qty != null ? { qty, uom } : {}),
  });
  p.rows = [
    R("s1", 1, "1", "LV Switchgear & Busduct", ""),
    R("i11", 2, "1.1", "690V Main Switchboard", "690V, 3ph, 3W+E, 4000A, 50Hz, 80kA for 1sec, IP42, Form 4b", 1, "SET"),
    R("i12", 2, "1.2", "LV Busduct", "690V, 4000A, 80kA/1s, IP55, Straight length: 15m", 1, "SET"),
    R("s2", 1, "2", "Fibre Optic Outside Plant", ""),
    R("i21", 2, "2.1", "144 Core Fiber Optic Splice Closure", "144 Core Fiber Optic Splice Closure", 12, "SET"),
    R("l211", 3, "", "", "- Protection Rating : IP68 or Higher"),
    R("l212", 3, "", "", "- Fiber Capacity : Minimum 144 Fiber Splices"),
    R("l213", 3, "", "", "- Operating Temperature : -40°C to +65°C"),
    R("l214", 3, "", "", "- Standard : IEC 61753-1"),
    R("s3", 1, "3", "PAGA Field Devices", ""),
    R("i31", 2, "3.1", "Explosion-proof horn loudspeaker", "Ex d IIB T4, Zone 1, 25W, SPL 115 dB, IP66", 20, "EA"),
  ];
  const a = newBidder("Alpha Electric & Telecom", "ALPHA");
  a.quoteRef = "AET-Q-1001 Rev.0";
  const b = newBidder("Beta Systems", "BETA");
  b.quoteRef = "BS-2026-044";
  b.scope = ["s1", "s2"];
  p.bidders = [a, b];
  const A = a.id;
  const B = b.id;
  p.cells = {
    i11: {
      // Marked compliant by the evaluator although Icw is 65 kA: shows the conflict flag.
      [A]: { status: "Comply", offered: "MNS 3.0 switchboard, 690V, 3W+E, 5000A, Icw 65kA 1s, IP42, Form 4b, Qty 1" },
      [B]: { status: "Pending", offered: "690V 4000A 80kA/1s 3W+E, IP54, Form 4b, 1 set" },
    },
    i12: { [A]: { status: "Pending", offered: "KXC-II 40507 4000A bolt-on busduct, IP55, straight length 11.13m, 1 set" } },
    i21: {
      [A]: { status: "Pending", offered: "12 x FOSC-450 D6 closure, 144 splices" },
      [B]: { status: "Pending", offered: "10 x closure type OC-96" },
    },
    l211: { [A]: { status: "Pending", offered: "IP68" }, [B]: { status: "Pending", offered: "IP67" } },
    l212: { [A]: { status: "Pending", offered: "144 splices" }, [B]: { status: "Pending", offered: "96 splices" } },
    l213: { [A]: { status: "Pending", offered: "-40°C to +70°C" }, [B]: { status: "Pending", offered: "-20°C to +60°C" } },
    l214: { [A]: { status: "Pending", offered: "Comply" } },
    i31: { [A]: { status: "Pending", offered: "20 x Ex d IIC T6 25W horn, SPL 118dB, IP66/67" } },
  };
  return p;
}
