import { defineConfig } from "wxt";
import { JOB_SITES } from "./lib/sites";

// quikResume browser extension (Chrome MV3). The app origin comes from WXT_APP_URL at build time:
//   dev:   WXT_APP_URL=http://localhost:3000 npm run dev
//   prod:  npm run build (defaults to https://quikresume.vercel.app)
const APP_URL = (process.env.WXT_APP_URL ?? "https://quikresume.vercel.app").replace(/\/$/, "");
const appMatch = `${new URL(APP_URL).origin}/*`;

export default defineConfig({
    modules: ["@wxt-dev/module-react"],
    vite: () => ({ define: { __APP_URL__: JSON.stringify(APP_URL) } }),
    manifest: {
        name: "quikResume",
        description: "Save jobs in one click, see your résumé match on any posting, and fill applications.",
        permissions: ["storage", "sidePanel", "activeTab", "scripting"],
        host_permissions: [appMatch, ...JOB_SITES],
        action: { default_title: "quikResume" },
        side_panel: { default_path: "sidepanel.html" },
        icons: { 16: "icon/icon-16.png", 32: "icon/icon-32.png", 48: "icon/icon-48.png", 128: "icon/icon-128.png" },
    },
});
