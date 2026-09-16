import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      usePolling: process.env.GROCERY_GETTER_VITE_POLLING === "1",
      ignored: [
        "**/.git/**",
        "**/.cache/**",
        "**/data/**",
        "**/dist/**",
        "**/server-dist/**",
        "**/imports/**",
        "**/node_modules/**"
      ]
    },
    proxy: {
      "/api": process.env.GROCERY_GETTER_API_URL ?? "http://127.0.0.1:5174"
    }
  },
  preview: {
    proxy: {
      "/api": process.env.GROCERY_GETTER_API_URL ?? "http://127.0.0.1:5174"
    }
  }
});
