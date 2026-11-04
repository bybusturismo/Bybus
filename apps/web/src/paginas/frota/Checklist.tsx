import { useMemo, useState } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, hojeIso, somarDias } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CabecalhoFrota, FormModal, formatarKm, numeroDeTexto, SeletorVeiculo, useVeiculos } from "./comum";
import { rotuloVeiculo, type ChecklistFeito, type ItemChecklist, type VeiculoChecklist } from "./tipos";

type Resposta = { ok: boolean | null; observacao: string };
interface Resultado {
  aprovado: boolean;
  veiculoBloqueado: boolean;
  resumo: { total: number; naoOk: number; criticosNaoOk: number };
}

/** Pensado para o celular: um veículo por vez, botões grandes, observação só quando há problema. */
function Preencher() {
  const veiculos = useCarregar((sinal) => api.get<VeiculoChecklist[]>("/api/frota/checklist/veiculos", sinal), []);
  const itens = useCarregar((sinal) => api.get<ItemChecklist[]>("/api/frota/checklist/itens", sinal), []);
  const [veiculoId, setVeiculoId] = useState("");
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({});
  const [km, setKm] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ placa: string; r: Resultado } | null>(null);
  const veiculo = veiculos.dados?.find((v) => v.id === veiculoId);

  const grupos = useMemo(() => {
    const m = new Map<string, ItemChecklist[]>();
    for (const i of itens.dados ?? []) m.set(i.grupo, [...(m.get(i.grupo) ?? []), i]);
    return [...m.entries()];
  }, [itens.dados]);
  const respondidos = (itens.dados ?? []).filter((i) => respostas[i.id]?.ok != null).length;

  function escolher(id: string) {
    setVeiculoId(id);
    setRespostas({});
    setKm("");
    setObservacao("");
    setErro(null);
    setResultado(null);
  }
  const definir = (id: string, parcial: Partial<Resposta>) => setRespostas((r) => ({ ...r, [id]: { ok: null, observacao: "", ...r[id], ...parcial } }));

  async function enviar() {
    if (!veiculo || !itens.dados) return;
    setErro(null);
    const faltam = itens.dados.filter((i) => respostas[i.id]?.ok == null);
    if (faltam.length) return setErro(`Responda todos os itens (faltam ${faltam.length}).`);
    const semObs = itens.dados.find((i) => respostas[i.id]!.ok === false && respostas[i.id]!.observacao.trim().length < 3);
    if (semObs) return setErro(`Descreva o problema do item “${semObs.descricao}”.`);
    const kmN = numeroDeTexto(km);
    if (Number.isNaN(kmN)) return setErro("Km inválido.");
    setEnviando(true);
    try {
      const r = await api.post<Resultado>("/api/frota/checklists", {
        veiculoId: veiculo.id, km: kmN, observacao: observacao.trim() || null,
        respostas: itens.dados.map((i) => ({ itemId: i.id, ok: respostas[i.id]!.ok, observacao: respostas[i.id]!.ok ? null : respostas[i.id]!.observacao.trim() })),
      });
      setResultado({ placa: veiculo.placa, r });
      setVeiculoId("");
      await veiculos.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }

  if (veiculos.carregando && !veiculos.dados) return <Carregando />;
  if (veiculos.erro) return <ErroCarga mensagem={veiculos.erro} tentarDeNovo={veiculos.recarregar} />;
  if (itens.erro) return <ErroCarga mensagem={itens.erro} tentarDeNovo={itens.recarregar} />;
  if (!veiculos.dados?.length) return <Vazio titulo="Nenhum veículo disponível para checklist nesta praça." />;

  return (
    <>
      {resultado && (
        resultado.r.aprovado
          ? <Aviso tipo="sucesso" titulo={`Checklist de ${resultado.placa} enviado`}>Tudo certo{resultado.r.resumo.naoOk ? `, com ${resultado.r.resumo.naoOk} observação(ões) para a equipe` : ""}. Boa viagem!</Aviso>
          : <Aviso tipo="erro" titulo={`${resultado.placa} bloqueado`}>Há problema em item de segurança. O veículo foi tirado da escala e uma ordem de manutenção foi aberta. Avise a equipe.</Aviso>
      )}
      <h2>Qual veículo?</h2>
      <div className="checklist-veiculos">
        {veiculos.dados.map((v) => (
          <button key={v.id} type="button" className="checklist-veiculo" aria-pressed={v.id === veiculoId} onClick={() => escolher(v.id)}>
            <strong>{rotuloVeiculo(v)}</strong>
            <span className="texto-fraco">Km atual: {formatarKm(v.kmAtual)}</span>
            {v.feitoHoje
              ? <span className={`etiqueta ${v.aprovadoHoje ? "etiqueta--sucesso" : "etiqueta--perigo"}`}>{v.aprovadoHoje ? "Checklist de hoje feito" : "Reprovado hoje"}</span>
              : <span className="etiqueta etiqueta--atencao">Falta o checklist de hoje</span>}
            {v.situacao === "MANUTENCAO" && <span className="etiqueta etiqueta--perigo">Em manutenção</span>}
          </button>
        ))}
      </div>

      {veiculo && itens.dados && (
        <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} noValidate aria-label={`Checklist de ${veiculo.placa}`}>
          <h2>Checklist — {rotuloVeiculo(veiculo)}</h2>
          {veiculo.feitoHoje && <Aviso tipo="info">Já existe checklist de hoje para este veículo. Envie outro só se algo mudou.</Aviso>}
          {grupos.map(([grupo, lista]) => (
            <fieldset key={grupo} className="cartao">
              <legend className="checklist-grupo">{grupo}</legend>
              {lista.map((i) => {
                const r = respostas[i.id];
                return (
                  <div key={i.id} className="checklist-item" role="group" aria-label={i.descricao}>
                    <p className="checklist-item__texto">{i.descricao}{i.critico && <> <span className="etiqueta etiqueta--neutra">segurança</span></>}</p>
                    <div className="checklist-item__escolhas">
                      <button type="button" className="checklist-escolha checklist-escolha--ok" aria-pressed={r?.ok === true} onClick={() => definir(i.id, { ok: true })}>OK</button>
                      <button type="button" className="checklist-escolha checklist-escolha--problema" aria-pressed={r?.ok === false} onClick={() => definir(i.id, { ok: false })}>Problema</button>
                    </div>
                    {r?.ok === false && (
                      <div className="campo">
                        <label htmlFor={`obs-${i.id}`}>O que aconteceu? ({i.descricao})</label>
                        <input id={`obs-${i.id}`} value={r.observacao} maxLength={300} onChange={(e) => definir(i.id, { observacao: e.target.value })} />
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
          <div className="grade-campos">
            <div className="campo"><label htmlFor="ck-km">Km do hodômetro (opcional)</label><input id="ck-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></div>
            <div className="campo campo--largo"><label htmlFor="ck-obs">Observação geral (opcional)</label><input id="ck-obs" value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} /></div>
          </div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="checklist-rodape">
            <button type="submit" className="botao botao--primario botao--bloco" disabled={enviando}>{enviando ? "Enviando…" : `Enviar checklist (${respondidos}/${itens.dados.length})`}</button>
          </div>
        </form>
      )}
    </>
  );
}

function Historico() {
  const veiculos = useVeiculos();
  const [veiculoId, setVeiculoId] = useState("");
  const [problemas, setProblemas] = useState(false);
  const de = somarDias(hojeIso(), -30);
  const lista = useCarregar((sinal) => api.get<ChecklistFeito[]>(`/api/frota/checklists${qs({ veiculoId, de, somenteProblemas: problemas ? "true" : "" })}`, sinal), [veiculoId, problemas, de]);
  return (
    <>
      <div className="filtros">
        <div className="campo campo--linha"><label htmlFor="ckh-veiculo">Veículo</label><SeletorVeiculo id="ckh-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos.dados ?? []} vazio="Todos" /></div>
        <label className="interruptor"><input type="checkbox" checked={problemas} onChange={(e) => setProblemas(e.target.checked)} /> Só com problemas</label>
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : !lista.dados?.length ? <Vazio titulo="Nenhum checklist nos últimos 30 dias." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="visualmente-oculto">Checklists dos últimos 30 dias</caption>
            <thead><tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Resultado</th><th>Problemas</th></tr></thead>
            <tbody>
              {lista.dados.map((c) => (
                <tr key={c.id}>
                  <td className="sem-quebra">{formatarData(c.data)}</td>
                  <td><strong>{c.placa}</strong></td>
                  <td>{c.motorista ?? "—"}</td>
                  <td><span className={`etiqueta ${c.aprovado ? "etiqueta--sucesso" : "etiqueta--perigo"}`}>{c.aprovado ? "Aprovado" : "Reprovado"}</span></td>
                  <td>
                    {c.respostas.filter((r) => !r.ok).length === 0 ? <span className="texto-fraco">Nenhum</span> : (
                      <ul className="frota-lista">{c.respostas.filter((r) => !r.ok).map((r) => <li key={r.itemId}>{r.descricao}{r.critico && " (segurança)"}: {r.observacao}</li>)}</ul>
                    )}
                    {c.observacao && <span className="texto-fraco">Obs.: {c.observacao}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FormItem({ item, aoFechar, aoSalvo }: { item: ItemChecklist | null; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const [grupo, setGrupo] = useState(item?.grupo ?? "Mecânica");
  const [descricao, setDescricao] = useState(item?.descricao ?? "");
  const [critico, setCritico] = useState(item?.critico ?? false);
  const [ativo, setAtivo] = useState(item?.ativo ?? true);
  async function enviar() {
    if (grupo.trim().length < 2 || descricao.trim().length < 3) throw new Error("Informe o grupo e a descrição do item.");
    const corpo = { grupo: grupo.trim(), descricao: descricao.trim(), critico, ativo };
    if (item) await api.patch(`/api/frota/checklist/itens/${item.id}`, corpo);
    else await api.post("/api/frota/checklist/itens", corpo);
    await aoSalvo();
  }
  return (
    <FormModal titulo={item ? "Editar item" : "Novo item do checklist"} aoFechar={aoFechar} aoEnviar={enviar}>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="ci-grupo">Grupo</label><input id="ci-grupo" value={grupo} maxLength={60} onChange={(e) => setGrupo(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="ci-desc">Descrição</label><input id="ci-desc" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} /></div>
      </div>
      <label className="interruptor"><input type="checkbox" checked={critico} onChange={(e) => setCritico(e.target.checked)} /> Item de segurança (problema bloqueia o veículo)</label>
      <label className="interruptor"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Aparece no checklist</label>
    </FormModal>
  );
}

function Itens() {
  const notificar = useNotificar();
  const lista = useCarregar((sinal) => api.get<ItemChecklist[]>("/api/frota/checklist/itens?todos=true", sinal), []);
  const [editando, setEditando] = useState<ItemChecklist | "novo" | null>(null);
  return (
    <>
      <div className="barra-acoes"><button type="button" className="botao botao--primario" onClick={() => setEditando("novo")}>Novo item</button></div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="visualmente-oculto">Itens do checklist</caption>
            <thead><tr><th>Grupo</th><th>Item</th><th>Segurança</th><th>Situação</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>
              {(lista.dados ?? []).map((i) => (
                <tr key={i.id} className={i.ativo ? "" : "linha--inativa"}>
                  <td>{i.grupo}</td>
                  <td>{i.descricao}</td>
                  <td>{i.critico ? <span className="etiqueta etiqueta--atencao">Sim</span> : <span className="texto-fraco">Não</span>}</td>
                  <td>{i.ativo ? "Ativo" : "Oculto"}</td>
                  <td><button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setEditando(i)} aria-label={`Editar item ${i.descricao}`}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando && <FormItem item={editando === "novo" ? null : editando} aoFechar={() => setEditando(null)} aoSalvo={async () => { notificar("Item salvo."); await lista.recarregar(); }} />}
    </>
  );
}

export function ChecklistPagina() {
  const { pode } = useSessao();
  const [aba, setAba] = useState<"preencher" | "historico" | "itens">(pode("frota:checklist") ? "preencher" : "historico");
  const abas = [
    pode("frota:checklist") && ["preencher", "Preencher checklist"],
    pode("frota:ver") && ["historico", "Histórico"],
    pode("frota:gerenciar") && ["itens", "Itens do checklist"],
  ].filter((a): a is ["preencher" | "historico" | "itens", string] => !!a);
  return (
    <div className="pagina">
      <CabecalhoFrota titulo="Checklist diário" descricao="Conferência do veículo antes da viagem, baseada na Cartilha do Motorista." />
      {abas.length > 1 && (
        <div className="abas" role="tablist" aria-label="Checklist">
          {abas.map(([k, rotulo]) => <button key={k} type="button" role="tab" aria-selected={aba === k} className={`aba${aba === k ? " aba--ativa" : ""}`} onClick={() => setAba(k)}>{rotulo}</button>)}
        </div>
      )}
      {aba === "preencher" && <Preencher />}
      {aba === "historico" && <Historico />}
      {aba === "itens" && <Itens />}
    </div>
  );
}
