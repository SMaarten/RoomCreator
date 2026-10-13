// Shared domain types.
//
// Plan coordinates are in centimetres, x to the right and y down.
// A room is a walk along its walls, clockwise, starting at the top-left
// corner: each wall has a length and a direction. The last wall back to the
// start is added automatically, so any shape (L-shapes, alcoves, a slanted
// wall) can be described. Walls are lettered A, B, C… in walking order.
// Because the walk is clockwise, the start of a wall is on the left when you
// stand in the room facing it; opening offsets are measured from there.

/** Wall letter: "A", "B", … */
export type WallId = string;

export interface WallSpec {
  id: string;
  length: number;
  /** Direction in degrees: 0 = right, 90 = down, 180 = left, 270 = up. */
  angle: number;
}

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
  /** Doors: hinge on the left or right, seen from inside the room. */
  hinge?: "links" | "rechts";
  /** Doors: opens into the room or out of it. */
  swing?: "binnen" | "buiten";
  note?: string;
}

export interface Room {
  name: string;
  height: number;
  /** All walls except the closing one, which is computed. */
  walls: WallSpec[];
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

export interface Alternative {
  product: IkeaProduct;
  note: string;
  /** Footprint on the plan if this product replaces the main choice. */
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
  alternatives: Alternative[];
  /** The user already has this or doesn't need it. */
  removed?: boolean;
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

export const wallLabel = (id: WallId) => `Wand ${id}`;
