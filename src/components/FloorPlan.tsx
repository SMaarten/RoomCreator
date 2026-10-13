import type { Opening, Room } from "../lib/types";
import { isFloorCovering, type PlanPiece } from "../lib/layout";

interface Props {
  room: Room;
  pieces?: PlanPiece[];
  highlight?: string | null;
  onSelect?: (key: string) => void;
}

const WALL = 12; // drawn wall thickness, cm

export function FloorPlan({ room, pieces = [], highlight, onSelect }: Props) {
  const W = Math.max(room.width, 50);
  const D = Math.max(room.depth, 50);
  const big = Math.max(W, D);
  const margin = Math.max(55, big * 0.11);
  const fs = Math.max(11, big / 38);

  // Rugs first so furniture draws on top.
  const ordered = [...pieces].sort((a, b) => Number(isFloorCovering(b.label)) - Number(isFloorCovering(a.label)));

  return (
    <svg
      className="plan"
      viewBox={`${-margin} ${-margin} ${W + margin * 1.6} ${D + margin * 1.6}`}
      role="img"
      aria-label={`Plattegrond ${room.width} bij ${room.depth} centimeter`}
    >
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" fill="none" className="plan-grid" strokeWidth={big / 900} />
        </pattern>
        <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" className="plan-hatch" strokeWidth="2.5" />
        </pattern>
      </defs>

      <rect x={0} y={0} width={W} height={D} className="plan-floor" />
      <rect x={0} y={0} width={W} height={D} fill="url(#grid)" />

      {/* Walls */}
      <rect
        x={-WALL / 2}
        y={-WALL / 2}
        width={W + WALL}
        height={D + WALL}
        className="plan-wall"
        strokeWidth={WALL}
      />

      {/* Wall names */}
      <text x={W / 2} y={-WALL - fs * 0.4} className="plan-wallname" fontSize={fs * 0.8} textAnchor="middle">A</text>
      <text x={W + WALL + fs * 0.5} y={D / 2} className="plan-wallname" fontSize={fs * 0.8} dominantBaseline="middle">B</text>
      <text x={W / 2} y={D + WALL + fs * 1.1} className="plan-wallname" fontSize={fs * 0.8} textAnchor="middle">C</text>
      <text x={-WALL - fs * 0.5} y={D / 2} className="plan-wallname" fontSize={fs * 0.8} textAnchor="end" dominantBaseline="middle">D</text>

      {room.openings.map((o) => (
        <OpeningShape key={o.id} o={o} W={W} D={D} />
      ))}

      {ordered.map((p) => {
        const { x, y, width, depth } = p.placement;
        const label = p.label;
        const labelFs = Math.min(fs * 0.85, width / Math.max(4, label.length * 0.62), depth * 0.5);
        const active = highlight === p.key;
        return (
          <g
            key={p.key}
            className={`plan-piece ${p.kind} ${isFloorCovering(label) ? "rug" : ""} ${active ? "active" : ""}`}
            onClick={onSelect ? () => onSelect(p.key) : undefined}
            style={onSelect ? { cursor: "pointer" } : undefined}
          >
            <rect x={x} y={y} width={width} height={depth} rx={2} />
            {p.kind === "kept" && <rect x={x} y={y} width={width} height={depth} fill="url(#hatch)" />}
            {/* Rugs sit under other pieces, so their label goes in the corner. */}
            {labelFs >= 6 &&
              (isFloorCovering(label) ? (
                <text x={x + labelFs * 0.5} y={y + labelFs * 0.6} fontSize={labelFs * 0.85} dominantBaseline="hanging">
                  {label}
                </text>
              ) : (
                <text x={x + width / 2} y={y + depth / 2} fontSize={labelFs} textAnchor="middle" dominantBaseline="middle">
                  {label}
                </text>
              ))}
            <title>{`${label} · ${width} × ${depth} cm`}</title>
          </g>
        );
      })}

      {/* Dimension lines, architect style */}
      <Dimension x1={0} y1={-margin * 0.62} x2={W} y2={-margin * 0.62} label={`${room.width} cm`} fs={fs} />
      <Dimension x1={-margin * 0.62} y1={0} x2={-margin * 0.62} y2={D} label={`${room.depth} cm`} fs={fs} vertical />
    </svg>
  );
}

