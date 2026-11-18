import { ROTULO_ANEXO_FIN, TIPOS_ANEXO_FIN, type TipoAnexoFin } from "@bybus/core";
import { useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { lerBase64 } from "../../util/foto";
import type { AnexoFin } from "./tipos";

/** Boleto, nota fiscal e comprovante da conta (pedido do dono, 18/11/2026). Arquivo de até 15 MB. */
export const ANEXO_MAX_BYTES = 15 * 1024 * 1024;
const ACEITOS = ".pdf,.jpg,.jpeg,.png,.xml,.doc,.docx,.xls,.xlsx";
const rotulo = (t: string) => ROTULO_ANEXO_FIN[t as TipoAnexoFin] ?? t;
const url = (id: string, baixar = false) => `/api/financeiro/anexos/${id}${baixar ? "?baixar=1" : ""}`;

export async function enviarAnexo(lancamentoId: string, tipo: TipoAnexoFin, arquivo: File): Promise<AnexoFin> {
  if (arquivo.size > ANEXO_MAX_BYTES) throw new Error("O arquivo pode ter até 15 MB.");
  return api.post<AnexoFin>(`/api/financeiro/lancamentos/${lancamentoId}/anexos`, { tipo, nome: arquivo.name, base64: await lerBase64(arquivo) });
}

/** Links "abrir" e "baixar" de cada anexo (lista e janela de pagamento). */
export function LinksAnexos({ anexos, compacto = false }: { anexos: AnexoFin[]; compacto?: boolean }) {
  if (!anexos.length) return null;
  return (
    <ul className={compacto ? "fin-anexos fin-anexos--compacto" : "fin-anexos"}>
      {anexos.map((a) => (
        <li key={a.id}>
          <a href={url(a.id)} target="_blank" rel="noopener noreferrer" title={a.nomeArquivo}>{rotulo(a.tipo)}{compacto ? "" : ` — ${a.nomeArquivo}`}</a>{" "}
          <a className="botao botao--link botao--pequeno" href={url(a.id, true)} download={a.nomeArquivo} aria-label={`Baixar ${rotulo(a.tipo)} ${a.nomeArquivo}`}>baixar</a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Campo "Boleto e documentos". Com `lancamentoId`, anexa e exclui na hora. Sem ele (conta nova), só guarda o arquivo escolhido:
 * quem chama envia depois de lançar (`aoEscolher`).
 */
export function CampoAnexos({ lancamentoId, anexos, aoMudar, aoEscolher, podeEditar = true, tipoInicial = "BOLETO" }: {
  lancamentoId: string | null;
  anexos: AnexoFin[];
  aoMudar?: (anexos: AnexoFin[]) => void;
  aoEscolher?: (escolha: { tipo: TipoAnexoFin; arquivo: File } | null) => void;
  podeEditar?: boolean;
  tipoInicial?: TipoAnexoFin;
}) {
  const [tipo, setTipo] = useState<TipoAnexoFin>(tipoInicial);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(arquivo: File | undefined) {
    setErro(null);
    if (!arquivo) return;
    if (arquivo.size > ANEXO_MAX_BYTES) return setErro("O arquivo pode ter até 15 MB.");
    if (!lancamentoId) {
      setEscolhido(arquivo);
      aoEscolher?.({ tipo, arquivo });
      return;
    }
    setEnviando(true);
    try {
      const a = await enviarAnexo(lancamentoId, tipo, arquivo);
      aoMudar?.([...anexos, a]);
    } catch (x) {
      setErro(x instanceof Error && !("codigo" in x) ? x.message : mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }
  async function excluir(a: AnexoFin) {
    if (!window.confirm(`Excluir o anexo "${a.nomeArquivo}"?`)) return;
    setErro(null);
    try {
      await api.delete(url(a.id));
      aoMudar?.(anexos.filter((x) => x.id !== a.id));
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <div className="campo campo--largo">
      <span className="campo__rotulo" id="fin-anexos-rotulo">Boleto e documentos</span>
      {anexos.length > 0 && (
        <ul className="fin-anexos" aria-labelledby="fin-anexos-rotulo">
          {anexos.map((a) => (
            <li key={a.id}>
              <a href={url(a.id)} target="_blank" rel="noopener noreferrer">{rotulo(a.tipo)} — {a.nomeArquivo}</a>{" "}
              <a className="botao botao--link botao--pequeno" href={url(a.id, true)} download={a.nomeArquivo} aria-label={`Baixar ${a.nomeArquivo}`}>baixar</a>
              {podeEditar && <> <button type="button" className="botao botao--link botao--pequeno" onClick={() => void excluir(a)} aria-label={`Excluir o anexo ${a.nomeArquivo}`}>excluir</button></>}
            </li>
          ))}
        </ul>
      )}
      {escolhido && !lancamentoId && (
        <p className="texto-fraco">
          {rotulo(tipo)}: {escolhido.name} (vai anexado ao lançar){" "}
          <button type="button" className="botao botao--link botao--pequeno" onClick={() => { setEscolhido(null); aoEscolher?.(null); }}>remover</button>
        </p>
      )}
      {podeEditar && (
        <div className="fin-anexos__novo">
          <label className="fin-oculto-visual" htmlFor="fin-anexo-tipo">Tipo do documento</label>
          <select id="fin-anexo-tipo" value={tipo} onChange={(e) => { const t = e.target.value as TipoAnexoFin; setTipo(t); if (escolhido) aoEscolher?.({ tipo: t, arquivo: escolhido }); }}>
            {TIPOS_ANEXO_FIN.map((t) => <option key={t} value={t}>{ROTULO_ANEXO_FIN[t]}</option>)}
          </select>
          <label className="botao botao--secundario botao--pequeno fin-anexos__arquivo">
            {enviando ? "Enviando…" : lancamentoId ? "Adicionar arquivo" : escolhido ? "Trocar arquivo" : "Escolher arquivo"}
            <input type="file" accept={ACEITOS} className="fin-oculto-visual" disabled={enviando} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void escolher(f); }} aria-label="Arquivo do boleto ou documento" />
          </label>
          <span className="campo__ajuda">PDF, foto (JPG/PNG), XML da nota, Word ou Excel, até 15 MB.</span>
        </div>
      )}
      {erro && <span className="campo__erro" role="alert">{erro}</span>}
    </div>
  );
}
