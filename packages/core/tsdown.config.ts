import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  target: "node20",
  format: "esm",
  dts: true,
});
