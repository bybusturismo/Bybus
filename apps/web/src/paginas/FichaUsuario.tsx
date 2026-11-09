import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../componentes/Estados";
import { Avatar } from "../componentes/MenuUsuario";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { formatarData, formatarDataHora } from "../util/formato";
import { lerBase64, reduzirFoto } from "../util/foto";
import { useCarregar } from "../util/useCarregar";

interface Ficha {
  apelido: string | null; nascimento: string | null; telefone: string | null; vinculo: string | null; cargo: string | null; admissao: string | null; desligamento: string | null;
  cpf: string | null; rg: string | null; rgOrgao: string | null; cnpj: string | null; emailPessoal: string | null;
  endereco: Record<"cep" | "logradouro" | "numero" | "complemento" | "bairro" | "cidade" | "uf", string | null>;
  emergencia: Record<"nome" | "parentesco" | "telefone", string | null>;
  pix: { tipo: string | null; chave: string | null }; banco: Record<"banco" | "agencia" | "conta", string | null>;
  anotacoes: string | null; pixAlteradoEm: string | null; atualizadoEm: string | null;
}
interface Resposta {
  usuario: { id: string; nome: string };
  vinculos: Array<{ valor: string; rotulo: string }>;
  tiposAnexo: Array<{ valor: string; rotulo: string }>;
  ficha: Ficha;
  anexos: Array<{ id: string; tipo: string; nome: string; mime: string; tamanho: number; criadoEm: string }>;
}

const v = (x: string | null | undefined) => x ?? "";
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Foto do usuário (quem gerencia usuários troca a de qualquer um). */
function FotoDoUsuario({ usuarioId, nome, fotoVersao, aoMudar }: { usuarioId: string; nome: string; fotoVersao: number | null; aoMudar: (v: number | null) => void }) {
  const [erro, setErro] = useState<string | null>(null);
  async function escolher(arquivo?: File) {
    if (!arquivo) return;
    setErro(null);
    try {
      const r = await api.put<{ fotoVersao: number }>(`/api/usuarios/${usuarioId}/foto`, { imagem: await reduzirFoto(arquivo) });
      aoMudar(r.fotoVersao);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }
  async function remover() {
    try { await api.delete(`/api/usuarios/${usuarioId}/foto`); aoMudar(null); } catch (e) { setErro(mensagemDeErro(e)); }
  }
  return (
    <div className="ficha__foto">
      <Avatar nome={nome} fotoVersao={fotoVersao} usuarioId={usuarioId} tamanho={72} />
      <div>
        <label className="botao botao--secundario botao--pequeno">
          {fotoVersao ? "Trocar foto" : "Enviar foto"}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void escolher(e.target.files?.[0])} aria-label={`Foto de ${nome}`} />
        </label>{" "}
        {fotoVersao && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void remover()}>Remover</button>}
        {erro && <div className="texto-perigo">{erro}</div>}
      </div>
    </div>
  );
}

/**
 * Ficha completa do usuário (pedido do dono, 09/11/2026): dados pessoais, contratação, contato de emergência, pagamento e
 * anexos (contrato, documentos). Só com a permissão "usuarios:ficha"; o servidor guarda a parte sensível cifrada.
 */
