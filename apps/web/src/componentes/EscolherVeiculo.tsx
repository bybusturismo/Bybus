import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { ROTULO_TIPO_VEICULO } from "../paginas/frota/tipos";

export interface OpcaoVeiculo {
  id: string; placa: string; apelido: string | null; tipo: string; capacidade: number | null; unidadeId: string;
  disponivel?: boolean; motivosBloqueio?: string[];
}

/** Lista dos veículos cadastrados (ativos e em manutenção), das praças do usuário. */
export const carregarVeiculos = () => api.get<OpcaoVeiculo[]>("/api/frota/veiculos/opcoes");

export function rotuloVeiculo(v: OpcaoVeiculo) {
  const extra = [(ROTULO_TIPO_VEICULO as Record<string, string>)[v.tipo] ?? v.tipo, v.capacidade ? `${v.capacidade} lugares` : null].filter(Boolean).join(", ");
  return `${v.placa}${v.apelido ? ` — ${v.apelido}` : ""}${extra ? ` (${extra})` : ""}${v.disponivel === false ? " · indisponível" : ""}`;
}

/**
 * Veículo sempre escolhido da lista da Frota (dono, 16/11/2026: "só pra selecionar", em todo o sistema). O valor é a placa.
 * Um valor antigo, digitado antes desta regra, aparece como opção para não se perder.
 */
export function EscolherVeiculo({ id, valor, aoMudar, unidadeId, vazio = "A definir", desabilitado, descricao }: {
  id: string;
  valor: string;
  aoMudar: (placa: string, veiculo: OpcaoVeiculo | null) => void;
  /** Mostra só os veículos desta praça (o atual sempre aparece). */
  unidadeId?: string | null;
  vazio?: string;
  desabilitado?: boolean;
  descricao?: string;
}) {
  const [lista, setLista] = useState<OpcaoVeiculo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    carregarVeiculos().then((l) => vivo && setLista(l)).catch((e) => vivo && setErro(mensagemDeErro(e)));
    return () => { vivo = false; };
  }, []);
  const daPraca = (lista ?? []).filter((v) => !unidadeId || v.unidadeId === unidadeId || v.placa === valor);
  const antigo = valor && lista && !lista.some((v) => v.placa === valor);
  return (
    <>
      <select id={id} value={valor} disabled={desabilitado || (!lista && !erro)} aria-describedby={descricao}
        onChange={(e) => aoMudar(e.target.value, (lista ?? []).find((v) => v.placa === e.target.value) ?? null)}>
        <option value="">{!lista && !erro ? "Carregando veículos…" : vazio}</option>
        {antigo && <option value={valor}>{valor} (digitado antes, fora do cadastro)</option>}
        {daPraca.map((v) => <option key={v.id} value={v.placa}>{rotuloVeiculo(v)}</option>)}
      </select>
      {erro && <span className="campo__erro">Não foi possível carregar os veículos: {erro}</span>}
      {lista && lista.length === 0 && <span className="campo__ajuda">Nenhum veículo cadastrado. Cadastre em Frota › Veículos.</span>}
    </>
  );
}
