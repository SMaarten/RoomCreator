// Shared domain types for RoomCreator.

export interface StyleOption {
  id: string;
  label: string;
  description: string;
}

/** A single IKEA product as normalized from the parse.bot API (or mock data). */
export interface IkeaProduct {
  id: string;
  name: string;
  /** Short type/category label, e.g. "Sofa", "Floor lamp". */
  type: string;
  price: number;
  currency: string;
  imageUrl: string;
  productUrl: string;
}

/** One thing Claude recommends adding to the room. */
export interface Recommendation {
  /** Furniture category, e.g. "Sofa", "Rug", "Floor lamp". */
  category: string;
  /** The search term to send to the IKEA API. */
  searchQuery: string;
  /** Why this fits the room and the chosen style. */
  rationale: string;
}

/** Claude's structured read of the uploaded room photo. */
export interface RoomAnalysis {
  roomType: string;
  /** One or two sentences describing the room as-is. */
  description: string;
  /** Dominant colors in the room, as readable names or hex. */
  palette: string[];
  /** Notable furniture/objects already present. */
  existingItems: string[];
  recommendations: Recommendation[];
}

/** A recommendation joined with the IKEA products that match it. */
export interface DesignItem extends Recommendation {
  products: IkeaProduct[];
}

/** The full result returned to the client. */
export interface DesignResult {
  analysis: RoomAnalysis;
  items: DesignItem[];
  /** Sum of the cheapest matched product per recommendation. */
  totalEstimate: number;
  currency: string;
  /** True when IKEA products came from mock data (no parse.bot key configured). */
  usingMockData: boolean;
}

export const STYLE_OPTIONS: StyleOption[] = [
  {
    id: "scandinavian",
    label: "Scandinavian",
    description: "Light woods, soft neutrals, clean lines, cozy minimalism.",
  },
  {
    id: "minimalist",
    label: "Minimalist",
    description: "Monochrome palette, uncluttered, function-first.",
  },
  {
    id: "japandi",
    label: "Japandi",
    description: "Japanese warmth meets Nordic calm; natural materials.",
  },
  {
    id: "mid-century",
    label: "Mid-century modern",
    description: "Warm woods, tapered legs, retro accents, bold shapes.",
  },
  {
    id: "industrial",
    label: "Industrial",
    description: "Metal, dark tones, raw textures, utilitarian forms.",
  },
  {
    id: "bohemian",
    label: "Bohemian",
    description: "Layered textiles, plants, warm earthy colors, eclectic mix.",
  },
];
