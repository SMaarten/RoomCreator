import { t } from "./i18n";
import type { Opening, Placement, Room, WallId, WallSpec } from "./types";

// ---------------------------------------------------------------------------
// Room geometry
// ---------------------------------------------------------------------------

export interface Wall {
  id: WallId;
  /** True for the wall that closes the shape automatically. */
  closing: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  /** Unit vector along the wall (walking direction). */
  ux: number;
  uy: number;
  /** Unit normal pointing into the room. */
  nx: number;
  ny: number;
  angle: number;
}

export interface Geometry {
  walls: Wall[];
  points: { x: number; y: number }[];
  /** Bounding box; the shape is shifted so its top-left is at 0,0. */
  width: number;
  depth: number;
  /** Floor area in m². */
  area: number;
  /** Positive when the walk is clockwise on screen. */
  clockwise: boolean;
}

export const wallLetter = (i: number) => String.fromCharCode(65 + i);
const round = (n: number) => Math.round(n * 10) / 10;

export function buildGeometry(room: Room): Geometry {
  // Walk the walls from 0,0.
  const raw: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (const w of room.walls) {
    const last = raw[raw.length - 1];
    const a = (w.angle * Math.PI) / 180;
    raw.push({ x: last.x + Math.cos(a) * w.length, y: last.y + Math.sin(a) * w.length });
  }
  const end = raw[raw.length - 1];
  const gap = Math.hypot(end.x, end.y);
  // Drop the end point when the walk already returns to the start.
  const pts = gap < 1 ? raw.slice(0, -1) : raw;

  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const points = pts.map((p) => ({ x: round(p.x - minX), y: round(p.y - minY) }));

  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    twice += p.x * q.y - q.x * p.y;
  }
  const clockwise = twice > 0;

  const walls: Wall[] = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / length;
    const uy = (q.y - p.y) / length;
    return {
      id: wallLetter(i),
      closing: i >= room.walls.length,
      x1: p.x,
      y1: p.y,
      x2: q.x,
      y2: q.y,
      length: Math.round(length),
      ux,
      uy,
      nx: clockwise ? -uy : uy,
      ny: clockwise ? ux : -ux,
      angle: (Math.atan2(uy, ux) * 180) / Math.PI,
    };
  });

  return {
    walls,
    points,
    width: Math.round(Math.max(...points.map((p) => p.x))),
    depth: Math.round(Math.max(...points.map((p) => p.y))),
    area: Math.abs(twice) / 2 / 10000,
    clockwise,
  };
}

export function isAxisAligned(w: Wall): boolean {
  return Math.abs(w.ux) < 0.001 || Math.abs(w.uy) < 0.001;
}

/** Problems with the room shape itself, in Dutch. */
export function checkRoom(room: Room, g: Geometry): string | null {
  if (room.walls.length < 2) return t("shape.minWalls");
  if (room.walls.some((w) => !(w.length > 0))) return t("shape.wallLength");
  if (g.walls.length < 3 || g.area < 1) return t("shape.noArea");
  if (!g.clockwise) return t("shape.clockwise");
  if (selfIntersects(g)) return t("shape.crossing");
  return null;
}

function selfIntersects(g: Geometry): boolean {
  const n = g.walls.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours share a corner
      if (segmentsCross(g.walls[i], g.walls[j])) return true;
    }
  }
  return false;
}

