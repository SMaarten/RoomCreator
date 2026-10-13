import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://smaarten.github.io/RoomCreator/ on GitHub Pages.
export default defineConfig({
  base: "/RoomCreator/",
  plugins: [react()],
});
