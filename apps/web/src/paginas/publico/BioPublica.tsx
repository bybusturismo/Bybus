import { useEffect, useState } from "react";
import { mensagemDeErro, requisitar } from "../../api/cliente";
import logo from "../../marca/bybus-vertical.png";

interface Bio {
  titulo: string; subtitulo: string; corPrimaria: string; corFundo: string;
  cupom: { codigo: string; texto: string | null } | null;
  botoes: Array<{ id: string; rotulo: string; url: string; tipo: string; destaque: boolean }>;
}

const hex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined);
const origemDaUrl = () => { try { return new URLSearchParams(window.location.search).get("utm_source") ?? undefined; } catch { return undefined; } };

/** Registra o clique sem atrasar a navegação: só botão e origem (utm_source); nenhum dado pessoal. */
function contarClique(botaoId: string) {
  try {
    void fetch("/api/publico/bio/clique", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-Bybus": "1" }, body: JSON.stringify({ botaoId, origem: origemDaUrl() }) });
  } catch { /* a contagem nunca impede o clique */ }
}

/** Página pública /bio (link na bio do Instagram): leve, uma coluna, botões grandes para o celular. */
export function BioPublica({ incorporado = false }: { incorporado?: boolean }) {
  const [bio, setBio] = useState<Bio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    requisitar<Bio>("/api/publico/bio", { semAvisoSessao: true }).then(setBio).catch((e) => setErro(mensagemDeErro(e)));
    requisitar("/api/publico/bio/visita", { metodo: "POST", corpo: { origem: origemDaUrl() }, semAvisoSessao: true }).catch(() => {});
  }, []);

  async function copiar(codigo: string) {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sem permissão: o código está visível para copiar à mão */ }
  }

  const estilo = { "--bio-cor": hex(bio?.corPrimaria ?? "") ?? "#007ac8", "--bio-fundo": hex(bio?.corFundo ?? "") ?? "#f4f6f8" } as React.CSSProperties;
  return (
    <div className={`pub-bio${incorporado ? " pub-bio--incorporado" : ""}`} style={estilo}>
      <main className="pub-bio__miolo" id="conteudo">
        <img className="pub-bio__logo" src={logo} alt="By Bus Turismo" width={72} height={72} />
        {erro && <p role="alert">{erro}</p>}
        {!bio && !erro && <p>Carregando…</p>}
        {bio && (
          <>
            <h1>{bio.titulo}</h1>
            {bio.subtitulo && <p className="pub-bio__sub">{bio.subtitulo}</p>}
            {bio.cupom && (
              <div className="pub-bio__cupom">
                {bio.cupom.texto && <span>{bio.cupom.texto}</span>}
                <strong>{bio.cupom.codigo}</strong>
                <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void copiar(bio.cupom!.codigo)}>{copiado ? "Código copiado!" : "Copiar código do cupom"}</button>
              </div>
            )}
            {bio.botoes.filter((b) => b.url.startsWith("https://")).map((b) => (
              <a key={b.id} className={`pub-bio__botao${b.destaque ? " pub-bio__botao--destaque" : ""}`} href={b.url} target="_blank" rel="noopener noreferrer" onClick={() => contarClique(b.id)}>{b.rotulo}</a>
            ))}
            {bio.botoes.length === 0 && <p>Em breve, novidades por aqui.</p>}
            <p className="pub-bio__rodape">By Bus Turismo · Florianópolis e Balneário Camboriú</p>
          </>
        )}
      </main>
    </div>
  );
}
