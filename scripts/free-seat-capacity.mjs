#!/usr/bin/env node
/**
 * Answers one question: how many volunteers can be given free-clinic access
 * before they crowd paying ticket buyers out of the seats?
 *
 *   node scripts/free-seat-capacity.mjs                # uses real quota data
 *   node scripts/free-seat-capacity.mjs --seats 12     # assume 12 seats/clinic
 *   node scripts/free-seat-capacity.mjs --reserve 0.5  # keep 50% for buyers
 *   node scripts/free-seat-capacity.mjs --data /tmp/s.json   # read another snapshot
 *
 * --data is what lets a CI job report on a FRESH pull without committing it:
 * point fetch-pretix.mjs at a scratch file via PRETIX_OUT, then point this at
 * the same path. Relative paths resolve against the working directory, not the
 * script, so it behaves like every other CLI tool the caller already knows.
 *
 * WHY BLOCKS AND NOT A TOTAL
 *
 * A festival-wide seat total is the wrong denominator, because a person can
 * only be in one clinic at a time. If all the free capacity sits in one
 * two-hour window, then that window's seat count is the whole constraint and
 * the day's total is a fiction. So this walks the schedule, finds each span
 * where a fixed set of free clinics is running, and reports the seats standing
 * open in it. The tightest block governs.
 *
 * WHY SEATS ARE NOT ALWAYS ADDED UP
 *
 * Seats live on pretix quotas, and one quota can gate several clinics (see
 * capacityByItem in fetch-pretix.mjs). Five tours sharing a pool of 40 offer
 * 40 seats, not 200. This sums each distinct pool once.
 */
import { readFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const raw = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] != null ? argv[i + 1] : null;
};
const arg = (name, fallback) => {
  const v = raw(name);
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`--${name} needs a number, got "${v}".`);
    process.exit(2);
  }
  return n;
};

// The share of each free clinic's seats to hold back for paying buyers. A
// fraction, not a percentage — 0.5 means half. Guarded because --reserve 50 is
// the obvious slip, and left unchecked it silently reports a NEGATIVE headroom
// rather than failing.
const RESERVE = arg("reserve", 0.5);
if (RESERVE < 0 || RESERVE > 1) {
  console.error(`--reserve is a fraction between 0 and 1 (0.5 = half). Got ${RESERVE}.`);
  process.exit(2);
}
// Used only for clinics with no quota set in pretix, so the report still has a
// shape before the seat counts are filled in. Null means "leave it unknown".
const ASSUME = arg("seats", null);

// Default to the committed snapshot; --data overrides, resolved against cwd.
const source = raw("data")
  ? new URL(raw("data"), `file://${process.cwd()}/`)
  : new URL("../data/schedule.json", import.meta.url);

let data;
try {
  data = JSON.parse(await readFile(source, "utf8"));
} catch (err) {
  console.error(`Could not read the schedule at ${decodeURIComponent(source.pathname)} — ${err.message}`);
  process.exit(1);
}
const tz = data.shop?.timezone || "America/New_York";

const fmt = (iso, opts) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(iso));
const clock = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });

/**
 * Seats in one clinic, and whether that number is a guess.
 * `capacity.seats` is null when no quota caps the clinic — genuinely unlimited,
 * which is a different thing from "not configured yet", but pretix cannot tell
 * the two apart and neither can we.
 */
function seatsOf(s) {
  const n = s.capacity?.seats;
  if (n != null) return { seats: n, assumed: false };
  return { seats: ASSUME, assumed: true };
}

/** The quota that actually limits a clinic — the smallest one gating it. */
function bindingQuota(s) {
  const qs = (s.capacity?.quotas || []).filter((q) => q.size != null);
  if (!qs.length) return null;
  return qs.reduce((a, b) => (b.size < a.size ? b : a));
}

const free = data.days
  .flatMap((d) => d.sessions)
  .filter((s) => Number(s.price) === 0 && s.start && s.end);

if (!free.length) {
  console.log("No free scheduled clinics in data/schedule.json.");
  process.exit(0);
}

// Cut the timeline at every start and end, so within each resulting span the
// set of running clinics never changes. Spans where nothing free runs drop out.
const edges = [...new Set(free.flatMap((s) => [s.start, s.end]))].sort();
const blocks = [];
for (let i = 0; i < edges.length - 1; i++) {
  const [from, to] = [edges[i], edges[i + 1]];
  const running = free.filter((s) => s.start <= from && s.end >= to);
  if (!running.length) continue;
  // Merge into the previous block when the same clinics are still running, so
  // one 9–11am cohort reads as one block rather than four half-hour slices.
  const prev = blocks[blocks.length - 1];
  const key = running.map((s) => s.slotId).sort().join("|");
  if (prev && prev.key === key && prev.to === from) prev.to = to;
  else blocks.push({ from, to, key, running });
}

