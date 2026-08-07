-- Não existe "zerar só equipamento" isolado: toda OS referencia um equipamento.
-- Este script limpa equipamento + OS juntos, mantendo clientes intactos.
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE ordens_fotos;
TRUNCATE TABLE ordens;
TRUNCATE TABLE equipamentos;
SET FOREIGN_KEY_CHECKS = 1;
