import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error: a plain JavaScript module from the build tools.
import { loadBrand } from "./tools/brand.mjs";

/**
 * The brand the window is built for (HUB_BRAND, or the brand tauri.conf.json was last set up for), handed to the page as two modules:
 *   virtual:brand       its brand.json and the address of its icon (what src/main.ts shows)
 *   virtual:brand-apps  its list of apps with their icons as pictures (only for tests/ui-preview.html; the program never imports it)
 */
function brandModules(): Plugin {
  const { brand, apps, dir } = loadBrand();
  const at = (name: string) => JSON.stringify(join(dir, name).replaceAll("\\", "/"));
  const picture = (name: string) => {
    const kind = name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
    return `data:${kind};base64,${readFileSync(join(dir, name)).toString("base64")}`;
  };
  const modules: Record<string, string> = {
    "virtual:brand": `export { default as brand } from ${at("brand.json")};\nexport { default as markUrl } from ${JSON.stringify(JSON.parse(at(brand.icon)) + "?url")};\n`,
    "virtual:brand-apps": `export const apps = ${JSON.stringify({
      ...apps,
      apps: apps.apps.map((a: { mark: { icon?: string } }) => ({ ...a, mark: { ...a.mark, icon: a.mark.icon ? picture(a.mark.icon) : undefined } })),
    })};\n`,
  };
  return {
    name: "hub-brand",
    resolveId: (id) => (id in modules ? `\0${id}` : null),
    load: (id) => (id.startsWith("\0") && id.slice(1) in modules ? modules[id.slice(1)] : null),
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [brandModules()],
  server: {
    port: 1430,
    strictPort: true,
    // Rust's build folder is locked while compiling, so Vite must not watch it.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
