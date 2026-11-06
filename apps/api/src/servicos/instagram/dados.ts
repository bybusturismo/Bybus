import { dataSaoPaulo } from "@bybus/core";
import { sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { igMetricasDia, igPosts } from "../../db/schema.js";
import { instagramReal, lerInsightsConta, lerInsightsMidia, lerPerfil, listarMidias, type MidiaInstagram } from "./cliente.js";

/**
 * Leitura dos dados da conta para o Marketing (rotina diária + botão "Atualizar agora").
 * Só em modo real (token + produção ou INSTAGRAM_ENVIO_REAL): em modo simulado não chama a Meta e não inventa número.
 * Idempotente: tudo é "upsert" (por dia e por id do post); rodar duas vezes só atualiza.
 */

export interface ResultadoSincronizacao { executou: boolean; motivo?: "SIMULADO"; dias: number; posts: number; falhas: string[] }

const TIPO_POST = (m: MidiaInstagram): string => {
  if (m.media_product_type === "REELS") return "REELS";
  if (m.media_product_type === "STORY") return "STORY";
  if (m.media_type === "CAROUSEL_ALBUM") return "CARROSSEL";
  return m.media_type === "VIDEO" ? "VIDEO" : "IMAGEM";
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const diaMais = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** São Paulo não tem horário de verão desde 2019: o dia civil começa às 03:00 UTC. */
const inicioDoDia = (dia: string) => Math.floor(Date.parse(`${dia}T00:00:00-03:00`) / 1000);

function valorMetrica(dados: Array<{ name?: string; total_value?: { value?: number }; values?: Array<{ value?: number }> }> | undefined, nome: string): number | null {
  const m = dados?.find((x) => x.name === nome);
  return num(m?.total_value?.value ?? m?.values?.[0]?.value);
}

export async function sincronizarInstagram(db: Db, config: Config, opcoes: { agora?: Date; buscar?: typeof fetch; diasPostsComMetricas?: number } = {}): Promise<ResultadoSincronizacao> {
  const agora = opcoes.agora ?? new Date();
  if (!instagramReal(config)) return { executou: false, motivo: "SIMULADO", dias: 0, posts: 0, falhas: [] };
  const falhas: string[] = [];
  const hoje = dataSaoPaulo(agora);
  const perfil = await lerPerfil(config, opcoes.buscar);
  if (!perfil.ok) falhas.push(`perfil:${perfil.codigo}`);
  const seguidores = num(perfil.dados?.followers_count);

  // Ontem (dia fechado) e hoje (parcial): os dois são regravados a cada rodada.
  let dias = 0;
  for (const dia of [diaMais(hoje, -1), hoje]) {
    const r = await lerInsightsConta(config, inicioDoDia(dia), inicioDoDia(diaMais(dia, 1)), opcoes.buscar);
    if (!r.ok) falhas.push(`insights:${r.codigo}`);
    const m = r.dados?.data;
    const valores = {
      alcance: valorMetrica(m, "reach"), visualizacoes: valorMetrica(m, "views"), visitasPerfil: valorMetrica(m, "profile_views"), cliquesSite: valorMetrica(m, "website_clicks"),
      ...(dia === hoje && seguidores !== null ? { seguidores } : {}),
    };
    if (!r.ok && !(dia === hoje && seguidores !== null)) continue;
    await db.insert(igMetricasDia).values({ data: dia, ...valores }).onConflictDoUpdate({
      target: igMetricasDia.data,
      // Um valor que a Meta não devolveu agora não apaga o que já estava guardado.
      set: {
        alcance: sql`coalesce(excluded.alcance, ${igMetricasDia.alcance})`, visualizacoes: sql`coalesce(excluded.visualizacoes, ${igMetricasDia.visualizacoes})`,
        visitasPerfil: sql`coalesce(excluded.visitas_perfil, ${igMetricasDia.visitasPerfil})`, cliquesSite: sql`coalesce(excluded.cliques_site, ${igMetricasDia.cliquesSite})`,
        seguidores: sql`coalesce(excluded.seguidores, ${igMetricasDia.seguidores})`, atualizadoEm: new Date(),
      },
    });
    dias++;
  }

  const lista = await listarMidias(config, 50, opcoes.buscar);
  if (!lista.ok) falhas.push(`midias:${lista.codigo}`);
  const limiteMetricas = agora.getTime() - (opcoes.diasPostsComMetricas ?? 90) * 86_400_000;
  let posts = 0;
  for (const m of lista.dados?.data ?? []) {
    if (!m.id) continue;
    const publicadoEm = m.timestamp ? new Date(m.timestamp) : null;
    let ins = { alcance: null as number | null, salvamentos: null as number | null, compartilhamentos: null as number | null, visualizacoes: null as number | null };
    if (!publicadoEm || publicadoEm.getTime() >= limiteMetricas) {
      const r = await lerInsightsMidia(config, m.id, opcoes.buscar);
      if (r.ok) ins = { alcance: valorMetrica(r.dados?.data, "reach"), salvamentos: valorMetrica(r.dados?.data, "saved"), compartilhamentos: valorMetrica(r.dados?.data, "shares"), visualizacoes: valorMetrica(r.dados?.data, "views") };
    }
    const base = {
      idExterno: m.id, tipo: TIPO_POST(m), legenda: m.caption?.slice(0, 2200) ?? null, link: m.permalink ?? null,
      publicadoEm: publicadoEm && !Number.isNaN(publicadoEm.getTime()) ? publicadoEm : null, curtidas: num(m.like_count), comentarios: num(m.comments_count),
    };
    await db.insert(igPosts).values({ ...base, ...ins }).onConflictDoUpdate({
      target: igPosts.idExterno,
      set: {
        ...base, atualizadoEm: new Date(),
        alcance: sql`coalesce(excluded.alcance, ${igPosts.alcance})`, salvamentos: sql`coalesce(excluded.salvamentos, ${igPosts.salvamentos})`,
        compartilhamentos: sql`coalesce(excluded.compartilhamentos, ${igPosts.compartilhamentos})`, visualizacoes: sql`coalesce(excluded.visualizacoes, ${igPosts.visualizacoes})`,
      },
    });
    posts++;
  }
  return { executou: true, dias, posts, falhas };
}
