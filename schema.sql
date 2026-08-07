-- ============================================================
-- Bancada — schema MySQL/MariaDB
-- Importar via phpMyAdmin (cPanel do HostGator) num banco vazio.
-- Charset utf8mb4 para acentuação completa (português) sem surpresas.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- usuarios: login do sistema. Cada usuário TEM um papel, que
-- define o que ele pode fazer (ver api/core/permissions.php).
-- Um usuário com papel 'tecnico' também aparece como opção de
-- "técnico responsável" ao preencher uma OS.
-- ------------------------------------------------------------
CREATE TABLE usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  papel VARCHAR(30) NOT NULL DEFAULT 'tecnico', -- gestao | administrativo | tecnico
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- clientes
-- ------------------------------------------------------------
CREATE TABLE clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL,
  nome VARCHAR(190) NOT NULL,
  tipo_pessoa VARCHAR(2) NOT NULL DEFAULT 'PF', -- PF | PJ
  documento VARCHAR(30) DEFAULT '',
  apelido VARCHAR(190) DEFAULT '', -- apelido / nome fantasia
  contato VARCHAR(190) DEFAULT '', -- nome de quem se fala na empresa/família
  telefone VARCHAR(30) DEFAULT '', -- celular / whatsapp
  email VARCHAR(190) DEFAULT '',
  cep VARCHAR(9) DEFAULT '',
  rua VARCHAR(190) DEFAULT '',
  numero VARCHAR(20) DEFAULT '',
  complemento VARCHAR(100) DEFAULT '', -- sala, loja, andar, etc.
  bairro VARCHAR(120) DEFAULT '',
  cidade VARCHAR(120) DEFAULT '',
  estado VARCHAR(2) DEFAULT '',
  atuacao VARCHAR(120) DEFAULT '', -- médico, dentista, podólogo, cabeleireiro...
  como_ficou_sabendo VARCHAR(190) DEFAULT '',
  observacoes TEXT, -- ex: cliente inadimplente, preferências de atendimento
  data_cadastro DATE DEFAULT NULL, -- data real de início do relacionamento (para clientes migrados)
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clientes_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- tipos_equipamento: catálogo com checklist próprio por tipo.
-- Os três checklists-modelo ficam como JSON (lista de strings)
-- guardado em TEXT — mantém compatibilidade com qualquer versão
-- de MySQL/MariaDB do HostGator, sem depender do tipo JSON nativo.
-- ------------------------------------------------------------
CREATE TABLE tipos_equipamento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  intervalo_preventivo_meses INT NULL,
  checklist_entrada_padrao TEXT NOT NULL,
  checklist_pre_padrao TEXT NOT NULL,
  checklist_pos_padrao TEXT NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- equipamentos
-- ------------------------------------------------------------
CREATE TABLE equipamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  tipo_equipamento_id INT NULL,
  marca VARCHAR(100) DEFAULT '',
  modelo VARCHAR(100) DEFAULT '',
  numero_serie VARCHAR(100) DEFAULT '',
  patrimonio VARCHAR(100) DEFAULT '',
  data_fabricacao VARCHAR(30) DEFAULT '',
  tensao VARCHAR(30) DEFAULT '',
  ultimo_contato_renovacao_data DATE NULL,
  ultimo_contato_renovacao_referencia DATE NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_equip_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_equip_tipo FOREIGN KEY (tipo_equipamento_id) REFERENCES tipos_equipamento(id) ON DELETE SET NULL,
  INDEX idx_equip_cliente (cliente_id),
  INDEX idx_equip_numero_serie (numero_serie)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- ordens: o coração do sistema. Checklists e orçamento ficam
