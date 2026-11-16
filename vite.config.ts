import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the API runs on 4173 (tsx watch) and Vite on 5173. The session token
// is shared through AIDLC_UI_DEV_TOKEN and injected into the dev page.
export default defineConfig(({ command }) => ({
  root: "web",
  base: "./",
  plugins: [
    react(),
    {
      name: "aidlc-ui-dev-token",
      transformIndexHtml(html: string) {
        if (command !== "serve") return html;
        const token = process.env.AIDLC_UI_DEV_TOKEN ?? "";
        return html.replace("<!--AIDLC_UI_TOKEN-->", `<meta name="aidlc-ui-token" content="${token}">`);
      },
    },
  ],
  build: { outDir: "../dist/web", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:4173", changeOrigin: false } } },
}));