function segmentsCross(a: Wall, b: Wall): boolean {
  const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = d(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = d(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = d(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = d(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

export function validateOpening(g: Geometry, o: Opening): string | null {
  const wall = g.walls.find((w) => w.id === o.wall);
  if (!wall) return t("opening.wallGone");
  if (!(o.size > 0)) return t("opening.widthZero");
  if (o.offset < 0 || o.offset + o.size > wall.length) return t("opening.notFit", { id: wall.id, len: wall.length });
  return null;
}

/** Points of an opening on its wall: start, end, and for doors hinge/tip. */
export function openingPoints(wall: Wall, o: Opening) {
  const sx = wall.x1 + wall.ux * o.offset;
  const sy = wall.y1 + wall.uy * o.offset;
  const ex = sx + wall.ux * o.size;
  const ey = sy + wall.uy * o.size;
  // Walls run clockwise, so their start is on the left seen from inside.
  const hingeAtStart = (o.hinge ?? "links") === "links";
  const hx = hingeAtStart ? sx : ex;
  const hy = hingeAtStart ? sy : ey;
  const jx = hingeAtStart ? ex : sx;
  const jy = hingeAtStart ? ey : sy;
  const dir = (o.swing ?? "binnen") === "binnen" ? 1 : -1;
  const tx = hx + wall.nx * o.size * dir;
  const ty = hy + wall.ny * o.size * dir;
  return { sx, sy, ex, ey, hx, hy, jx, jy, tx, ty };
}

/** Bounding box of the area a door leaf sweeps inside the room, or null. */
export function doorSwing(g: Geometry, o: Opening): Placement | null {
  if (o.kind !== "deur" || (o.swing ?? "binnen") !== "binnen") return null;
  const wall = g.walls.find((w) => w.id === o.wall);
  if (!wall) return null;
  const p = openingPoints(wall, o);
  const xs = [p.hx, p.jx, p.tx, p.jx + wall.nx * o.size];
  const ys = [p.hy, p.jy, p.ty, p.jy + wall.ny * o.size];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, depth: Math.max(...ys) - y };
}

/** Old projects stored a plain rectangle with A–D offsets in plan order. */
export function migrateRoom(room: any): Room {
  if (Array.isArray(room?.walls)) return room as Room;
  const width = Number(room?.width) || 400;
  const depth = Number(room?.depth) || 350;
  const walls: WallSpec[] = [
    { id: "w1", length: width, angle: 0 },
    { id: "w2", length: depth, angle: 90 },
    { id: "w3", length: width, angle: 180 },
  ];
  const openings: Opening[] = (room?.openings ?? []).map((o: Opening) => {
    // C and D used to run left→right and top→bottom; the walk runs the other way.
    if (o.wall === "C" || o.wall === "D") {
      const len = o.wall === "C" ? width : depth;
      return { ...o, offset: Math.max(0, len - o.offset - o.size) };
    }
    return o;
  });
  return { name: room?.name ?? "", height: Number(room?.height) || 260, walls, openings };
}

export const PRESETS: Record<"rechthoek" | "l" | "schuin", { walls: Omit<WallSpec, "id">[] }> = {
  rechthoek: {
    walls: [
      { length: 400, angle: 0 },
      { length: 350, angle: 90 },
      { length: 400, angle: 180 },
    ],
  },
  l: {
    walls: [
      { length: 500, angle: 0 },
      { length: 250, angle: 90 },
      { length: 200, angle: 180 },
      { length: 200, angle: 90 },
      { length: 300, angle: 180 },
    ],
  },
  schuin: {
    walls: [
      { length: 300, angle: 0 },
      { length: 141, angle: 45 },
      { length: 250, angle: 90 },
      { length: 400, angle: 180 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Layout checks
// ---------------------------------------------------------------------------

export interface PlanPiece {
  key: string;
  label: string;
  placement: Placement;
  kind: "new" | "kept";
}

/** Rugs and mats may sit under other furniture. */
export function isFloorCovering(label: string): boolean {
  return /kleed|tapijt|mat\b|vloerkleed|rug/i.test(label);
}

function overlaps(a: Placement, b: Placement, tolerance = 2): boolean {
  return (
    a.x + tolerance < b.x + b.width &&
    b.x + tolerance < a.x + a.width &&
    a.y + tolerance < b.y + b.depth &&
    b.y + tolerance < a.y + a.depth
  );
}

function pointInPolygon(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function insideRoom(p: Placement, g: Geometry): boolean {
  const t = 2; // tolerance, cm
  const corners = [
    [p.x + t, p.y + t],
    [p.x + p.width - t, p.y + t],
    [p.x + p.width - t, p.y + p.depth - t],
    [p.x + t, p.y + p.depth - t],
  ];
  if (!corners.every(([x, y]) => pointInPolygon(x, y, g.points))) return false;
  // A room corner poking into the rectangle means a wall cuts through it.
  return !g.points.some((c) => c.x > p.x + t && c.x < p.x + p.width - t && c.y > p.y + t && c.y < p.y + p.depth - t);
}

/** Human-readable problems with a layout, in Dutch. */
export function checkLayout(g: Geometry, room: Room, pieces: PlanPiece[]): string[] {
  const issues: string[] = [];
  for (const p of pieces) {
    if (!insideRoom(p.placement, g)) issues.push(t("issue.outside", { label: p.label }));
  }
  const solid = pieces.filter((p) => !isFloorCovering(p.label));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlaps(solid[i].placement, solid[j].placement)) {
        issues.push(t("issue.overlap", { a: solid[i].label, b: solid[j].label }));
      }
    }
  }
  for (const o of room.openings) {
    const swing = doorSwing(g, o);
    if (!swing) continue;
    for (const p of solid) {
      if (overlaps(p.placement, swing, 5)) issues.push(t("issue.door", { label: p.label, wall: o.wall }));
    }
  }
  return issues;
}
