-- Reset TOTAL: deixa o banco pronto pra copiar/instalar em outra empresa.
-- Apaga usuários, tipos de equipamento, clientes, OS, peças, logs e
-- zera os dados da empresa (mantém a linha, só esvazia os campos).
-- Depois de rodar: precisa rodar setup-admin.php de novo pra criar o
-- primeiro usuário gestão.
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE ordens_fotos;
TRUNCATE TABLE ordens;
TRUNCATE TABLE equipamentos;
TRUNCATE TABLE clientes;
TRUNCATE TABLE pecas_catalogo;
TRUNCATE TABLE tipos_equipamento;
TRUNCATE TABLE logs;
TRUNCATE TABLE usuarios;
SET FOREIGN_KEY_CHECKS = 1;

UPDATE configuracoes SET
  nome = '', logo_url = '', endereco = '', cidade = '', uf = '', cep = '',
  telefone = '', email = '', cnpj = '', ie = '', im = '',
  engenheiro_nome = '', engenheiro_crea = '',
  garantia_padrao_interno = '', garantia_padrao_externo = '', custodia_politica = '',
  intervalo_preventivo_meses = 12, mensagem_renovacao = '',
  custodia_dias_alerta = 90, custodia_dias_limite = 365
WHERE id = 1;
