import { useId, type ReactNode } from "react";

/**
 * Gráficos em SVG feito à mão (sem pacote de gráficos). Acessíveis: cada um tem título e descrição
 * (role="img") e uma tabela equivalente dentro de "Ver como tabela". Cores só por tokens (visao-geral.css).
 */

export interface Serie {
  chave: string;
  rotulo: string;
  /** Classe de cor (fill/stroke/background) — ex.: "vg-c--SITE". */
  classe: string;
}

export function Legenda({ series }: { series: Serie[] }) {
  return (
    <ul className="vg-legenda" aria-label="Legenda">
      {series.map((s) => (
        <li key={s.chave}>
          <span className={`vg-legenda__marca ${s.classe}`} aria-hidden="true" />
          {s.rotulo}
        </li>
      ))}
    </ul>
  );
}

/** Tabela equivalente ao gráfico, recolhida por padrão. */
export function TabelaAlternativa({ id, cabecalho, linhas }: { id: string; cabecalho: string[]; linhas: ReactNode[][] }) {
  return (
    <details className="vg-tabela" id={id}>
      <summary>Ver como tabela</summary>
      <div className="tabela-rolagem">
        <table className="tabela tabela--compacta">
          <thead>
            <tr>{cabecalho.map((c, i) => <th key={c} className={i > 0 ? "num" : undefined}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>{l.map((c, j) => <td key={j} className={j > 0 ? "num" : undefined}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Teto "redondo" do eixo (1, 2, 5 × 10^n) para o maior valor. */
export function tetoDoEixo(maximo: number): number {
  if (maximo <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(maximo)));
  const f = maximo / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

const L = 640; // largura do viewBox
const A = 190; // altura do viewBox
const M = { e: 44, d: 8, t: 10, b: 24 };

export interface CategoriaBarra {
  chave: string;
  rotulo: string;
  /** Rótulo longo (tooltip e tabela). */
  rotuloLongo?: string;
  valores: Record<string, number>;
}

/** Barras verticais empilhadas por série (canal). */
export function BarrasEmpilhadas({ titulo, descricao, categorias, series, formato, rotuloTotal = "Total" }: {
  titulo: string; descricao: string; categorias: CategoriaBarra[]; series: Serie[]; formato: (n: number) => string; rotuloTotal?: string;
}) {
  const id = useId();
  const totais = categorias.map((c) => series.reduce((t, s) => t + (c.valores[s.chave] ?? 0), 0));
  const teto = tetoDoEixo(Math.max(0, ...totais));
  const largUtil = L - M.e - M.d;
  const passo = largUtil / Math.max(1, categorias.length);
  const larg = Math.max(2, Math.min(44, passo * 0.7));
  const altUtil = A - M.t - M.b;
  const y = (v: number) => M.t + altUtil - (v / teto) * altUtil;
  // Com muitas barras, mostra só alguns rótulos do eixo X.
  const cada = Math.max(1, Math.ceil(categorias.length / 10));
  return (
    <figure className="vg-figura">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="vg-svg" preserveAspectRatio="xMidYMid meet">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descricao}</desc>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.e} x2={L - M.d} y1={y(teto * f)} y2={y(teto * f)} className="vg-grade-linha" />
            <text x={M.e - 4} y={y(teto * f) + 3} textAnchor="end" className="vg-eixo">{formato(teto * f)}</text>
          </g>
        ))}
        {categorias.map((c, i) => {
          const x = M.e + passo * i + (passo - larg) / 2;
          let base = 0;
          return (
            <g key={c.chave}>
              <title>{`${c.rotuloLongo ?? c.rotulo}: ${formato(totais[i]!)}`}</title>
              {series.map((s) => {
                const v = c.valores[s.chave] ?? 0;
                if (v <= 0) return null;
                const topo = y(base + v);
                const alt = y(base) - topo;
                base += v;
                return <rect key={s.chave} x={x} y={topo} width={larg} height={Math.max(0.5, alt)} className={s.classe} />;
              })}
              {i % cada === 0 && <text x={x + larg / 2} y={A - 8} textAnchor="middle" className="vg-eixo">{c.rotulo}</text>}
            </g>
          );
        })}
      </svg>
      <Legenda series={series.filter((s) => categorias.some((c) => (c.valores[s.chave] ?? 0) > 0))} />
      <TabelaAlternativa
        id={`${id}-tab`}
        cabecalho={["Categoria", ...series.map((s) => s.rotulo), rotuloTotal]}
        linhas={categorias.map((c, i) => [c.rotuloLongo ?? c.rotulo, ...series.map((s) => formato(c.valores[s.chave] ?? 0)), formato(totais[i]!)])}
      />
    </figure>
  );
}

/** Linhas (poucas séries, poucas categorias) com marcadores e valores nos pontos. */
export function Linhas({ titulo, descricao, categorias, series, formato }: {
  titulo: string; descricao: string; categorias: string[]; series: Array<Serie & { valores: number[] }>; formato: (n: number) => string;
}) {
  const id = useId();
  const teto = tetoDoEixo(Math.max(0, ...series.flatMap((s) => s.valores)));
  const largUtil = L - M.e - M.d;
  const passo = largUtil / Math.max(1, categorias.length);
  const altUtil = A - M.t - M.b;
  const x = (i: number) => M.e + passo * i + passo / 2;
  const y = (v: number) => M.t + altUtil - (v / teto) * altUtil;
  return (
    <figure className="vg-figura">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="vg-svg" preserveAspectRatio="xMidYMid meet">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descricao}</desc>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.e} x2={L - M.d} y1={y(teto * f)} y2={y(teto * f)} className="vg-grade-linha" />
            <text x={M.e - 4} y={y(teto * f) + 3} textAnchor="end" className="vg-eixo">{formato(teto * f)}</text>
          </g>
        ))}
        {categorias.map((c, i) => <text key={c} x={x(i)} y={A - 8} textAnchor="middle" className="vg-eixo">{c}</text>)}
        {series.map((s) => (
          <g key={s.chave} className={`vg-linha ${s.classe}`}>
            <polyline points={s.valores.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" className="vg-linha__traco" />
            {s.valores.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3.5} className="vg-linha__ponto">
                <title>{`${s.rotulo}, ${categorias[i]}: ${formato(v)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <Legenda series={series} />
      <TabelaAlternativa id={`${id}-tab`} cabecalho={["Faixa", ...series.map((s) => s.rotulo)]} linhas={categorias.map((c, i) => [c, ...series.map((s) => formato(s.valores[i]!))])} />
    </figure>
  );
}

export interface Fatia {
  chave: string;
  rotulo: string;
  valor: number;
  /** Texto do valor na legenda/tabela. */
  texto: string;
}

/** Pizza (anel) com legenda numerada na mesma ordem do ranking. */
export function Pizza({ titulo, descricao, fatias }: { titulo: string; descricao: string; fatias: Fatia[] }) {
  const id = useId();
  const total = fatias.reduce((t, f) => t + f.valor, 0);
  const R = 52;
  const r = 30;
  let ang = -Math.PI / 2;
  const ponto = (a: number, raio: number) => `${60 + Math.cos(a) * raio},${60 + Math.sin(a) * raio}`;
  return (
    <figure className="vg-figura vg-figura--pizza">
      <svg viewBox="0 0 120 120" role="img" aria-labelledby={`${id}-t ${id}-d`} className="vg-svg vg-svg--pizza">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descricao}</desc>
        {total <= 0 && <circle cx={60} cy={60} r={(R + r) / 2} fill="none" strokeWidth={R - r} className="vg-pizza__vazia" />}
        {fatias.map((f, i) => {
          if (f.valor <= 0 || total <= 0) return null;
          const a0 = ang;
          const a1 = ang + (f.valor / total) * Math.PI * 2;
          ang = a1;
          const completa = f.valor >= total;
          const grande = a1 - a0 > Math.PI ? 1 : 0;
          const d = completa
            ? `M60,${60 - R} A${R},${R} 0 1 1 59.99,${60 - R} L59.99,${60 - r} A${r},${r} 0 1 0 60,${60 - r} Z`
            : `M${ponto(a0, R)} A${R},${R} 0 ${grande} 1 ${ponto(a1, R)} L${ponto(a1, r)} A${r},${r} 0 ${grande} 0 ${ponto(a0, r)} Z`;
          return (
            <path key={f.chave} d={d} className={`vg-cat--${(i % 8) + 1}`} fillRule="evenodd">
              <title>{`${f.rotulo}: ${f.texto}`}</title>
            </path>
          );
        })}
      </svg>
      <ol className="vg-legenda vg-legenda--lista">
        {fatias.map((f, i) => (
          <li key={f.chave}>
            <span className={`vg-legenda__marca vg-cat--${(i % 8) + 1}`} aria-hidden="true" />
            <span className="vg-legenda__rotulo">{f.rotulo}</span>
            <span className="vg-legenda__valor">{f.texto}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Barras verticais simples (uma série), para o comparativo de anos. */
export function BarrasSimples({ titulo, descricao, itens, formato }: { titulo: string; descricao: string; itens: Array<{ chave: string; rotulo: string; valor: number; destaque?: boolean }>; formato: (n: number) => string }) {
  const id = useId();
  const teto = tetoDoEixo(Math.max(0, ...itens.map((i) => i.valor)));
  const passo = (L - M.e - M.d) / Math.max(1, itens.length);
  const larg = Math.min(90, passo * 0.5);
  const altUtil = A - M.t - M.b - 12;
  const y = (v: number) => M.t + 12 + altUtil - (v / teto) * altUtil;
  return (
    <figure className="vg-figura">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="vg-svg" preserveAspectRatio="xMidYMid meet">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descricao}</desc>
        <line x1={M.e} x2={L - M.d} y1={y(0)} y2={y(0)} className="vg-grade-linha" />
        {itens.map((it, i) => {
          const x = M.e + passo * i + (passo - larg) / 2;
          return (
            <g key={it.chave}>
              <title>{`${it.rotulo}: ${formato(it.valor)}`}</title>
              <rect x={x} y={y(it.valor)} width={larg} height={Math.max(0.5, y(0) - y(it.valor))} className={it.destaque ? "vg-c--SITE" : "vg-c--SEM_CANAL"} />
              <text x={x + larg / 2} y={y(it.valor) - 4} textAnchor="middle" className="vg-eixo vg-eixo--forte">{formato(it.valor)}</text>
              <text x={x + larg / 2} y={A - 8} textAnchor="middle" className="vg-eixo">{it.rotulo}</text>
            </g>
          );
        })}
      </svg>
      <TabelaAlternativa id={`${id}-tab`} cabecalho={["Ano", "Valor"]} linhas={itens.map((i) => [i.rotulo, formato(i.valor)])} />
    </figure>
  );
}
