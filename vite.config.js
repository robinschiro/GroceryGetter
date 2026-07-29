import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
