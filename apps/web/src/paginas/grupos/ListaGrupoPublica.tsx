import { useEffect, useState } from "react";
import { ROTULO_TIPO_GRUPO, type TipoGrupo } from "@bybus/core";
import { mensagemDeErro, requisitar } from "../../api/cliente";
import { Aviso } from "../../componentes/Estados";
import logoVertical from "../../marca/bybus-vertical.png";
import { formatarDataExtenso } from "../../util/formato";
import { corpoLista, EditorLista, linhaVazia, paraLinhas, type LinhaLista } from "./EditorLista";

interface Resposta {
  grupo: { nome: string; estilo: TipoGrupo; dataPasseio: string | null; horarioInicio: string | null; localInicio: string | null };
  aberta: boolean;
  passageiros: Array<{ nome: string; tipoDocumento: string | null; documento: string | null; nascimento: string | null; categoria: string }>;
  atualizadaEm: string | null;
}

/**
 * Página do representante do grupo (link sem login, 13/11/2026): preenche ou importa a lista de passageiros e envia.
 * Pede o aceite de que tem autorização para enviar os dados (LGPD, cláusula de proteção de dados do contrato).
 */
export function ListaGrupoPublica({ token }: { token: string }) {
  const [info, setInfo] = useState<Resposta | null>(null);
  const [linhas, setLinhas] = useState<LinhaLista[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const caminho = `/api/publico/lista-grupo/${encodeURIComponent(token)}`;
  useEffect(() => {
    requisitar<Resposta>(caminho, { semAvisoSessao: true }).then((r) => {
      setInfo(r);
      const padrao = r.grupo.estilo === "ESCOLA" ? "ALUNO" : "OUTRO";
      setLinhas(r.passageiros.length ? paraLinhas(r.passageiros as never) : Array.from({ length: 10 }, () => linhaVazia(padrao)));
    }, (e) => setErro(mensagemDeErro(e)));
  }, [caminho]);
  async function enviar() {
    setErro(null);
    setOk(null);
    if (!aceite) return setErro("Marque a confirmação de autorização antes de enviar.");
    setEnviando(true);
    try {
      const r = await requisitar<{ quantidade: number }>(caminho, { metodo: "PUT", corpo: { aceite: true, passageiros: corpoLista(linhas) }, semAvisoSessao: true });
      setOk(`Lista enviada: ${r.quantidade} pessoa(s). Você pode voltar a este link para corrigir até o dia do passeio.`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }
  const g = info?.grupo;
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={66} height={96} />
          <h1>Lista de passageiros</h1>
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!info && !erro && <p className="texto-fraco">Carregando…</p>}
        {info && g && (
          <>
            <p className="cartao-acesso__subtitulo">
              <strong>{g.nome}</strong> ({ROTULO_TIPO_GRUPO[g.estilo]}){g.dataPasseio ? ` — ${formatarDataExtenso(g.dataPasseio)}` : ""}{g.horarioInicio ? `, às ${g.horarioInicio}` : ""}{g.localInicio ? ` · ${g.localInicio}` : ""}
            </p>
            {!info.aberta && <Aviso tipo="atencao">O passeio já aconteceu: a lista não pode mais ser alterada.</Aviso>}
            <p>Preencha uma linha por pessoa, com o <strong>nome completo</strong> e um <strong>documento</strong> (a fiscalização exige a lista no ônibus). Se preferir, importe a planilha do Excel.</p>
            <EditorLista linhas={linhas} mudar={setLinhas} padrao={g.estilo === "ESCOLA" ? "ALUNO" : "OUTRO"} desabilitado={!info.aberta} />
            {info.aberta && (
              <>
                <label className="interruptor">
                  <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
                  Declaro ter autorização para enviar os dados dos participantes, usados pela By Bus só para organizar, identificar e
                  acompanhar o passeio (Lei Geral de Proteção de Dados).
                </label>
                {ok && <Aviso tipo="sucesso">{ok}</Aviso>}
                <button type="button" className="botao botao--primario botao--grande" disabled={enviando} onClick={() => void enviar()}>{enviando ? "Enviando…" : "Enviar lista"}</button>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
