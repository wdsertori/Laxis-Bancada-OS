<?php
/**
 * os_publica.php — endpoint PÚBLICO (sem login), usado pelo link/QR Code
 * que o cliente recebe. Busca a OS pelo token aleatório (nunca pelo
 * número sequencial) e devolve só os dados equivalentes ao que já é
 * impresso/entregue ao cliente hoje — nada de observações internas.
 *
 * GET /api/os_publica.php?token=...
 *
 * Validade: se a OS já tem data de conclusão, o link expira 15 meses
 * depois dessa data (tempo suficiente pro técnico consultar na próxima
 * revisão). Enquanto não há conclusão (ainda em orçamento/execução), o
 * link não expira — é assim que ele serve pra mandar orçamento aprovar.
 */
require_once __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Método não suportado.', 405);
}

$token = trim($_GET['token'] ?? '');
if ($token === '') {
    Response::error('Link inválido.', 400);
}

$stmt = $pdo->prepare(
    'SELECT o.*,
        c.nome AS cliente_nome, c.telefone AS cliente_telefone, c.documento AS cliente_documento,
        c.rua AS cliente_rua, c.numero AS cliente_numero, c.bairro AS cliente_bairro,
        c.cidade AS cliente_cidade, c.estado AS cliente_estado, c.cep AS cliente_cep,
        e.marca AS equip_marca, e.modelo AS equip_modelo, e.numero_serie AS equip_numero_serie,
        e.tensao AS equip_tensao, e.data_fabricacao AS equip_data_fabricacao,
        te.nome AS tipo_nome
     FROM ordens o
     JOIN clientes c ON c.id = o.cliente_id
     JOIN equipamentos e ON e.id = o.equipamento_id
     LEFT JOIN tipos_equipamento te ON te.id = e.tipo_equipamento_id
     WHERE o.token_publico = ?
     LIMIT 1'
);
$stmt->execute([$token]);
$row = $stmt->fetch();

if (!$row) {
    Response::error('Link não encontrado.', 404);
}

if (!empty($row['data_conclusao'])) {
    $limite = (new DateTime($row['data_conclusao']))->modify('+15 months');
    if (new DateTime() > $limite) {
        Response::error('Este link expirou. Entre em contato com a Laxis para consultar esta OS.', 410);
    }
}

$fotosStmt = $pdo->prepare('SELECT id, caminho AS url, legenda FROM ordens_fotos WHERE ordem_id = ? ORDER BY id');
$fotosStmt->execute([$row['id']]);
$fotos = $fotosStmt->fetchAll();

$empresaStmt = $pdo->query(
    'SELECT nome, logo_url, endereco, cidade, uf, cep, telefone, email, cnpj, ie, im, engenheiro_nome, engenheiro_crea, garantia_padrao_interno
     FROM configuracoes WHERE id = 1'
);
$empresa = $empresaStmt->fetch() ?: [];

$orc = json_decode($row['orcamento'] ?: '{}', true) ?: [];
$pecas = $orc['pecas'] ?? [];
$subtotalPecas = array_sum(array_map(fn($p) => (float) ($p['preco'] ?? 0), $pecas));
$totalGeral = (float) ($orc['valorServico'] ?? 0) + $subtotalPecas + (float) ($orc['deslocamento'] ?? 0) - (float) ($orc['desconto'] ?? 0);

Response::ok([
    'numero' => $row['numero'],
    'status' => $row['status'],
    'dataEntrada' => $row['data_entrada'],
    'dataConclusao' => $row['data_conclusao'],
    'dataEntrega' => $row['data_entrega'],
    'cliente' => [
        'nome' => $row['cliente_nome'],
        'telefone' => $row['cliente_telefone'],
        'documento' => $row['cliente_documento'],
        'endereco' => trim(implode(', ', array_filter([$row['cliente_rua'], $row['cliente_numero']])))
            . ($row['cliente_bairro'] ? " — {$row['cliente_bairro']}" : '')
            . ($row['cliente_cidade'] ? ", {$row['cliente_cidade']}" : '')
            . ($row['cliente_estado'] ? "/{$row['cliente_estado']}" : ''),
    ],
    'equipamento' => [
        'tipo' => $row['tipo_nome'],
        'marca' => $row['equip_marca'],
        'modelo' => $row['equip_modelo'],
        'numeroSerie' => $row['equip_numero_serie'],
        'tensao' => $row['equip_tensao'],
        'dataFabricacao' => $row['equip_data_fabricacao'],
    ],
    'garantiaEquipamento' => $row['garantia_equipamento'],
    'observacoesGerais' => $row['observacoes_gerais'],
    'servico' => [
        'descricaoServico' => $orc['descricaoServico'] ?? '',
        'pecas' => $pecas,
        'valorServico' => $orc['valorServico'] ?? '',
        'deslocamento' => $orc['deslocamento'] ?? '',
        'desconto' => $orc['desconto'] ?? '',
        'formaPagamento' => $orc['formaPagamento'] ?? '',
        'aprovado' => $orc['aprovado'] ?? 'pendente',
        'subtotalPecas' => $subtotalPecas,
        'totalGeral' => $totalGeral,
    ],
    'fotos' => $fotos,
    'empresa' => [
        'nome' => $empresa['nome'] ?? '',
        'logoUrl' => $empresa['logo_url'] ?? '',
        'endereco' => $empresa['endereco'] ?? '',
        'cidade' => $empresa['cidade'] ?? '',
        'uf' => $empresa['uf'] ?? '',
        'cep' => $empresa['cep'] ?? '',
        'telefone' => $empresa['telefone'] ?? '',
        'email' => $empresa['email'] ?? '',
        'cnpj' => $empresa['cnpj'] ?? '',
        'ie' => $empresa['ie'] ?? '',
        'im' => $empresa['im'] ?? '',
        'engenheiroNome' => $empresa['engenheiro_nome'] ?? '',
        'engenheiroCrea' => $empresa['engenheiro_crea'] ?? '',
        'garantiaPadraoInterno' => $empresa['garantia_padrao_interno'] ?? '',
    ],
]);
