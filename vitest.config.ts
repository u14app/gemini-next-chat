import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    execArgv: ["--no-experimental-webstorage"],
    exclude: [...configDefaults.exclude, "e2e/**", "docker/mcp-bridge/test/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
