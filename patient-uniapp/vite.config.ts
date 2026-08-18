import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { fileURLToPath, URL } from "node:url";
import { sanitizeMpWxssPlugin } from "./scripts/sanitize-mp-wxss-plugin.mjs";

export default defineConfig({
  plugins: [sanitizeMpWxssPlugin(), uni()],
  resolve: {
    alias: {
      "@chunyu/patient-design": fileURLToPath(
        new URL("../packages/patient-design", import.meta.url)
      ),
    },
  },
});
