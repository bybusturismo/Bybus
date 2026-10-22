import { CATEGORIAS, TIPOS_DOCUMENTO, type Categoria, type TipoDocumento } from "../../api/tipos";
import { mascararCpf, validarDocumento } from "../../util/documento";
import { ROTULO_CATEGORIA, ROTULO_DOCUMENTO } from "../../util/rotulos";

export interface PassageiroRascunho {
  chave: string;
  nome: string;
  categoria: Categoria;
  documentoTipo: TipoDocumento | "";
  documento: string;
  documentoPais: string;
}

let contador = 0;
export function novoPassageiro(parcial: Partial<PassageiroRascunho> = {}): PassageiroRascunho {
  contador += 1;
  return { chave: `p${contador}`, nome: "", categoria: "ADULTO", documentoTipo: "", documento: "", documentoPais: "", ...parcial };
}

/** Erros por campo de um passageiro (validação de cliente; o servidor revalida). */
export function errosPassageiro(p: PassageiroRascunho): Partial<Record<"nome" | "documento" | "documentoTipo", string>> {
  const erros: Partial<Record<"nome" | "documento" | "documentoTipo", string>> = {};
  if (p.nome.length > 150) erros.nome = "Nome muito longo.";
  if (p.documento.trim()) {
    const e = validarDocumento(p.documentoTipo || null, p.documento);
    if (e) erros[p.documentoTipo ? "documento" : "documentoTipo"] = e;
  }
  return erros;
}

/** Converte o rascunho no corpo aceito pela API. */
export function corpoPassageiro(p: PassageiroRascunho) {
  const temDoc = !!p.documento.trim();
  return {
    nome: p.nome.trim(),
    categoria: p.categoria,
    documentoTipo: temDoc && p.documentoTipo ? p.documentoTipo : null,
    documento: temDoc ? p.documento.trim() : null,
    documentoPais: p.documentoPais.trim() || null,
  };
}

interface Props {
  valor: PassageiroRascunho;
  aoMudar: (v: PassageiroRascunho) => void;
  indice: number;
  mostrarErros: boolean;
  /** Texto de ajuda do campo documento (ex.: "Atual: •••8901 — deixe vazio para manter"). */
  ajudaDocumento?: string;
}

export function CamposPassageiro({ valor, aoMudar, indice, mostrarErros, ajudaDocumento }: Props) {
  const id = `pax-${valor.chave}`;
  const erros = mostrarErros ? errosPassageiro(valor) : {};
  const mudar = (parcial: Partial<PassageiroRascunho>) => aoMudar({ ...valor, ...parcial });
  const estrangeiro = valor.documentoTipo === "PASSAPORTE" || valor.documentoTipo === "DNI_MERCOSUL" || valor.documentoTipo === "RNM";

  return (
    <fieldset className="passageiro-campos">
      <legend>Passageiro {indice + 1}</legend>
      <div className="grade-campos grade-campos--passageiro">
        <div className="campo campo--largo">
          <label htmlFor={`${id}-nome`}>Nome completo</label>
          <input
            id={`${id}-nome`}
            value={valor.nome}
            maxLength={150}
            onChange={(e) => mudar({ nome: e.target.value })}
            placeholder="Deixe vazio se ainda não informado"
            aria-invalid={!!erros.nome}
            aria-describedby={erros.nome ? `${id}-nome-erro` : undefined}
          />
          {erros.nome && (
            <p id={`${id}-nome-erro`} className="campo__erro">
              {erros.nome}
            </p>
          )}
        </div>
        <div className="campo">
          <label htmlFor={`${id}-cat`}>Categoria</label>
          <select id={`${id}-cat`} value={valor.categoria} onChange={(e) => mudar({ categoria: e.target.value as Categoria })}>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-tipo`}>Tipo de documento</label>
          <select
            id={`${id}-tipo`}
            value={valor.documentoTipo}
            onChange={(e) => {
              const tipo = e.target.value as TipoDocumento | "";
              mudar({ documentoTipo: tipo, documento: tipo === "CPF" ? mascararCpf(valor.documento) : valor.documento });
            }}
            aria-invalid={!!erros.documentoTipo}
            aria-describedby={erros.documentoTipo ? `${id}-tipo-erro` : undefined}
          >
            <option value="">Sem documento</option>
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_DOCUMENTO[t]}
              </option>
            ))}
          </select>
          {erros.documentoTipo && (
            <p id={`${id}-tipo-erro`} className="campo__erro">
              {erros.documentoTipo}
            </p>
          )}
        </div>
        <div className="campo">
          <label htmlFor={`${id}-doc`}>Número do documento</label>
          <input
            id={`${id}-doc`}
            value={valor.documento}
            maxLength={40}
            inputMode={valor.documentoTipo === "CPF" ? "numeric" : "text"}
            placeholder={valor.documentoTipo === "CPF" ? "000.000.000-00" : ""}
            autoComplete="off"
            disabled={!valor.documentoTipo}
            onChange={(e) => mudar({ documento: valor.documentoTipo === "CPF" ? mascararCpf(e.target.value) : e.target.value })}
            aria-invalid={!!erros.documento}
            aria-describedby={[erros.documento ? `${id}-doc-erro` : "", ajudaDocumento ? `${id}-doc-ajuda` : ""].filter(Boolean).join(" ") || undefined}
          />
          {ajudaDocumento && (
            <p id={`${id}-doc-ajuda`} className="campo__ajuda">
              {ajudaDocumento}
            </p>
          )}
          {erros.documento && (
            <p id={`${id}-doc-erro`} className="campo__erro">
              {erros.documento}
            </p>
          )}
        </div>
        <div className="campo">
          <label htmlFor={`${id}-pais`}>País {estrangeiro ? "(do documento)" : "(opcional)"}</label>
          <input id={`${id}-pais`} value={valor.documentoPais} maxLength={60} onChange={(e) => mudar({ documentoPais: e.target.value })} />
        </div>
      </div>
    </fieldset>
  );
}
