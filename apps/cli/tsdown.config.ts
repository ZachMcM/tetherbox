import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  platform: "node",
  target: "node20",
  format: "esm",
});
