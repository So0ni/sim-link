import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export function pwaBuild() {
  let root, outDir;
  const enabled = process.env.VITE_SIMLINK_DEMO !== "1";
  return {
    name: "simlink-public-shell",
    apply: "build",
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    transformIndexHtml() {
      if (!enabled) return;
      return [
        { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "icon", type: "image/svg+xml", href: "/icons/icon.svg" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: "SIMLink" }, injectTo: "head" },
      ];
    },
    writeBundle(_options, bundle) {
      if (!enabled) return;
      const paths = ["/index.html", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
        ...Object.keys(bundle).filter(name => name.startsWith("assets/") && /\.(js|css)$/.test(name)).map(name => `/${name}`)].sort();
      const template = readFileSync(resolve(root, "src/pwa/sw.js"), "utf8");
      const hash = createHash("sha256").update(template);
      for (const path of paths) hash.update(path).update(readFileSync(resolve(outDir, path.slice(1))));
      writeFileSync(resolve(outDir, "sw.js"), template.replace("__BUILD_ID__", hash.digest("hex").slice(0, 16)).replace("__PRECACHE__", JSON.stringify(paths)));
    },
  };
}
