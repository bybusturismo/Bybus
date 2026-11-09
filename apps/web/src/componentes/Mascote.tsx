/**
 * Mascote "Turistinha": homem sorridente de chapéu panamá branco, camisa florida rosa e azul, bermuda azul e chinelos.
 *
 * ARTE PROVISÓRIA: enquanto não existir `apps/web/src/marca/turistinha.png`, o componente desenha o SVG simples abaixo.
 * Para trocar pela arte oficial, basta salvar o arquivo com esse nome (PNG com fundo transparente; a arte oficial de 09/11/2026 tem proporção ~7:8)
 * e reiniciar o servidor de desenvolvimento ou refazer o build. Nenhum código precisa mudar.
 */
const arquivos = import.meta.glob("../marca/turistinha.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const urlOficial = Object.values(arquivos)[0];

export const MASCOTE_PROVISORIO = !urlOficial;

export function Mascote({ tamanho = 64, titulo = "Turistinha, o assistente" }: { tamanho?: number; titulo?: string }) {
  if (urlOficial) {
    return <img className="mascote" src={urlOficial} alt={titulo} width={tamanho} height={Math.round(tamanho * 1.14)} />;
  }
  return (
    <svg className="mascote mascote--provisorio" role="img" aria-label={titulo} width={tamanho} height={Math.round(tamanho * 1.4)} viewBox="0 0 120 168" data-provisorio="true">
      {/* pernas e chinelos */}
      <rect x="42" y="132" width="13" height="20" rx="5" fill="#f2c29b" />
      <rect x="65" y="132" width="13" height="20" rx="5" fill="#f2c29b" />
      <ellipse cx="46" cy="157" rx="12" ry="4.5" fill="#f5a623" />
      <ellipse cx="74" cy="157" rx="12" ry="4.5" fill="#f5a623" />
      <path d="M46 153v4M74 153v4" stroke="#c77d0a" strokeWidth="2" strokeLinecap="round" />
      {/* bermuda azul */}
      <path d="M36 112h48l4 26H66l-6-12-6 12H32l4-26Z" fill="#2b6fcf" />
      {/* braços */}
      <path d="M36 78 20 102" stroke="#f06fa5" strokeWidth="13" strokeLinecap="round" />
      <path d="M84 78l16 24" stroke="#f06fa5" strokeWidth="13" strokeLinecap="round" />
      <circle cx="19" cy="106" r="6.5" fill="#f2c29b" />
      <circle cx="101" cy="106" r="6.5" fill="#f2c29b" />
      {/* camisa florida rosa com flores azuis */}
      <path d="M34 76q26-8 52 0l2 38H32l2-38Z" fill="#f06fa5" />
      <g fill="#2b7bd6">
        <circle cx="45" cy="88" r="4" />
        <circle cx="70" cy="84" r="4" />
        <circle cx="58" cy="102" r="4" />
        <circle cx="78" cy="102" r="3.4" />
        <circle cx="41" cy="106" r="3.4" />
      </g>
      <g fill="#ffffff">
        <circle cx="45" cy="88" r="1.5" />
        <circle cx="70" cy="84" r="1.5" />
        <circle cx="58" cy="102" r="1.5" />
        <circle cx="78" cy="102" r="1.3" />
        <circle cx="41" cy="106" r="1.3" />
      </g>
      {/* pescoço e cabeça */}
      <rect x="53" y="66" width="14" height="12" rx="5" fill="#f2c29b" />
      <circle cx="60" cy="54" r="19" fill="#f2c29b" />
      <circle cx="53" cy="53" r="2" fill="#3a2a20" />
      <circle cx="67" cy="53" r="2" fill="#3a2a20" />
      <path d="M50 61q10 11 20 0" fill="#ffffff" stroke="#3a2a20" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="46" cy="60" r="3" fill="#f4a0a0" opacity=".55" />
      <circle cx="74" cy="60" r="3" fill="#f4a0a0" opacity=".55" />
      {/* chapéu panamá branco */}
      <ellipse cx="60" cy="40" rx="37" ry="8.5" fill="#fbfaf5" stroke="#cfc9b6" strokeWidth="1.5" />
      <path d="M41 40v-8a19 19 0 0 1 38 0v8q-19 6-38 0Z" fill="#fbfaf5" stroke="#cfc9b6" strokeWidth="1.5" />
      <path d="M41 36q19 6 38 0v4q-19 6-38 0v-4Z" fill="#1f4e8c" />
    </svg>
  );
}
