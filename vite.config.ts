/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: [
        "src/domain/**/*.ts",
        "src/application/**/*.ts",
        "src/adapters/sip/sip-uri.ts",
        "src/adapters/sip/ice-config.ts",
        "src/shared/**/*.ts",
      ],
    },
  },
});
