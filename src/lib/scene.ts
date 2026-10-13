// What the camera of a room photo sees: where it stands, which wall it faces,
// and where each planned piece ends up in that view. Used to tell the image
// model exactly where furniture goes, and to draw a numbered plan for it.

import { buildGeometry, type Geometry, type Wall } from "./layout";
import type { Placement, Room } from "./types";

export interface Camera {
  /** Camera position on the plan (cm). */
  x: number;
  y: number;
  /** Unit vector of the viewing direction. */
  vx: number;
  vy: number;
  /** Unit vector pointing to the viewer's left. */
  lx: number;
  ly: number;
  /** Distance from the camera to the facing wall (cm). */
  reach: number;
  facing: Wall;
}

/**
 * The photo was taken from the far side of the room, looking at `facingId`.
 * Place the camera where a ray from the middle of that wall, going into the
 * room, hits the opposite wall, pulled back a little from it.
 */
export function cameraFor(g: Geometry, facingId: string | undefined): Camera | null {
  const facing = g.walls.find((w) => w.id === facingId);
  if (!facing) return null;
  const mx = (facing.x1 + facing.x2) / 2;
  const my = (facing.y1 + facing.y2) / 2;
  let hit = Infinity;
  for (const w of g.walls) {
    if (w === facing) continue;
    const t = rayHit(mx, my, facing.nx, facing.ny, w);
    if (t !== null && t > 1 && t < hit) hit = t;
  }
  if (!Number.isFinite(hit)) return null;
  const reach = hit * 0.92;
  const vx = -facing.nx;
  const vy = -facing.ny;
  return { x: mx + facing.nx * reach, y: my + facing.ny * reach, vx, vy, lx: vy, ly: -vx, reach, facing };
}

function rayHit(ox: number, oy: number, dx: number, dy: number, w: Wall): number | null {
  const ex = w.x2 - w.x1;
  const ey = w.y2 - w.y1;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((w.x1 - ox) * ey - (w.y1 - oy) * ex) / den;
  const s = ((w.x1 - ox) * dy - (w.y1 - oy) * dx) / den;
  return s >= 0 && s <= 1 ? t : null;
}

export interface ViewSpot {
  visible: boolean;
  /** English phrase for the image model, e.g. "against the left wall, in the middle distance". */
  phrase: string;
}

/** Where a piece is, described from the camera's point of view. */
export function describeFromCamera(p: Placement, cam: Camera, g: Geometry): ViewSpot {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.depth / 2;
  const dx = cx - cam.x;
  const dy = cy - cam.y;
  const ahead = dx * cam.vx + dy * cam.vy; // distance in front of the camera
  const left = dx * cam.lx + dy * cam.ly; // positive = to the viewer's left

  if (ahead < 30) return { visible: false, phrase: "behind or right beside the camera" };

  const depth = ahead / cam.reach;
  const distance = depth > 0.75 ? "at the far end of the room" : depth > 0.4 ? "in the middle distance" : "in the foreground, close to the camera";

  // Which wall it stands against, if any, seen from the camera.
  let wallPhrase = "";
  for (const w of g.walls) {
    if (distanceToWall(p, w) > 20) continue;
    const back = w.nx * -cam.vx + w.ny * -cam.vy; // inward normal points back at the camera
    const leftWall = w.nx * -cam.lx + w.ny * -cam.ly; // inward normal points to the right = wall on the left
    if (back > 0.7) wallPhrase = "against the back wall (the wall the camera faces)";
    else if (leftWall > 0.7) wallPhrase = "against the left-hand wall";
    else if (leftWall < -0.7) wallPhrase = "against the right-hand wall";
    if (wallPhrase) break;
  }

  const halfWidth = Math.max(cam.facing.length / 2, 1);
  const side = left / halfWidth;
  const lateral = side > 0.35 ? "on the left side of the picture" : side < -0.35 ? "on the right side of the picture" : "in the centre of the picture";

  const parts = [wallPhrase, lateral, distance].filter(Boolean);
  return { visible: true, phrase: parts.join(", ") };
}

