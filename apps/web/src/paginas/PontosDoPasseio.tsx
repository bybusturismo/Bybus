import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { Passeio, PontoEmbarque } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { lerCoordenada, lerParCoordenadas } from "../util/geolocalizacao";
import { useCarregar } from "../util/useCarregar";

const texto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function LinhaPonto({ ponto, podeEditar, aoSalvar }: { ponto: PontoEmbarque; podeEditar: boolean; aoSalvar: (p: PontoEmbarque) => void }) {
  const notificar = useNotificar();
  const [lat, setLat] = useState(texto(ponto.latitude));
  const [lng, setLng] = useState(texto(ponto.longitude));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const mudou = lat.trim() !== texto(ponto.latitude) || lng.trim() !== texto(ponto.longitude);

  /** Quem cola "-27.5954, -48.5480" (como o Google Maps copia) no campo de latitude preenche os dois. */
  function aoColarLatitude(v: string) {
    const par = lerParCoordenadas(v);
    if (par) {
      setLat(String(par.lat));
      setLng(String(par.lng));
    } else setLat(v);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const vazio = lat.trim() === "" && lng.trim() === "";
    const la = vazio ? null : lerCoordenada(lat);
    const ln = vazio ? null : lerCoordenada(lng);
    if (!vazio && (la === null || ln === null)) return setErro("Use números, como -27.5954 e -48.5480 (ponto ou vírgula nos decimais).");
    if (la !== null && Math.abs(la) > 90) return setErro("A latitude vai de -90 a 90.");
    if (ln !== null && Math.abs(ln) > 180) return setErro("A longitude vai de -180 a 180.");
    setSalvando(true);
    try {
      const p = await api.patch<PontoEmbarque>(`/api/pontos/${ponto.id}`, { latitude: la, longitude: ln });
      aoSalvar(p);
      notificar(`Coordenadas de “${ponto.nome}” salvas.`);
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <tr>
      <td>
        {ponto.horario} — {ponto.nome}
        {erro && <div className="aviso aviso--erro" role="alert">{erro}</div>}
      </td>
      <td>
        <form onSubmit={salvar} noValidate className="filtros">
          <div className="campo">
            <label htmlFor={`lat-${ponto.id}`}>Latitude <span className="visualmente-oculto">de {ponto.nome}</span></label>
            <input id={`lat-${ponto.id}`} className="campo-coordenada" inputMode="decimal" value={lat} disabled={!podeEditar} onChange={(e) => aoColarLatitude(e.target.value)} placeholder="-27.5954" />
          </div>
          <div className="campo">
            <label htmlFor={`lng-${ponto.id}`}>Longitude <span className="visualmente-oculto">de {ponto.nome}</span></label>
            <input id={`lng-${ponto.id}`} className="campo-coordenada" inputMode="decimal" value={lng} disabled={!podeEditar} onChange={(e) => setLng(e.target.value)} placeholder="-48.5480" />
          </div>
          {podeEditar && (
            <button type="submit" className="botao botao--secundario botao--pequeno" disabled={!mudou || salvando} aria-label={`Salvar coordenadas de ${ponto.nome}`}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          )}
        </form>
      </td>
    </tr>
  );
}

/** Pontos de embarque de um passeio, com as coordenadas usadas no rastreio do ônibus. */
export function PontosDoPasseio({ passeio }: { passeio: Passeio }) {
  const { pode } = useSessao();
  const lista = useCarregar((s) => api.get<PontoEmbarque[]>(`/api/passeios/${passeio.id}/pontos`, s), [passeio.id]);
  const podeEditar = pode("pontos:gerenciar");
  const pontos = (lista.dados ?? []).filter((p) => p.ativo !== false);
  const semCoordenadas = pontos.filter((p) => p.latitude == null).length;
  return (
    <div>
      {podeEditar && <ImportarRotaKml passeioId={passeio.id} aoGravar={() => void lista.recarregar()} />}
      <Aviso tipo="info" titulo="Como pegar as coordenadas">
        Copie do Google Maps: clique com o botão direito no local do ponto e clique nos números que aparecem (ex.: -27.5954, -48.5480). Depois cole no campo de latitude: os dois campos são preenchidos.
        As coordenadas servem para mostrar o ponto no mapa e calcular quando o ônibus chega; sem elas, o cliente vê o ônibus mas não a previsão. [A confirmar: coordenadas oficiais com o dono]
      </Aviso>
      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : pontos.length === 0 ? (
        <Vazio titulo="Este passeio não tem pontos de embarque." />
      ) : (
        <>
          {semCoordenadas > 0 && <p className="campo__ajuda">{semCoordenadas} de {pontos.length} ponto(s) ainda sem coordenadas.</p>}
          <div className="tabela-rolagem">
            <table className="tabela">
              <caption className="visualmente-oculto">Pontos de {passeio.nome}</caption>
              <thead>
                <tr>
                  <th scope="col">Ponto</th>
                  <th scope="col">Coordenadas (opcional)</th>
                </tr>
              </thead>
              <tbody>
                {pontos.map((p) => (
                  <LinhaPonto key={p.id} ponto={p} podeEditar={podeEditar} aoSalvar={() => void lista.recarregar()} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

interface PreviaRota {
  gravado: boolean;
  pontos: Array<{ id: string; nome: string; horario: string; atual: { lat: number; lng: number } | null; novo: { lat: number; lng: number; nomeNoMapa: string } | null }>;
  tracado: { pontos: number; km: number };
  naoUsados: string[];
}

/** Importa a rota do Google My Maps (.kml): coordenadas dos pontos e o traçado real do ônibus (11/11/2026). */
function ImportarRotaKml({ passeioId, aoGravar }: { passeioId: string; aoGravar: () => void }) {
  const notificar = useNotificar();
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaRota | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(texto: string, confirmar: boolean) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await api.post<PreviaRota>(`/api/passeios/${passeioId}/rota-kml`, { conteudo: texto, confirmar });
      setPrevia(r);
      if (r.gravado) {
        notificar(`Rota gravada: ${r.pontos.filter((p) => p.novo).length} ponto(s) no mapa e traçado de ${r.tracado.km.toLocaleString("pt-BR")} km.`);
        aoGravar();
      }
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }

  async function escolher(f: File | undefined) {
    setPrevia(null);
    setConteudo(null);
    if (!f) return;
    if (!/\.kml$/i.test(f.name)) return setErro("Escolha o arquivo .kml exportado do Google My Maps (opção \"Exportar para um arquivo .KML\").");
    const texto = await f.text();
    setConteudo(texto);
    await enviar(texto, false);
  }

  return (
    <section className="cartao" aria-labelledby="titulo-rota-kml">
      <h3 id="titulo-rota-kml">Importar a rota do mapa (Google My Maps)</h3>
      <p className="texto-fraco">No My Maps: ⋮ › Exportar para KML/KMZ › desmarque "manter os dados atualizados" e marque "arquivo .KML". O sistema grava as coordenadas dos pontos de embarque e o traçado do ônibus (previsão de chegada pelo caminho real).</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <input type="file" accept=".kml" aria-label="Arquivo .kml da rota" disabled={ocupado} onChange={(e) => void escolher(e.target.files?.[0])} />
      {previa && (
        <>
          <div className="tabela-rolagem">
            <table className="tabela tabela--compacta">
              <thead><tr><th scope="col">Ponto do sistema</th><th scope="col">No mapa</th></tr></thead>
              <tbody>
                {previa.pontos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.horario} — {p.nome}</td>
                    <td>{p.novo ? <>{p.novo.nomeNoMapa} <span className="texto-fraco">({p.novo.lat.toFixed(5)}, {p.novo.lng.toFixed(5)})</span></> : <span className="texto-atencao">não achado no mapa{p.atual ? " (mantém o atual)" : ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="texto-fraco">Traçado: {previa.tracado.pontos} pontos, {previa.tracado.km.toLocaleString("pt-BR")} km.{previa.naoUsados.length ? ` Marcações do mapa sem ponto correspondente (paradas, etc.): ${previa.naoUsados.join("; ")}.` : ""}</p>
          {!previa.gravado && <button type="button" className="botao botao--primario" disabled={ocupado || !conteudo} onClick={() => conteudo && void enviar(conteudo, true)}>Gravar coordenadas e traçado</button>}
          {previa.gravado && <Aviso tipo="sucesso">Rota gravada.</Aviso>}
        </>
      )}
    </section>
  );
}
