import type { DesignSession } from "./claude";
import { t, type Key, type Lang } from "./i18n";
import type { CatalogLocale } from "./locale";

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
  /** Purpose id, e.g. "woonkamer"; see PURPOSES. */
  purpose: string;
  styleId: string;
  budget: number;
  budgetNote: string;
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
  /** IKEA site the products came from. */
  locale?: CatalogLocale;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface Settings {
  anthropicKey: string;
  geminiKey: string;
  /** Only used with the site proxy, when its owner set a code. */
  accessCode: string;
  geminiModel: string;
  lang: Lang;
  /** Preferred IKEA store; decides which IKEA site products come from. */
  storeId: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  photos: Photo[];
  room: Room;
  analysis: RoomAnalysis | null;
  prefs: Preferences;
  session: DesignSession | null;
  design: Design | null;
  chat: ChatTurn[];
  afterImage: string | null;
  /** Store chosen for the pick route. */
  storeId: string | null;
}

export const STYLE_IDS = ["scandinavisch", "japandi", "modern", "industrieel", "mid-century", "boho", "landelijk", "kleurrijk"] as const;

export const PURPOSES = ["woonkamer", "slaapkamer", "kinderkamer", "thuiskantoor", "eetkamer", "studio", "logeerkamer"] as const;

export const OPENING_KINDS: OpeningKind[] = ["deur", "raam", "radiator", "doorgang", "anders"];

export const styleLabel = (id: string) => (STYLE_IDS as readonly string[]).includes(id) ? t(`style.${id}` as Key) : id;
export const styleDescription = (id: string) => (STYLE_IDS as readonly string[]).includes(id) ? t(`style.${id}.desc` as Key) : "";
export const purposeLabel = (id: string) => (PURPOSES as readonly string[]).includes(id) ? t(`purpose.${id}` as Key) : id;
export const openingLabel = (kind: OpeningKind) => t(`kind.${kind}` as Key);
export const wallLabel = (id: WallId) => t("wall", { id });
