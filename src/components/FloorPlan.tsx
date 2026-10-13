import { t } from "../lib/i18n";
import type { Opening, Room } from "../lib/types";
import { buildGeometry, isFloorCovering, openingPoints, type PlanPiece, type Wall } from "../lib/layout";

interface Props {
  room: Room;
  pieces?: PlanPiece[];
  highlight?: string | null;
  onSelect?: (key: string) => void;
}

const WALL = 12; // drawn wall thickness, cm

export function FloorPlan({ room, pieces = [], highlight, onSelect }: Props) {
  const g = buildGeometry(room);
  const W = Math.max(g.width, 50);
  const D = Math.max(g.depth, 50);
  const big = Math.max(W, D);
  const margin = Math.max(60, big * 0.13);
  const fs = Math.max(11, big / 38);
  const outline = g.points.map((p) => `${p.x},${p.y}`).join(" ");

  // Rugs first so furniture draws on top.
  const ordered = [...pieces].sort((a, b) => Number(isFloorCovering(b.label)) - Number(isFloorCovering(a.label)));

  return (
    <svg
      className="plan"
      viewBox={`${-margin} ${-margin} ${W + margin * 2} ${D + margin * 2}`}
      role="img"
      aria-label={t("plan.aria", { walls: g.walls.length, area: g.area.toFixed(1) })}
    >
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" fill="none" className="plan-grid" strokeWidth={big / 900} />
        </pattern>
        <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" className="plan-hatch" strokeWidth="2.5" />
        </pattern>
      </defs>

      {/* Walls: a double-width stroke, then the floor drawn over its inner half. */}
      <polygon points={outline} className="plan-wall" strokeWidth={WALL * 2} strokeLinejoin="miter" />
      <polygon points={outline} className="plan-floor" />
      <polygon points={outline} fill="url(#grid)" />

      {room.openings.map((o) => {
        const wall = g.walls.find((w) => w.id === o.wall);
        return wall ? <OpeningShape key={o.id} o={o} wall={wall} /> : null;
      })}

      {ordered.map((p) => {
        const { x, y, width, depth } = p.placement;
        const label = p.label;
        const labelFs = Math.min(fs * 0.85, width / Math.max(4, label.length * 0.62), depth * 0.5);
        const active = highlight === p.key;
        const rug = isFloorCovering(label);
        return (
          <g
            key={p.key}
            className={`plan-piece ${p.kind} ${rug ? "rug" : ""} ${active ? "active" : ""}`}
            onClick={onSelect ? () => onSelect(p.key) : undefined}
            style={onSelect ? { cursor: "pointer" } : undefined}
          >
            <rect x={x} y={y} width={width} height={depth} rx={2} />
            {p.kind === "kept" && <rect x={x} y={y} width={width} height={depth} fill="url(#hatch)" />}
            {/* Rugs sit under other pieces, so their label goes in the corner. */}
            {labelFs >= 6 &&
              (rug ? (
                <text x={x + labelFs * 0.5} y={y + labelFs * 0.6} fontSize={labelFs * 0.85} dominantBaseline="hanging">
                  {label}
                </text>
              ) : (
                <text x={x + width / 2} y={y + depth / 2} fontSize={labelFs} textAnchor="middle" dominantBaseline="middle">
                  {label}
                </text>
              ))}
            <title>{`${label}, ${width} × ${depth} cm`}</title>
          </g>
        );
      })}

      {g.walls.map((w) => (
        <WallDimension key={w.id} wall={w} offset={WALL + margin * 0.35} fs={fs} />
      ))}
    </svg>
  );
}