function distanceToWall(p: Placement, w: Wall): number {
  // Distance from the rectangle's nearest corner to the wall line, along its normal.
  const corners = [
    [p.x, p.y],
    [p.x + p.width, p.y],
    [p.x, p.y + p.depth],
    [p.x + p.width, p.y + p.depth],
  ];
  const along = (x: number, y: number) => (x - w.x1) * w.ux + (y - w.y1) * w.uy;
  const inside = (x: number, y: number) => (x - w.x1) * w.nx + (y - w.y1) * w.ny;
  let best = Infinity;
  for (const [x, y] of corners) {
    const a = along(x, y);
    if (a < -20 || a > w.length + 20) continue;
    best = Math.min(best, Math.abs(inside(x, y)));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Numbered plan as a PNG, for the image model
// ---------------------------------------------------------------------------

export interface PlanLabel {
  n: number;
  placement: Placement;
  kept?: boolean;
}

export async function planPng(room: Room, labels: PlanLabel[], cam: Camera | null, size = 1024): Promise<string> {
  const g = buildGeometry(room);
  const W = Math.max(g.width, 50);
  const D = Math.max(g.depth, 50);
  const m = Math.max(W, D) * 0.1; // room for opening labels outside the walls
  const fs = Math.max(W, D) / 28;
  const pts = g.points.map((p) => `${p.x},${p.y}`).join(" ");

  const openings = room.openings
    .map((o) => {
      const w = g.walls.find((x) => x.id === o.wall);
      if (!w) return "";
      const sx = w.x1 + w.ux * o.offset;
      const sy = w.y1 + w.uy * o.offset;
      const ex = sx + w.ux * o.size;
      const ey = sy + w.uy * o.size;
      const color = o.kind === "raam" ? "#4a90d9" : o.kind === "radiator" ? "#c0504d" : "#ffffff";
      const label = o.kind === "raam" ? "window" : o.kind === "radiator" ? "radiator" : o.kind === "deur" ? "door" : "opening";
      return `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${o.kind === "radiator" ? 8 : 14}"/>` +
        `<text x="${(sx + ex) / 2 - w.nx * fs * 1.1}" y="${(sy + ey) / 2 - w.ny * fs * 1.1}" font-size="${fs * 0.6}" text-anchor="middle" dominant-baseline="middle" fill="#555">${label}</text>`;
    })
    .join("");

  const boxes = labels
    .map(({ n, placement: p, kept }) =>
      `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.depth}" fill="${kept ? "#d9d9d9" : "#dfe8f5"}" stroke="#1f2a44" stroke-width="2"/>` +
      `<text x="${p.x + p.width / 2}" y="${p.y + p.depth / 2}" font-size="${Math.min(fs * 1.1, p.width * 0.7, p.depth * 0.9)}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#1f2a44">${kept ? "K" : n}</text>`,
    )
    .join("");

  let camera = "";
  if (cam) {
    const f = cam.facing;
    const s = fs * 1.2;
    const bx = cam.x - cam.vx * s;
    const by = cam.y - cam.vy * s;
    camera =
      `<line x1="${cam.x}" y1="${cam.y}" x2="${f.x1}" y2="${f.y1}" stroke="#e0a91f" stroke-width="3" stroke-dasharray="12 8"/>` +
      `<line x1="${cam.x}" y1="${cam.y}" x2="${f.x2}" y2="${f.y2}" stroke="#e0a91f" stroke-width="3" stroke-dasharray="12 8"/>` +
      `<polygon points="${cam.x},${cam.y} ${bx + cam.lx * s * 0.6},${by + cam.ly * s * 0.6} ${bx - cam.lx * s * 0.6},${by - cam.ly * s * 0.6}" fill="#e0a91f"/>` +
      `<text x="${bx - cam.vx * fs * 0.8}" y="${by - cam.vy * fs * 0.8}" font-size="${fs * 0.7}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#8a6500">CAMERA</text>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${W + 2 * m} ${D + 2 * m}" width="${size}" height="${Math.round((size * (D + 2 * m)) / (W + 2 * m))}" font-family="Arial, Helvetica, sans-serif">` +
    `<rect x="${-m}" y="${-m}" width="${W + 2 * m}" height="${D + 2 * m}" fill="#ffffff"/>` +
    `<polygon points="${pts}" fill="#f7f7f2" stroke="#1f2a44" stroke-width="14" stroke-linejoin="miter"/>` +
    openings +
    boxes +
    camera +
    `</svg>`;

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}
