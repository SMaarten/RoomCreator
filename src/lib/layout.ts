import type { Opening, Placement, Room, WallId } from "./types";

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

/** The square swept by a door leaf, as a rectangle inside the room. */
export function doorSwing(o: Opening, room: Room): Placement {
  const s = o.size;
  switch (o.wall) {
    case "A": return { x: o.offset, y: 0, width: s, depth: s };
    case "C": return { x: o.offset, y: room.depth - s, width: s, depth: s };
    case "B": return { x: room.width - s, y: o.offset, width: s, depth: s };
    case "D": return { x: 0, y: o.offset, width: s, depth: s };
  }
}

export function wallLength(room: Room, wall: WallId): number {
  return wall === "A" || wall === "C" ? room.width : room.depth;
}

/** Human-readable problems with a layout, in Dutch. */
export function checkLayout(room: Room, pieces: PlanPiece[]): string[] {
  const issues: string[] = [];
  for (const p of pieces) {
    const { x, y, width, depth } = p.placement;
    if (x < -2 || y < -2 || x + width > room.width + 2 || y + depth > room.depth + 2) {
      issues.push(`${p.label} valt (deels) buiten de kamer.`);
    }
  }
  const solid = pieces.filter((p) => !isFloorCovering(p.label));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlaps(solid[i].placement, solid[j].placement)) {
        issues.push(`${solid[i].label} en ${solid[j].label} overlappen.`);
      }
    }
  }
  for (const o of room.openings.filter((o) => o.kind === "deur")) {
    const swing = doorSwing(o, room);
    for (const p of solid) {
      if (overlaps(p.placement, swing, 5)) issues.push(`${p.label} staat in de draaicirkel van de deur op wand ${o.wall}.`);
    }
  }
  return issues;
}

export function validateOpening(room: Room, o: Opening): string | null {
  const len = wallLength(room, o.wall);
  if (o.size <= 0) return "Breedte moet groter dan 0 zijn.";
  if (o.offset < 0 || o.offset + o.size > len) return `Past niet op deze wand (${len} cm lang).`;
  return null;
}
