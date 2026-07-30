-- Rodar no phpMyAdmin ANTES de subir os arquivos PHP/dist novos

ALTER TABLE ordens
  ADD COLUMN token_publico VARCHAR(40) DEFAULT NULL AFTER numero,
  ADD UNIQUE KEY uq_ordens_token (token_publico);

-- Gera um token pras OS que já existem (criadas antes dessa atualização) —
-- sem isso, elas ficariam sem link público/QR até serem editadas de novo.
UPDATE ordens
SET token_publico = SHA2(CONCAT(id, '-', RAND(), '-', NOW(6)), 256)
WHERE token_publico IS NULL;
