import { useState, type FormEvent, type ReactNode } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso } from "../../componentes/Estados";
import { Modal } from "../../componentes/Modal";
import { AbasModulo, CabecalhoPagina } from "../../componentes/Pagina";
import { useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";
import type { SituacaoPlano, SituacaoVencimento, Veiculo } from "./tipos";
import "./frota.css";

const ABAS = [
  { para: "/frota", rotulo: "Painel", fim: true, permissoes: ["frota:ver"] },
  { para: "/frota/veiculos", rotulo: "Veículos", permissoes: ["frota:ver"] },
  { para: "/frota/documentos", rotulo: "Documentos", permissoes: ["frota:ver"] },
  { para: "/frota/manutencao", rotulo: "Manutenção", permissoes: ["frota:ver"] },
  { para: "/frota/abastecimento", rotulo: "Abastecimento", permissoes: ["frota:ver"] },
  { para: "/frota/checklist", rotulo: "Checklist", permissoes: ["frota:checklist", "frota:ver"] },
] as const;

/** Cabeçalho da página com as abas do módulo (só as que o perfil pode abrir). */
export function CabecalhoFrota({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  const { pode } = useSessao();
  return (
    <>
      <AbasModulo
        rotulo="Seções da frota"
        itens={ABAS.filter((a) => a.permissoes.some((p) => pode(p))).map((a) => ({ para: a.para, rotulo: a.rotulo, fim: "fim" in a }))}
      />
      <CabecalhoPagina titulo={titulo} descricao={descricao} acoes={acoes} />
    </>
  );
}

/** Veículos da praça escolhida no menu (ou de todas). */
export function useVeiculos() {
  const { praca } = useSessao();
  return useCarregar((sinal) => api.get<Veiculo[]>(`/api/frota/veiculos${qs({ unidadeId: praca })}`, sinal), [praca]);
}

export function EtiquetaVencimento({ situacao, dias }: { situacao: SituacaoVencimento; dias: number }) {
  if (situacao === "VENCIDO") return <span className="etiqueta etiqueta--perigo">Vencido há {Math.abs(dias)} {Math.abs(dias) === 1 ? "dia" : "dias"}</span>;
  if (situacao === "A_VENCER") return <span className="etiqueta etiqueta--atencao">{dias === 0 ? "Vence hoje" : `Vence em ${dias} ${dias === 1 ? "dia" : "dias"}`}</span>;
  return <span className="etiqueta etiqueta--sucesso">Em dia</span>;
}

export function EtiquetaPlano({ situacao }: { situacao: SituacaoPlano }) {
  if (situacao === "VENCIDA") return <span className="etiqueta etiqueta--perigo">Vencida</span>;
  if (situacao === "PROXIMA") return <span className="etiqueta etiqueta--atencao">Próxima</span>;
  if (situacao === "SEM_BASE") return <span className="etiqueta etiqueta--neutra">Sem base</span>;
  return <span className="etiqueta etiqueta--sucesso">Em dia</span>;
}

/**
 * Texto digitado → número; NaN se inválido (a tela mostra erro, nunca multiplica em silêncio); null se vazio.
 * Inteiro (km, dias, ano): "." é separador de milhar ("1.500" = 1500); vírgula é inválida.
 * Decimal (litros): com vírgula, "." é milhar e "," decimal ("1.234,5"); sem vírgula, um único "." com 1–3
 * dígitos no fim é decimal ("45.5" = 45,5, como no teclado do celular); vários "." só valem como milhar.
 */
export function numeroDeTexto(texto: string, decimal = false): number | null {
  const t = texto.trim();
  if (!t) return null;
  if (!decimal) return /^\d+$|^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "")) : Number.NaN;
  if (t.includes(",")) return /^(\d+|\d{1,3}(\.\d{3})+),\d+$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number.NaN;
  if (/^\d+(\.\d{1,3})?$/.test(t)) return Number(t);
  return /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "")) : Number.NaN;
}

export function formatarKm(km: number | null | undefined): string {
  return km == null ? "—" : `${new Intl.NumberFormat("pt-BR").format(km)} km`;
}

/** Janela de formulário: valida no `aoEnviar` (lançar Error mostra a mensagem) e fecha quando termina sem erro. */
export function FormModal({ titulo, aoFechar, aoEnviar, rotuloEnviar = "Salvar", children, largura }: {
  titulo: string;
  aoFechar: () => void;
  aoEnviar: () => Promise<void>;
  rotuloEnviar?: string;
  children: ReactNode;
  largura?: "normal" | "larga";
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await aoEnviar();
      aoFechar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar} largura={largura}>
      <form onSubmit={enviar} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {children}
        <div className="barra-acoes">
          <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : rotuloEnviar}</button>
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}

/** Seletor de veículo (lista já carregada). */
export function SeletorVeiculo({ id, valor, aoMudar, veiculos, vazio, desabilitado }: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  veiculos: Array<{ id: string; placa: string; apelido: string | null }>;
  vazio?: string;
  desabilitado?: boolean;
}) {
  return (
    <select id={id} value={valor} disabled={desabilitado} onChange={(e) => aoMudar(e.target.value)}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {veiculos.map((v) => <option key={v.id} value={v.id}>{v.apelido ? `${v.placa} — ${v.apelido}` : v.placa}</option>)}
    </select>
  );
}
