-- Apaga TODAS as OS, equipamentos e clientes. Não mexe em tipos de equipamento,
-- usuários, catálogo de peças, parâmetros ou dados da empresa.
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE ordens_fotos;
TRUNCATE TABLE ordens;
TRUNCATE TABLE equipamentos;
TRUNCATE TABLE clientes;
SET FOREIGN_KEY_CHECKS = 1;
