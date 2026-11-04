import { useState, type FormEvent, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso } from "../../componentes/Estados";
import { Modal } from "../../componentes/Modal";
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
      <div className="pagina__cabecalho">
        <div>
          <h1>{titulo}</h1>
          {descricao && <p className="pagina__descricao">{descricao}</p>}
        </div>
        {acoes && <div className="barra-acoes">{acoes}</div>}
      </div>
      <nav className="abas" aria-label="Seções da frota">
        {ABAS.filter((a) => a.permissoes.some((p) => pode(p))).map((a) => (
          <NavLink key={a.para} end={"fim" in a} to={a.para} className={({ isActive }) => `aba${isActive ? " aba--ativa" : ""}`}>
            {a.rotulo}
          </NavLink>
        ))}
      </nav>
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

/** Texto digitado ("12,5") → número; NaN se inválido, null se vazio. */
export function numeroDeTexto(texto: string): number | null {
  const t = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
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
