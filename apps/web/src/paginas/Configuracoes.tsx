import { Link } from "react-router-dom";
import { itensPermitidos } from "../componentes/Layout";
import { Icone } from "../componentes/Icone";
import { Vazio } from "../componentes/Estados";
import { useSessao } from "../sessao/Sessao";

const DESCRICAO: Record<string, string> = {
  "/integracoes": "Paytour, robô de e-mails (Viator e Decolar) e WhatsApp.",
  "/pracas": "Florianópolis, Balneário Camboriú e outras praças.",
  "/usuarios": "Quem acessa o sistema, senhas e MFA.",
  "/perfis": "O que cada perfil pode ver e fazer.",
  "/auditoria": "Registro de quem fez o quê e quando.",
};

/** Itens de configuração do sistema que o perfil pode usar (antes ficavam no menu lateral). */
export function itensConfiguracao(pode: Parameters<typeof itensPermitidos>[0]) {
  return itensPermitidos(pode).filter((i) => i.area === "Configurações" && i.para !== "/conta");
}

export function Configuracoes() {
  const { pode } = useSessao();
  const itens = itensConfiguracao(pode);
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Configurações</h1>
          <p className="pagina__descricao">Cadastros e regras do sistema. Seus dados pessoais e a senha ficam em “Meu perfil”.</p>
        </div>
      </div>
      {itens.length === 0 ? <Vazio titulo="Seu perfil não tem configurações a ajustar." /> : (
        <ul className="lista-configuracoes">
          {itens.map((i) => (
            <li key={i.para}>
              <Link to={i.para} className="cartao configuracao">
                <Icone nome={i.icone} tamanho={20} />
                <span>
                  <strong>{i.rotulo}</strong>
                  {DESCRICAO[i.para] && <span className="texto-fraco">{DESCRICAO[i.para]}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
