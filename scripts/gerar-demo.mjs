// Gera a demonstração publicável (arquivo HTML único, API simulada e dados fictícios).
// Uso: pnpm --filter @bybus/core build && VITE_DEMO=1 pnpm --filter @bybus/web exec vite build && node scripts/gerar-demo.mjs
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.join(raiz, "apps/web/dist-demo");
const assets = fs.readdirSync(path.join(dist, "assets"));
const css = fs.readFileSync(path.join(dist, "assets", assets.find((f) => f.endsWith(".css"))), "utf8");
const js = fs.readFileSync(path.join(dist, "assets", assets.find((f) => f.endsWith(".js"))), "utf8")
  .replaceAll("</script", "<\\/script")
  .replaceAll("�", "\\uFFFD");
const icone = fs.readFileSync(path.join(dist, "index.html"), "utf8").match(/<link rel="icon"[^>]+>/)[0];
const saida = path.resolve(process.argv[2] ?? path.join(dist, "bybus-gestao-demo.html"));
fs.writeFileSync(saida, `<title>Bybus Gestão</title>\n<meta name="robots" content="noindex, nofollow">\n${icone}\n<style>\n${css}\n</style>\n<div id="raiz"></div>\n<script type="module">\n${js}\n</script>\n`);
console.log(`Demonstração gerada em ${saida}`);