export function FichaUsuario({ usuarioId, nome, fotoVersao, podeFicha, aoFechar, aoMudarFoto }: {
  usuarioId: string; nome: string; fotoVersao: number | null; podeFicha: boolean; aoFechar: () => void; aoMudarFoto: (v: number | null) => void;
}) {
  const notificar = useNotificar();
  const dados = useCarregar((s) => (podeFicha ? api.get<Resposta>(`/api/usuarios/${usuarioId}/ficha`, s) : Promise.resolve(null)), [usuarioId, podeFicha]);
  const [f, setF] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [tipoAnexo, setTipoAnexo] = useState("CONTRATO");
  const [foto, setFoto] = useState(fotoVersao);
  const r = dados.dados;
  const ficha = f ?? r?.ficha ?? null;
  const mudar = (parcial: Partial<Ficha>) => setF({ ...(ficha as Ficha), ...parcial });
  const sub = <K extends "endereco" | "emergencia" | "pix" | "banco">(k: K, campo: string, valor: string) => setF({ ...(ficha as Ficha), [k]: { ...(ficha as Ficha)[k], [campo]: valor || null } });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!ficha) return;
    setSalvando(true);
    setErro(null);
    try {
      const { pixAlteradoEm: _p, atualizadoEm: _a, ...corpo } = ficha;
      await api.put(`/api/usuarios/${usuarioId}/ficha`, corpo);
      notificar("Ficha salva.");
      setF(null);
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  async function anexar(arquivo?: File) {
    if (!arquivo) return;
    setErro(null);
    if (arquivo.size > 5 * 1024 * 1024) return setErro("O arquivo pode ter até 5 MB.");
    try {
      await api.post(`/api/usuarios/${usuarioId}/anexos`, { tipo: tipoAnexo, nome: arquivo.name, base64: await lerBase64(arquivo) });
      notificar("Anexo enviado.");
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function excluirAnexo(id: string) {
    try { await api.delete(`/api/usuarios/${usuarioId}/anexos/${id}`); await dados.recarregar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }

  const campo = (id: string, rotulo: string, valor: string | null, aoMudar: (v: string) => void, extra: Record<string, unknown> = {}) => (
    <div className="campo"><label htmlFor={id}>{rotulo}</label><input id={id} value={v(valor)} onChange={(e) => aoMudar(e.target.value)} {...extra} /></div>
  );

  return (
    <Modal aberto titulo={`Ficha de ${nome}`} aoFechar={aoFechar} largura="larga">
      <FotoDoUsuario usuarioId={usuarioId} nome={nome} fotoVersao={foto} aoMudar={(x) => { setFoto(x); aoMudarFoto(x); }} />
      {!podeFicha ? <Aviso tipo="info">Os dados pessoais, de contratação e os anexos aparecem só para quem tem a permissão “Ficha dos usuários”.</Aviso>
        : dados.carregando && !r ? <Carregando /> : dados.erro ? <ErroCarga mensagem={dados.erro} tentarDeNovo={dados.recarregar} /> : ficha && r && (
          <form onSubmit={salvar} noValidate className="ficha">
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <p className="texto-fraco">Dados pessoais protegidos (LGPD): documentos, endereço, contatos e pagamento ficam criptografados. Abrir e alterar a ficha fica registrado.</p>
            <h3>Dados pessoais</h3>
            <div className="grade-campos">
              {campo("fi-apelido", "Como prefere ser chamado(a)", ficha.apelido, (x) => mudar({ apelido: x || null }))}
              {campo("fi-nasc", "Data de nascimento", ficha.nascimento, (x) => mudar({ nascimento: x || null }), { type: "date" })}
              {campo("fi-tel", "Telefone / WhatsApp", ficha.telefone, (x) => mudar({ telefone: x || null }), { inputMode: "tel" })}
              {campo("fi-email", "E-mail pessoal", ficha.emailPessoal, (x) => mudar({ emailPessoal: x || null }), { type: "email" })}
              {campo("fi-cpf", "CPF", ficha.cpf, (x) => mudar({ cpf: x || null }), { inputMode: "numeric" })}
              {campo("fi-rg", "RG", ficha.rg, (x) => mudar({ rg: x || null }))}
              {campo("fi-rgo", "Órgão emissor do RG", ficha.rgOrgao, (x) => mudar({ rgOrgao: x || null }), { placeholder: "SSP/SC" })}
            </div>
            <h3>Contratação</h3>
            <div className="grade-campos">
              <div className="campo"><label htmlFor="fi-vinc">Formato de contratação</label>
                <select id="fi-vinc" value={v(ficha.vinculo)} onChange={(e) => mudar({ vinculo: e.target.value || null })}>
                  <option value="">—</option>
                  {r.vinculos.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}
                </select>
              </div>
              {campo("fi-cargo", "Cargo / função", ficha.cargo, (x) => mudar({ cargo: x || null }))}
              {campo("fi-adm", "Admissão / início", ficha.admissao, (x) => mudar({ admissao: x || null }), { type: "date" })}
              {campo("fi-desl", "Desligamento", ficha.desligamento, (x) => mudar({ desligamento: x || null }), { type: "date" })}
              {ficha.vinculo === "PJ" && campo("fi-cnpj", "CNPJ (PJ)", ficha.cnpj, (x) => mudar({ cnpj: x || null }), { inputMode: "numeric" })}
            </div>
            <h3>Contato de emergência</h3>
            <div className="grade-campos">
              {campo("fi-em-nome", "Nome", ficha.emergencia.nome, (x) => sub("emergencia", "nome", x))}
              {campo("fi-em-par", "Parentesco", ficha.emergencia.parentesco, (x) => sub("emergencia", "parentesco", x))}
              {campo("fi-em-tel", "Telefone", ficha.emergencia.telefone, (x) => sub("emergencia", "telefone", x), { inputMode: "tel" })}
            </div>
            <h3>Endereço</h3>
            <div className="grade-campos">
              {campo("fi-cep", "CEP", ficha.endereco.cep, (x) => sub("endereco", "cep", x), { inputMode: "numeric" })}
              {campo("fi-log", "Rua / avenida", ficha.endereco.logradouro, (x) => sub("endereco", "logradouro", x))}
              {campo("fi-num", "Número", ficha.endereco.numero, (x) => sub("endereco", "numero", x))}
              {campo("fi-comp", "Complemento", ficha.endereco.complemento, (x) => sub("endereco", "complemento", x))}
              {campo("fi-bairro", "Bairro", ficha.endereco.bairro, (x) => sub("endereco", "bairro", x))}
              {campo("fi-cid", "Cidade", ficha.endereco.cidade, (x) => sub("endereco", "cidade", x))}
              {campo("fi-uf", "UF", ficha.endereco.uf, (x) => sub("endereco", "uf", x), { maxLength: 2 })}
            </div>
            <h3>Pagamento</h3>
            <div className="grade-campos">
              <div className="campo"><label htmlFor="fi-pixt">Tipo da chave Pix</label>
                <select id="fi-pixt" value={v(ficha.pix.tipo)} onChange={(e) => sub("pix", "tipo", e.target.value)}>
                  <option value="">—</option><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="TELEFONE">Telefone</option><option value="EMAIL">E-mail</option><option value="ALEATORIA">Aleatória</option>
                </select>
              </div>
              {campo("fi-pix", "Chave Pix", ficha.pix.chave, (x) => sub("pix", "chave", x))}
              {campo("fi-banco", "Banco", ficha.banco.banco, (x) => sub("banco", "banco", x))}
              {campo("fi-ag", "Agência", ficha.banco.agencia, (x) => sub("banco", "agencia", x))}
              {campo("fi-conta", "Conta", ficha.banco.conta, (x) => sub("banco", "conta", x))}
            </div>
            {ficha.pixAlteradoEm && <p className="texto-atencao">Chave Pix alterada em {formatarDataHora(ficha.pixAlteradoEm)}: confira antes de pagar.</p>}
            <div className="campo"><label htmlFor="fi-anot">Anotações</label><textarea id="fi-anot" rows={3} maxLength={4000} value={v(ficha.anotacoes)} onChange={(e) => mudar({ anotacoes: e.target.value || null })} /></div>
            <div className="modal__acoes"><button type="submit" className="botao botao--primario" disabled={salvando || !f}>{salvando ? "Salvando…" : "Salvar ficha"}</button></div>

            <h3>Anexos (contrato e documentos)</h3>
            {r.anexos.length === 0 ? <p className="texto-fraco">Nenhum anexo.</p> : (
              <ul className="ficha__anexos">
                {r.anexos.map((a) => (
                  <li key={a.id}>
                    <span className="etiqueta etiqueta--neutra">{r.tiposAnexo.find((t) => t.valor === a.tipo)?.rotulo ?? a.tipo}</span>{" "}
                    <a href={`/api/usuarios/${usuarioId}/anexos/${a.id}`} download={a.nome}>{a.nome}</a>
                    <span className="texto-fraco"> · {kb(a.tamanho)} · {formatarData(a.criadoEm)}</span>{" "}
                    <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void excluirAnexo(a.id)} aria-label={`Excluir ${a.nome}`}>Excluir</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grade-campos">
              <div className="campo"><label htmlFor="fi-tipo-anexo">Tipo do anexo</label>
                <select id="fi-tipo-anexo" value={tipoAnexo} onChange={(e) => setTipoAnexo(e.target.value)}>{r.tiposAnexo.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}</select>
              </div>
              <div className="campo"><label htmlFor="fi-anexo">Arquivo (PDF, JPG ou PNG, até 5 MB)</label><input id="fi-anexo" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => void anexar(e.target.files?.[0])} /></div>
            </div>
          </form>
        )}
    </Modal>
  );
}