/** Architect-style dimension line parallel to a wall, outside the room. */
function WallDimension({ wall, offset, fs }: { wall: Wall; offset: number; fs: number }) {
  const ox = -wall.nx * offset;
  const oy = -wall.ny * offset;
  const x1 = wall.x1 + ox;
  const y1 = wall.y1 + oy;
  const x2 = wall.x2 + ox;
  const y2 = wall.y2 + oy;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Keep text upright.
  let rot = wall.angle;
  if (rot > 90 || rot <= -90) rot += 180;
  // 45° tick relative to the wall direction.
  const t = fs * 0.5;
  const tx = (wall.ux - wall.nx) * t * 0.7;
  const ty = (wall.uy - wall.ny) * t * 0.7;
  const short = wall.length < fs * 6;
  return (
    <g className="plan-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={fs / 9} />
      <line x1={x1 - tx} y1={y1 - ty} x2={x1 + tx} y2={y1 + ty} className="tick" strokeWidth={fs / 5} />
      <line x1={x2 - tx} y1={y2 - ty} x2={x2 + tx} y2={y2 + ty} className="tick" strokeWidth={fs / 5} />
      <text
        x={mx - wall.nx * fs * 0.75}
        y={my - wall.ny * fs * 0.75}
        fontSize={short ? fs * 0.75 : fs}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${rot} ${mx - wall.nx * fs * 0.75} ${my - wall.ny * fs * 0.75})`}
      >
        <tspan className="wall-id">{wall.id}</tspan> {short ? wall.length : `${wall.length} cm`}
      </text>
    </g>
  );
}

function OpeningShape({ o, wall }: { o: Opening; wall: Wall }) {
  const p = openingPoints(wall, o);
  const { nx, ny } = wall;
  const s = o.size;
  // Gap through the wall thickness (wall is drawn outside the floor edge).
  const out = WALL + 1;
  const gap = `${p.sx + nx},${p.sy + ny} ${p.ex + nx},${p.ey + ny} ${p.ex - nx * out},${p.ey - ny * out} ${p.sx - nx * out},${p.sy - ny * out}`;

  if (o.kind === "radiator") {
    const d = 10;
    return (
      <polygon
        points={`${p.sx},${p.sy} ${p.ex},${p.ey} ${p.ex + nx * d},${p.ey + ny * d} ${p.sx + nx * d},${p.sy + ny * d}`}
        className="plan-radiator"
      >
        <title>{t("plan.radiator")}</title>
      </polygon>
    );
  }

  if (o.kind === "raam") {
    const m = WALL / 2;
    return (
      <g className="plan-window">
        <polygon points={gap} />
        <line x1={p.sx - nx * (m - 3)} y1={p.sy - ny * (m - 3)} x2={p.ex - nx * (m - 3)} y2={p.ey - ny * (m - 3)} />
        <line x1={p.sx - nx * (m + 3)} y1={p.sy - ny * (m + 3)} x2={p.ex - nx * (m + 3)} y2={p.ey - ny * (m + 3)} />
        <title>{t("plan.window", { size: s })}</title>
      </g>
    );
  }

  if (o.kind === "deur") {
    // Arc from the free jamb to the leaf tip, centred on the hinge.
    const cross = (p.jx - p.hx) * (p.ty - p.hy) - (p.jy - p.hy) * (p.tx - p.hx);
    const sweep = cross > 0 ? 1 : 0;
    return (
      <g className="plan-door">
        <polygon points={gap} className="gap" />
        <line x1={p.hx} y1={p.hy} x2={p.tx} y2={p.ty} className="leaf" />
        <path d={`M ${p.jx} ${p.jy} A ${s} ${s} 0 0 ${sweep} ${p.tx} ${p.ty}`} className="swing" />
        <title>{`${t("plan.door", { size: s })}, ${t(`hinge.${o.hinge ?? "links"}`)}, ${t(`swing.${o.swing ?? "binnen"}`)}`}</title>
      </g>
    );
  }

  // Open passage or other: just the gap, with a dashed threshold.
  return (
    <g className="plan-door">
      <polygon points={gap} className="gap" />
      <line x1={p.sx} y1={p.sy} x2={p.ex} y2={p.ey} className="swing" />
      <title>{o.kind === "doorgang" ? t("plan.passage") : o.note || t("plan.opening")}</title>
    </g>
  );
}
