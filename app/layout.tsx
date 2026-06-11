import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoomCreator — IKEA interior design from a photo",
  description:
    "Snap a photo of your room, pick a style, and get IKEA furnishing ideas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
