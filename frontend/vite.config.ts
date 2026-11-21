import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { zhPlugin } from "./vite-plugin-zh";

export default defineConfig({
  plugins: [zhPlugin(), react()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
