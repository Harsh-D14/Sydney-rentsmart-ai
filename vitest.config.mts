import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" path in tsconfig.json
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests never talk to real services: no keys, chat off.
    env: {
      OPENROUTE_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      TFNSW_API_KEY: "",
      GOOGLE_MAPS_API_KEY: "",
      CHAT_ENABLED: "",
    },
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