-- como TEXT (JSON serializado) pelo mesmo motivo dos tipos —
-- são listas/objetos aninhados sem necessidade de consulta
-- relacional própria, e isso evita dezenas de tabelas extras.
-- ------------------------------------------------------------
CREATE TABLE ordens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(20) NOT NULL,
  token_publico VARCHAR(40) DEFAULT NULL, -- usado no link público (QR code / aprovação por WhatsApp), nunca o número sequencial
  cliente_id INT NOT NULL,
  equipamento_id INT NOT NULL,
  tipo_atendimento VARCHAR(20) NOT NULL DEFAULT 'interno', -- interno | externo
  data_entrada DATE NOT NULL,
  origem VARCHAR(20) DEFAULT 'cliente_trouxe', -- cliente_trouxe | retirada
  tipo_manutencao VARCHAR(30) DEFAULT 'preventiva', -- preventiva | corretiva | preventiva_corretiva | montagem_instalacao
  tecnico VARCHAR(150) DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'recebido', -- recebido | em_orcamento | aguardando_aprovacao | em_execucao | concluido | entregue
  hora_inicio VARCHAR(10) DEFAULT '',
  hora_fim VARCHAR(10) DEFAULT '',
  observacoes_gerais TEXT,
  garantia_equipamento VARCHAR(20) DEFAULT 'nao_informado',
  data_conclusao DATE NULL,
  data_pagamento DATE NULL,
  data_entrega DATE NULL,
  checklist_entrada TEXT,        -- JSON: [{id, descricao, status, obs}]
  checklist_pre_orcamento TEXT,  -- JSON
  checklist_pos_orcamento TEXT,  -- JSON
  checklist_atendimento TEXT,    -- JSON (só externo)
  orcamento TEXT,                -- JSON: {descricaoServico, valorServico, pecas:[], deslocamento, desconto, formaPagamento, aprovado, obsInternas}
  criado_por INT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ordens_numero (numero),
  UNIQUE KEY uq_ordens_token (token_publico),
  CONSTRAINT fk_ordens_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ordens_equipamento FOREIGN KEY (equipamento_id) REFERENCES equipamentos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ordens_usuario FOREIGN KEY (criado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_ordens_status (status),
  INDEX idx_ordens_cliente (cliente_id),
  INDEX idx_ordens_equipamento (equipamento_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- ordens_fotos: fotos ficam como ARQUIVO em /api/uploads/ordens/,
-- aqui só guardamos o caminho — nada de base64 no banco.
-- ------------------------------------------------------------
CREATE TABLE ordens_fotos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ordem_id INT NOT NULL,
  caminho VARCHAR(255) NOT NULL,
  legenda VARCHAR(255) DEFAULT '',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fotos_ordem FOREIGN KEY (ordem_id) REFERENCES ordens(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- pecas_catalogo
-- ------------------------------------------------------------
CREATE TABLE pecas_catalogo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  descricao VARCHAR(190) NOT NULL,
  preco DECIMAL(10,2) NOT NULL DEFAULT 0,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pecas_descricao (descricao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- configuracoes: linha única (id sempre 1) com os dados da
-- empresa (impressos em documento) e os parâmetros operacionais.
-- Os dois módulos de API (empresa.php / parametros.php) leem e
-- gravam colunas diferentes desta mesma linha.
-- ------------------------------------------------------------
CREATE TABLE configuracoes (
  id INT PRIMARY KEY DEFAULT 1,
  nome VARCHAR(190) DEFAULT 'Laxis',
  logo_url VARCHAR(255) DEFAULT '',
  endereco VARCHAR(255) DEFAULT '',
  cidade VARCHAR(100) DEFAULT '',
  uf VARCHAR(2) DEFAULT '',
  cep VARCHAR(15) DEFAULT '',
  telefone VARCHAR(30) DEFAULT '',
  email VARCHAR(190) DEFAULT '',
  cnpj VARCHAR(30) DEFAULT '',
  ie VARCHAR(30) DEFAULT '',
  im VARCHAR(30) DEFAULT '',
  engenheiro_nome VARCHAR(150) DEFAULT '',
  engenheiro_crea VARCHAR(50) DEFAULT '',
  garantia_padrao_interno TEXT,
  garantia_padrao_externo TEXT,
  custodia_politica TEXT,
  intervalo_preventivo_meses INT DEFAULT 12,
  mensagem_renovacao TEXT,
  custodia_dias_alerta INT DEFAULT 90,
  custodia_dias_limite INT DEFAULT 365,
  CONSTRAINT chk_config_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO configuracoes (id, nome, endereco, cidade, uf, cep, telefone, email, cnpj, ie, im, engenheiro_crea,
  garantia_padrao_interno, garantia_padrao_externo, custodia_politica, mensagem_renovacao)
VALUES (1, 'Laxis', 'R. Otto Benz', 'Ribeirão Preto', 'SP', '14096-580', '(16) 98856-3801', 'at@laxis.com.br',
  '38.141.015/0001-42', '797.631.007.117', '20.126.656', 'CREA-SP 5068941986',
  'Garantia de peças e serviços: 3 (três) meses. Garantia não cobre deslocamentos. Caso necessário, será cobrado novo frete.',
  'Garantia de peças e serviços: 90 dias. Garantia não cobre custos de deslocamentos (estacionamento, pedágio, km rodado).\nValor visita técnica: R$200,00 (até 2h) | Hora Adicional: R$100,00',
  'O equipamento será avaliado em até 5 (cinco) dias úteis, e o orçamento comunicado por telefone/WhatsApp. Equipamentos não retirados em até 90 (noventa) dias após a comunicação de conclusão estarão sujeitos à cobrança de taxa de custódia de R$ 5,00 (cinco reais) por dia. Após 12 (doze) meses sem retirada e sem contato do cliente, o equipamento poderá ser vendido para ressarcimento dos custos de mão de obra, peças e armazenagem.',
  'Olá {cliente}! Aqui é da {empresa}. Faz quase um ano da última revisão preventiva do seu {equipamento} — vamos agendar uma nova visita pra manter tudo funcionando certinho?');

-- ------------------------------------------------------------
-- logs: auditoria — quem fez o quê. Preenchido pela própria API
-- a cada ação de escrita (ver core/Auth.php -> Auth::log()).
-- ------------------------------------------------------------
CREATE TABLE logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  acao VARCHAR(50) NOT NULL,       -- criar | editar | excluir | login | logout
  entidade VARCHAR(50) NOT NULL,   -- clientes | ordens | equipamentos | usuarios ...
  entidade_id INT NULL,
  detalhes VARCHAR(255) DEFAULT '',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_logs_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_logs_entidade (entidade, entidade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- Usuário inicial: NÃO cadastrado aqui de propósito — eu não
-- tenho como rodar password_hash() daqui pra garantir que o hash
-- bateria certo com a senha. Depois de importar este schema,
-- rode api/setup-admin.php UMA VEZ (veja README-DEPLOY.md) pra
-- criar o primeiro usuário "gestão" com senha gerada pelo seu
-- próprio servidor PHP — sempre correto, depois é só apagar
-- esse arquivo.
-- ------------------------------------------------------------
