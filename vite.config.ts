import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://smaarten.github.io/RoomCreator/ on GitHub Pages.
export default defineConfig({
  base: "/RoomCreator/",
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two pages: the app and the usage/cost overview (admin.html).
      input: {
        main: "index.html",
        admin: "admin.html",
      },
    },
  },
});
