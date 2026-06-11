import Anthropic from "@anthropic-ai/sdk";
import type { RoomAnalysis, StyleOption } from "./types";

/**
 * Analyze a room photo with Claude vision and return a structured set of
 * IKEA furnishing recommendations tailored to the user's chosen style.
 */

const MODEL = "claude-opus-4-8";

export type SupportedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

// JSON schema constraining Claude's response (structured outputs).
const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    roomType: { type: "string" },
    description: { type: "string" },
    palette: { type: "array", items: { type: "string" } },
    existingItems: { type: "array", items: { type: "string" } },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          searchQuery: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["category", "searchQuery", "rationale"],
      },
    },
  },
  required: ["roomType", "description", "palette", "existingItems", "recommendations"],
} as const;

export async function analyzeRoom(
  imageBase64: string,
  mediaType: SupportedMediaType,
  style: StyleOption,
): Promise<RoomAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });

  const system = [
    "You are an interior designer who furnishes rooms exclusively with IKEA products.",
    "You are given a photo of a real room and a target decorating style.",
    "Analyze the room as it currently is, then recommend 5–8 IKEA items that would",
    "transform it toward the target style while complementing what's already there.",
    "",
    "For each recommendation:",
    "- `category` is the furniture type (e.g. 'Sofa', 'Floor lamp', 'Rug').",
    "- `searchQuery` is a short, generic product search term to look up in an IKEA",
    "  catalog (e.g. 'floor lamp', 'wool rug', '3-seat sofa'). Keep it generic — do",
    "  NOT invent specific IKEA product names; the search runs against a live catalog.",
    "- `rationale` is one sentence on why it fits this room and the chosen style.",
    "",
    "Prioritize pieces that address gaps in the room (missing seating, lighting,",
    "storage, textiles, greenery) rather than duplicating what's already present.",
  ].join("\n");

  const userText = [
    `Target style: ${style.label} — ${style.description}`,
    "",
    "Analyze the attached room photo and produce your recommendations.",
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: userText },
        ],
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content returned from Claude");
  }

  const parsed = JSON.parse(textBlock.text) as RoomAnalysis;
  return parsed;
}
