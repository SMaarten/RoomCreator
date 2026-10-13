// Downscale a photo in the browser before it goes anywhere. Phone photos are
// 4–12 MB; Claude reads ~1568 px on the long edge anyway, so anything larger
// only costs upload time and tokens.

const MAX_EDGE = 1568;

export async function resizeToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas niet beschikbaar in deze browser");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** "data:image/jpeg;base64,AAAA" → { mediaType, data } */
export function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Ongeldige afbeelding");
  return { mediaType: match[1], data: match[2] };
}
