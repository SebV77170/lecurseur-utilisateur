import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["icon.svg"],
            manifest: {
                name: "Le Curseur - Mon espace",
                short_name: "Le Curseur",
                description: "Espace client prive pour ressources, questionnaires et messagerie.",
                theme_color: "#9900ff",
                background_color: "#f8f4ec",
                display: "standalone",
                icons: [
                    {
                        src: "/icon.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "any"
                    }
                ]
            }
        })
    ],
    server: {
        port: 5180,
        strictPort: true,
        proxy: {
            "/api": {
                target: "http://localhost:4000",
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ""); }
            }
        }
    },
    test: {
        environment: "jsdom",
        setupFiles: "./src/test/setup.ts"
    }
});
