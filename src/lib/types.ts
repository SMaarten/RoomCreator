// Shared domain types.
//
// Plan coordinates are in centimetres. Origin is the top-left inside corner of
// the room as drawn: x runs to the right (room width), y runs down (room depth).
// Walls are named by their side of the drawing:
//   A = top (y = 0), offsets measured left → right
//   B = right (x = width), offsets measured top → bottom
//   C = bottom (y = depth), offsets measured left → right
//   D = left (x = 0), offsets measured top → bottom

export type WallId = "A" | "B" | "C" | "D";

export type OpeningKind = "deur" | "raam" | "radiator" | "doorgang" | "anders";

export interface Opening {
  id: string;
  wall: WallId;
  kind: OpeningKind;
  /** Distance from the start of the wall to the start of the opening (cm). */
  offset: number;
  /** Width of the opening along the wall (cm). */
  size: number;
  /** Windows: sill height above the floor (cm). */
  sillHeight?: number;
  note?: string;
}

export interface Room {
  name: string;
  width: number;
  depth: number;
  height: number;
  openings: Opening[];
}

export interface Photo {
  id: string;
  /** JPEG data URL, already resized for upload. */
  dataUrl: string;
  /** Which wall the photo looks at, if the user says so. */
  facing?: WallId;
}

export interface ExistingItem {
  id: string;
  name: string;
  description: string;
  widthCm: number;
  depthCm: number;
  keep: boolean;
}

export interface RoomAnalysis {
  roomType: string;
  description: string;
  palette: string[];
  light: string;
  existing: ExistingItem[];
}

export interface Preferences {
  purpose: string;
  styleId: string;
  budget: number;
  wishes: string;
}

export interface IkeaProduct {
  itemNo: string;
  name: string;
  typeName: string;
  measure: string;
  price: number;
  currency: string;
  imageUrl: string;
  url: string;
  colors: string[];
  rating?: number;
}

export interface Placement {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface DesignItem {
  itemNo: string;
  quantity: number;
  role: string;
  reason: string;
  placement: Placement | null;
  product: IkeaProduct;
}

export interface KeptPlacement {
  existingId: string;
  name: string;
  placement: Placement;
}

export interface Design {
  summary: string;
  items: DesignItem[];
  kept: KeptPlacement[];
  tips: string[];
  /** Items Claude named that never came back from an IKEA search. */
  dropped: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface Settings {
  anthropicKey: string;
  geminiKey: string;
  geminiModel: string;
}

export interface StyleOption {
  id: string;
  label: string;
  description: string;
}

export const STYLES: StyleOption[] = [
  { id: "scandinavisch", label: "Scandinavisch", description: "Licht hout, zachte neutrale tinten, rustige lijnen." },
  { id: "japandi", label: "Japandi", description: "Japanse eenvoud en Noordse warmte, natuurlijke materialen." },
  { id: "modern", label: "Modern minimalistisch", description: "Weinig spullen, strakke vormen, beperkt kleurpalet." },
  { id: "industrieel", label: "Industrieel", description: "Metaal, donker hout, robuuste texturen." },
  { id: "mid-century", label: "Mid-century", description: "Warm hout, taps toelopende poten, retro accenten." },
  { id: "boho", label: "Bohemian", description: "Gelaagd textiel, planten, aardetinten." },
  { id: "landelijk", label: "Landelijk", description: "Gezellig, verweerd hout, linnen, zachte kleuren." },
  { id: "kleurrijk", label: "Speels & kleurrijk", description: "Durvende kleuren en patronen, vrolijk." },
];

export const PURPOSES = [
  "Woonkamer",
  "Slaapkamer",
  "Kinderkamer",
  "Thuiskantoor",
  "Eetkamer",
  "Studio (wonen + slapen)",
  "Logeerkamer",
];

export const OPENING_LABELS: Record<OpeningKind, string> = {
  deur: "Deur",
  raam: "Raam",
  radiator: "Radiator",
  doorgang: "Open doorgang",
  anders: "Anders",
};

export const WALL_LABELS: Record<WallId, string> = {
  A: "Wand A (boven)",
  B: "Wand B (rechts)",
  C: "Wand C (onder)",
  D: "Wand D (links)",
};
