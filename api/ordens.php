<?php
/**
 * ordens.php — GET / POST / PUT?id= / DELETE?id=
 * Checklists e orçamento trafegam como objetos/arrays normais no JSON
 * do corpo da requisição; aqui dentro são serializados pra TEXT.
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : null;

function formatarOrdem(PDO $pdo, array $row): array {
    $fotosStmt = $pdo->prepare('SELECT id, caminho AS url, legenda FROM ordens_fotos WHERE ordem_id = ? ORDER BY id');
    $fotosStmt->execute([$row['id']]);

    return [
        'id' => (int) $row['id'],
        'numero' => $row['numero'],
        'clienteId' => (int) $row['cliente_id'],
        'equipamentoId' => (int) $row['equipamento_id'],
        'tipoAtendimento' => $row['tipo_atendimento'],
        'dataEntrada' => $row['data_entrada'],
        'origem' => $row['origem'],
        'tipoManutencao' => $row['tipo_manutencao'],
        'tecnico' => $row['tecnico'],
        'status' => $row['status'],
        'horaInicio' => $row['hora_inicio'],
        'horaFim' => $row['hora_fim'],
        'observacoesGerais' => $row['observacoes_gerais'],
        'garantiaEquipamento' => $row['garantia_equipamento'],
        'dataConclusao' => $row['data_conclusao'],
        'dataEntrega' => $row['data_entrega'],
        'checklistEntrada' => json_decode($row['checklist_entrada'] ?? '[]', true) ?? [],
        'checklistPreOrcamento' => json_decode($row['checklist_pre_orcamento'] ?? '[]', true) ?? [],
        'checklistPosOrcamento' => json_decode($row['checklist_pos_orcamento'] ?? '[]', true) ?? [],
        'checklistAtendimento' => json_decode($row['checklist_atendimento'] ?? '[]', true) ?? [],
        'orcamento' => json_decode($row['orcamento'] ?? '{}', true) ?: new stdClass(),
        'fotos' => $fotosStmt->fetchAll(),
    ];
}

if ($metodo === 'GET') {
    Auth::requirePermission('ordens.ver');
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM ordens WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) Response::error('OS não encontrada.', 404);
        Response::ok(formatarOrdem($pdo, $row));
    }
    $rows = $pdo->query('SELECT * FROM ordens ORDER BY data_entrada DESC, id DESC')->fetchAll();
    Response::ok(array_map(fn($r) => formatarOrdem($pdo, $r), $rows));
}

if ($metodo === 'POST') {
    $user = Auth::requirePermission('ordens.criar');
    $body = readJsonBody();
    if (empty($body['clienteId']) || empty($body['equipamentoId'])) {
        Response::error('clienteId e equipamentoId são obrigatórios.', 400);
    }

    // número sequencial OS-0001, respeitando o maior já usado
    $max = (int) $pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(numero, 4) AS UNSIGNED)), 0) FROM ordens")->fetchColumn();
    $numero = 'OS-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);

    $stmt = $pdo->prepare(
        'INSERT INTO ordens (numero, cliente_id, equipamento_id, tipo_atendimento, data_entrada, origem, tipo_manutencao,
            tecnico, status, observacoes_gerais, garantia_equipamento, checklist_entrada, checklist_pre_orcamento,
            checklist_pos_orcamento, checklist_atendimento, orcamento, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $numero, (int) $body['clienteId'], (int) $body['equipamentoId'],
        $body['tipoAtendimento'] ?? 'interno', $body['dataEntrada'] ?? date('Y-m-d'),
        $body['origem'] ?? 'cliente_trouxe', $body['tipoManutencao'] ?? 'preventiva', $body['tecnico'] ?? '',
        'recebido', $body['observacoesGerais'] ?? '', 'nao_informado',
        json_encode($body['checklistEntrada'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistPreOrcamento'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistPosOrcamento'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistAtendimento'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['orcamento'] ?? ['descricaoServico' => '', 'valorServico' => '', 'pecas' => [], 'deslocamento' => '', 'desconto' => '', 'formaPagamento' => '', 'aprovado' => 'pendente', 'obsInternas' => ''], JSON_UNESCAPED_UNICODE),
        $user['id'],
    ]);
    $novoId = (int) $pdo->lastInsertId();
    Auth::log($user['id'], 'criar', 'ordens', $novoId, $numero);

    $stmt = $pdo->prepare('SELECT * FROM ordens WHERE id = ?');
    $stmt->execute([$novoId]);
    Response::ok(formatarOrdem($pdo, $stmt->fetch()));
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('ordens.editar');
    if (!$id) Response::error('Informe o id.', 400);
    $body = readJsonBody();

    // orçamento só pode ser alterado por quem tem a permissão específica
    if (array_key_exists('orcamento', $body)) {
        Auth::requirePermission('ordens.orcamento.editar');
    }

    $map = [
        'tipoAtendimento' => 'tipo_atendimento', 'dataEntrada' => 'data_entrada', 'origem' => 'origem',
        'tipoManutencao' => 'tipo_manutencao', 'tecnico' => 'tecnico', 'status' => 'status',
        'horaInicio' => 'hora_inicio', 'horaFim' => 'hora_fim', 'observacoesGerais' => 'observacoes_gerais',
        'garantiaEquipamento' => 'garantia_equipamento', 'dataConclusao' => 'data_conclusao', 'dataEntrega' => 'data_entrega',
    ];
    $jsonMap = [
        'checklistEntrada' => 'checklist_entrada', 'checklistPreOrcamento' => 'checklist_pre_orcamento',
        'checklistPosOrcamento' => 'checklist_pos_orcamento', 'checklistAtendimento' => 'checklist_atendimento',
        'orcamento' => 'orcamento',
    ];

    $sets = [];
    $valores = [];
    foreach ($map as $jsKey => $coluna) {
        if (array_key_exists($jsKey, $body)) { $sets[] = "{$coluna} = ?"; $valores[] = $body[$jsKey] ?: null; }
    }
    foreach ($jsonMap as $jsKey => $coluna) {
        if (array_key_exists($jsKey, $body)) { $sets[] = "{$coluna} = ?"; $valores[] = json_encode($body[$jsKey], JSON_UNESCAPED_UNICODE); }
    }

    if ($sets) {
        $valores[] = $id;
        $pdo->prepare('UPDATE ordens SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($valores);
        Auth::log($user['id'], 'editar', 'ordens', $id, '');
    }

    $stmt = $pdo->prepare('SELECT * FROM ordens WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) Response::error('OS não encontrada.', 404);
    Response::ok(formatarOrdem($pdo, $row));
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('ordens.excluir');
    if (!$id) Response::error('Informe o id.', 400);
    $pdo->prepare('DELETE FROM ordens WHERE id = ?')->execute([$id]); // fotos somem junto (ON DELETE CASCADE)
    Auth::log($user['id'], 'excluir', 'ordens', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