let peak = null;
for (const b of blocks) {
  // Sum each distinct quota pool once; clinics with no quota fall back to their
  // own (possibly assumed) seat count.
  const pools = new Map();
  let loose = 0;
  let unknown = 0;
  let assumed = false;
  for (const s of b.running) {
    const { seats, assumed: guess } = seatsOf(s);
    if (guess) assumed = true;
    if (seats == null) { unknown++; continue; }
    const q = bindingQuota(s);
    if (q) pools.set(q.id, q.size);
    else loose += seats;
  }
  const seats = [...pools.values()].reduce((a, n) => a + n, 0) + loose;
  b.seats = unknown === b.running.length && !seats ? null : seats;
  b.unknown = unknown;
  b.assumed = assumed;
  b.headroom = b.seats == null ? null : Math.floor(b.seats * (1 - RESERVE));
  if (b.seats != null && (!peak || b.seats > peak.seats)) peak = b;
}

console.log(`Free-clinic capacity by time block  (times ${tz})`);
console.log(`Reserving ${Math.round(RESERVE * 100)}% of every free seat for paying buyers.\n`);

let day = null;
for (const b of blocks) {
  const d = fmt(b.from, { weekday: "long", month: "long", day: "numeric" });
  if (d !== day) { console.log(`${day ? "\n" : ""}${d}`); day = d; }
  const span = `${clock(b.from)}–${clock(b.to)}`.padEnd(18);
  const seats = b.seats == null ? "seats unknown" : `${String(b.seats).padStart(3)} seats`;
  const vols = b.headroom == null ? "" : ` → ${String(b.headroom).padStart(3)} volunteers`;
  const n = b.running.length;
  const count = `${String(n).padStart(2)} clinic${n === 1 ? " " : "s"}`;
  console.log(`  ${span}${count}  ${seats}${vols}${b.assumed ? "  *" : ""}`);
  for (const s of b.running) {
    const { seats: n, assumed: guess } = seatsOf(s);
    const q = bindingQuota(s);
    const pool = q && q.sharedWith > 1 ? `  [shares pool "${q.name}" with ${q.sharedWith} items]` : "";
    const lvl = s.meta?.difficulty ? ` (${s.meta.difficulty})` : "";
    console.log(`      ${String(n ?? "?").padStart(3)}${guess ? "*" : " "}  ${s.name}${lvl}${pool}`);
  }
}

console.log("\n" + "=".repeat(70));
if (blocks.some((b) => b.assumed)) {
  console.log(`* assumed — no quota set in pretix.${ASSUME == null ? " Pass --seats N to model one." : ""}\n`);
}

// Weekend pool. Each SESSION counts once (a clinic running twice sells seats
// twice), but each shared quota pool counts once per block it appears in —
// which is why this is rebuilt from sessions rather than summed off the blocks,
// where a clinic spanning two spans would be double-counted.
const pools = new Map();
let loose = 0;
for (const s of free) {
  const { seats } = seatsOf(s);
  if (seats == null) continue;
  const q = bindingQuota(s);
  if (q) pools.set(q.id, q.size);
  else loose += seats;
}
const total = [...pools.values()].reduce((a, n) => a + n, 0) + loose;

if (peak) {
  console.log(
    `PEAK CONTENTION  ${fmt(peak.from, { weekday: "long" })} ${clock(peak.from)}–${clock(peak.to)}: ` +
    `${peak.running.length} free clinics, ${peak.seats} seats.`
  );
  // Levels matter more than the raw count: the Trapps tours are graded, so a
  // 5.6 climber is not choosing between all of them — they are choosing between
  // the ones that match their grade. Seats a volunteer cannot use are not
  // headroom, so the per-level split is the honest read of the peak block.
  const byLevel = new Map();
  for (const s of peak.running) {
    const lvl = s.meta?.difficulty || "Unset";
    const { seats } = seatsOf(s);
    byLevel.set(lvl, (byLevel.get(lvl) || 0) + (seats || 0));
  }
  const split = [...byLevel].map(([l, n]) => `${l} ${n}`).join(", ");
  console.log(`                 by level — ${split}`);
  console.log(`                 no volunteer can occupy more than ONE of these at a time.\n`);
}

if (total) {
  const buyers = Math.round(total * RESERVE);
  const forVols = total - buyers;
  console.log(`WEEKEND POOL     ${total} free seats total, across ${free.length} sittings.`);
  console.log(`                 hold ${Math.round(RESERVE * 100)}% (${buyers}) for paying buyers → ${forVols} seats for volunteers.\n`);
  console.log(`VOLUNTEER CEILING at that reserve, by how many free clinics each one takes:`);
  for (const per of [1, 2, 3]) {
    console.log(`                 ${per} clinic${per > 1 ? "s" : " "} each → ${String(Math.floor(forVols / per)).padStart(3)} volunteers`);
  }
  console.log(`\nThe peak block is the real ceiling on any single timeslot: more than`);
  console.log(`${peak ? peak.seats : "?"} volunteers wanting a free clinic at ${peak ? clock(peak.from) : "peak"} cannot all be seated,`);
  console.log(`whatever the weekend total says.`);
}
