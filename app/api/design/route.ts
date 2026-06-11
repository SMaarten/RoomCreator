import { NextRequest, NextResponse } from "next/server";
import { analyzeRoom, type SupportedMediaType } from "@/lib/anthropic";
import { searchIkea, isUsingMockData } from "@/lib/ikea";
import { STYLE_OPTIONS, type DesignItem, type DesignResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPPORTED: SupportedMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const image = form.get("image");
    const styleId = form.get("style");

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "No image uploaded." }, { status: 400 });
    }
    if (image.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image is too large (max 8 MB)." },
        { status: 413 },
      );
    }
    if (!SUPPORTED.includes(image.type as SupportedMediaType)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${image.type || "unknown"}.` },
        { status: 415 },
      );
    }

    const style = STYLE_OPTIONS.find((s) => s.id === styleId);
    if (!style) {
      return NextResponse.json({ error: "Unknown style selected." }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Server is missing ANTHROPIC_API_KEY. See .env.example." },
        { status: 500 },
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const base64 = buffer.toString("base64");

    // 1. Claude reads the room and proposes furnishings.
    const analysis = await analyzeRoom(
      base64,
      image.type as SupportedMediaType,
      style,
    );

    // 2. Look up matching IKEA products for each recommendation in parallel.
    const items: DesignItem[] = await Promise.all(
      analysis.recommendations.map(async (rec) => ({
        ...rec,
        products: await searchIkea(rec.searchQuery),
      })),
    );

    // 3. Estimate the build cost as the cheapest matched product per item.
    let totalEstimate = 0;
    let currency = "EUR";
    for (const item of items) {
      if (item.products.length === 0) continue;
      const cheapest = item.products.reduce((a, b) => (a.price <= b.price ? a : b));
      totalEstimate += cheapest.price;
      currency = cheapest.currency || currency;
    }

    const result: DesignResult = {
      analysis,
      items,
      totalEstimate: Math.round(totalEstimate),
      currency,
      usingMockData: isUsingMockData(),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("design route error:", err);
    const message =
      err instanceof Error ? err.message : "Unexpected error generating design.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
