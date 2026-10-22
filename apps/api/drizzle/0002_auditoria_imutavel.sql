-- Auditoria imutável: nenhuma linha pode ser alterada ou apagada (LGPD/ prestação de contas).
CREATE OR REPLACE FUNCTION auditoria_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A auditoria é imutável: % não permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS auditoria_sem_alteracao ON auditoria;
--> statement-breakpoint
CREATE TRIGGER auditoria_sem_alteracao BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_imutavel();
