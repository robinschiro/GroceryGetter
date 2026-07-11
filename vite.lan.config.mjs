import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5174"
    }
  },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "react-dom",
      "react-dom/client",
      "lucide-react"
    ]
  }
});