function Dimension({ x1, y1, x2, y2, label, fs, vertical }: { x1: number; y1: number; x2: number; y2: number; label: string; fs: number; vertical?: boolean }) {
  const t = fs * 0.55;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g className="plan-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={fs / 9} />
      {/* 45° architectural ticks */}
      <line x1={x1 - t} y1={y1 + t} x2={x1 + t} y2={y1 - t} className="tick" strokeWidth={fs / 5} />
      <line x1={x2 - t} y1={y2 + t} x2={x2 + t} y2={y2 - t} className="tick" strokeWidth={fs / 5} />
      <text
        x={mx}
        y={my}
        fontSize={fs}
        textAnchor="middle"
        dy={vertical ? 0 : -fs * 0.45}
        transform={vertical ? `rotate(-90 ${mx} ${my}) translate(0 ${-fs * 0.45})` : undefined}
      >
        {label}
      </text>
    </g>
  );
}

function OpeningShape({ o, W, D }: { o: Opening; W: number; D: number }) {
  // Start point on the wall line, direction along the wall, inward normal.
  const geo = {
    A: { sx: o.offset, sy: 0, dx: 1, dy: 0, nx: 0, ny: 1 },
    C: { sx: o.offset, sy: D, dx: 1, dy: 0, nx: 0, ny: -1 },
    B: { sx: W, sy: o.offset, dx: 0, dy: 1, nx: -1, ny: 0 },
    D: { sx: 0, sy: o.offset, dx: 0, dy: 1, nx: 1, ny: 0 },
  }[o.wall];
  const { sx, sy, dx, dy, nx, ny } = geo;
  const s = o.size;
  const ex = sx + dx * s;
  const ey = sy + dy * s;
  // Gap in the wall: rectangle spanning the wall thickness.
  const gx = Math.min(sx, ex) - (dx === 0 ? WALL / 2 + 1 : 0);
  const gy = Math.min(sy, ey) - (dy === 0 ? WALL / 2 + 1 : 0);
  const gw = dx === 0 ? WALL + 2 : s;
  const gh = dy === 0 ? WALL + 2 : s;

  if (o.kind === "radiator") {
    const depth = 10;
    const rx = Math.min(sx, ex, sx + nx * depth);
    const ry = Math.min(sy, ey, sy + ny * depth);
    return (
      <rect
        x={rx}
        y={ry}
        width={dx === 0 ? depth : s}
        height={dy === 0 ? depth : s}
        className="plan-radiator"
      >
        <title>Radiator</title>
      </rect>
    );
  }

  if (o.kind === "raam") {
    return (
      <g className="plan-window">
        <rect x={gx} y={gy} width={gw} height={gh} />
        <line x1={sx} y1={sy} x2={ex} y2={ey} />
        <line x1={sx - nx * 4} y1={sy - ny * 4} x2={ex - nx * 4} y2={ey - ny * 4} />
        <title>{`Raam, ${s} cm`}</title>
      </g>
    );
  }

  if (o.kind === "deur") {
    const tx = sx + nx * s;
    const ty = sy + ny * s;
    const sweep = dx * ny - dy * nx > 0 ? 1 : 0;
    return (
      <g className="plan-door">
        <rect x={gx} y={gy} width={gw} height={gh} className="gap" />
        <line x1={sx} y1={sy} x2={tx} y2={ty} className="leaf" />
        <path d={`M ${ex} ${ey} A ${s} ${s} 0 0 ${sweep} ${tx} ${ty}`} className="swing" />
        <title>{`Deur, ${s} cm`}</title>
      </g>
    );
  }

  // Open passage or other: just the gap, with a dashed threshold.
  return (
    <g className="plan-door">
      <rect x={gx} y={gy} width={gw} height={gh} className="gap" />
      <line x1={sx} y1={sy} x2={ex} y2={ey} className="swing" />
      <title>{o.kind === "doorgang" ? "Open doorgang" : o.note || "Opening"}</title>
    </g>
  );
}
