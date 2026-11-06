import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mensagens, unidades, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Conversa de WhatsApp com um telefone (uma por contato). `chave` junta as variações do mesmo número
 * (com ou sem o 9 extra do Brasil) e é o que garante uma conversa só. Grupos nunca entram aqui.
 */
export const waConversas = pgTable("wa_conversas", {
  id: uuid().primaryKey().defaultRandom(),
  /** WHATSAPP ou INSTAGRAM (central "Conversas"). */
  canal: text().notNull().default("WHATSAPP"),
  /** Telefone em dígitos com DDI (como em normalizarDestino), "lid:<código>" quando o WhatsApp esconde o número, ou "ig:<IGSID>" no Instagram. */
  telefone: text().notNull(),
  /** Instagram: id do contato naquela conta (IGSID); é para onde a resposta vai. Nulo no WhatsApp. */
  idContato: text(),
  /** Quando o contato escreveu pela última vez (Instagram: a janela de resposta de 24 h conta daqui). */
  ultimaEntradaEm: timestamp({ withTimezone: true }),
  /** Chave de comparação: DDI+DDD+8 últimos dígitos (Brasil) ou os dígitos ("ig:<IGSID>" no Instagram); única por conversa. */
  chave: text().notNull(),
  /** Endereço do WhatsApp (JID), quando conhecido; é para onde a resposta vai. */
  jid: text(),
  /** Nome que o contato usa no WhatsApp (ou o titular da reserva, se a conversa começou por ela). */
  nome: text(),
  /** Praça, quando o telefone é de uma reserva; nula = contato sem reserva (visível a quem tem whatsapp:ver). */
  unidadeId: uuid().references(() => unidades.id),
  ultimaMensagemEm: timestamp({ withTimezone: true }),
  naoLidas: integer().notNull().default(0),
  arquivada: boolean().notNull().default(false),
  /** Etiquetas da conversa (códigos de ETIQUETAS_CONVERSA no core). */
  etiquetas: text().array().notNull().default(sql`'{}'::text[]`),
  /** Atendente responsável (contador "minhas conversas"). */
  atendenteId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [
  index("wa_conversas_atendente_idx").on(t.atendenteId),
  uniqueIndex("wa_conversas_chave_uq").on(t.chave),
  index("wa_conversas_ultima_idx").on(t.ultimaMensagemEm),
  index("wa_conversas_canal_idx").on(t.canal),
]);

/** Mensagem de uma conversa. Mídia só registra o tipo (sem baixar o arquivo nesta versão). */
export const waMensagens = pgTable("wa_mensagens", {
  id: uuid().primaryKey().defaultRandom(),
  conversaId: uuid().notNull().references(() => waConversas.id, { onDelete: "cascade" }),
  /** ENTRADA (do cliente) ou SAIDA (nossa). */
  direcao: text().notNull(),
  texto: text(),
  /** TEXTO, IMAGEM, AUDIO, DOCUMENTO ou OUTRO. */
  tipo: text().notNull().default("TEXTO"),
  /** Id da mensagem no WhatsApp; único (deduplica avisos repetidos). */
  idExterno: text(),
  /** ENVIADA, SIMULADA, FALHA (saída) · RECEBIDA (entrada) · LIDA (saída lida pelo cliente). */
  status: text().notNull(),
  /** Usuário que respondeu pela tela; nulo = automática (fila) ou enviada pelo celular. */
  enviadaPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  /** Quando veio da fila automática (confirmação, voucher, rastreio). */
  mensagemFilaId: uuid().references(() => mensagens.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [
  uniqueIndex("wa_mensagens_id_externo_uq").on(t.idExterno),
  uniqueIndex("wa_mensagens_fila_uq").on(t.mensagemFilaId),
  index("wa_mensagens_conversa_idx").on(t.conversaId, t.criadoEm),
]);

/**
 * Biblioteca de respostas prontas das Conversas (WhatsApp e Instagram), por idioma. O atalho "/" na caixa de resposta abre a lista.
 * Variáveis no texto: {nome}, {passeio}, {data}, {ponto}, {horario}. `revisada` = o dono já conferiu o texto (as sugestões iniciais nascem false).
 */
export const respostasRapidas = pgTable("respostas_rapidas", {
  id: uuid().primaryKey().defaultRandom(),
  /** Palavra curta para achar com "/": minúsculas, números e hífen. */
  atalho: text().notNull(),
  titulo: text().notNull(),
  /** PT, EN ou ES. */
  idioma: text().notNull().default("PT"),
  texto: text().notNull(),
  revisada: boolean().notNull().default(false),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [uniqueIndex("respostas_rapidas_atalho_idioma_uq").on(t.atalho, t.idioma)]);
