<?php
/**
 * equipamentos.php — GET / POST / PUT?id= / DELETE?id=
 * GET aceita ?clienteId= para filtrar por cliente.
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : null;

function formatarEquip(array $row): array {
    return [
        'id' => (int) $row['id'],
        'clienteId' => (int) $row['cliente_id'],
        'tipoEquipamentoId' => $row['tipo_equipamento_id'] !== null ? (int) $row['tipo_equipamento_id'] : null,
        'marca' => $row['marca'], 'modelo' => $row['modelo'], 'numeroSerie' => $row['numero_serie'],
        'patrimonio' => $row['patrimonio'], 'dataFabricacao' => $row['data_fabricacao'], 'tensao' => $row['tensao'],
        'ultimoContatoRenovacao' => $row['ultimo_contato_renovacao_data'] ? [
            'data' => $row['ultimo_contato_renovacao_data'],
            'referenciaUltimaPreventiva' => $row['ultimo_contato_renovacao_referencia'],
        ] : null,
    ];
}

if ($metodo === 'GET') {
    Auth::requirePermission('equipamentos.ver');
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM equipamentos WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) Response::error('Equipamento não encontrado.', 404);
        Response::ok(formatarEquip($row));
    }
    if (!empty($_GET['clienteId'])) {
        $stmt = $pdo->prepare('SELECT * FROM equipamentos WHERE cliente_id = ? ORDER BY id DESC');
        $stmt->execute([(int) $_GET['clienteId']]);
    } else {
        $stmt = $pdo->query('SELECT * FROM equipamentos ORDER BY id DESC');
    }
    Response::ok(array_map('formatarEquip', $stmt->fetchAll()));
}

if ($metodo === 'POST') {
    $user = Auth::requirePermission('equipamentos.gerenciar');
    $body = readJsonBody();
    if (empty($body['clienteId'])) Response::error('clienteId é obrigatório.', 400);

    $stmt = $pdo->prepare(
        'INSERT INTO equipamentos (cliente_id, tipo_equipamento_id, marca, modelo, numero_serie, patrimonio, data_fabricacao, tensao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        (int) $body['clienteId'], $body['tipoEquipamentoId'] ?: null, $body['marca'] ?? '', $body['modelo'] ?? '',
        $body['numeroSerie'] ?? '', $body['patrimonio'] ?? '', $body['dataFabricacao'] ?? '', $body['tensao'] ?? '',
    ]);
    $novoId = (int) $pdo->lastInsertId();
    Auth::log($user['id'], 'criar', 'equipamentos', $novoId, $body['marca'] ?? '');

    $stmt = $pdo->prepare('SELECT * FROM equipamentos WHERE id = ?');
    $stmt->execute([$novoId]);
    Response::ok(formatarEquip($stmt->fetch()));
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('equipamentos.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);
    $body = readJsonBody();

    // Ação especial: marcar contato de renovação de preventiva (sem precisar reenviar tudo)
    if (isset($body['marcarContatoRenovacao'])) {
        $stmt = $pdo->prepare('UPDATE equipamentos SET ultimo_contato_renovacao_data = CURDATE(), ultimo_contato_renovacao_referencia = ? WHERE id = ?');
        $stmt->execute([$body['marcarContatoRenovacao'], $id]);
        Auth::log($user['id'], 'editar', 'equipamentos', $id, 'contato de renovação');
        $stmt = $pdo->prepare('SELECT * FROM equipamentos WHERE id = ?');
        $stmt->execute([$id]);
        Response::ok(formatarEquip($stmt->fetch()));
    }

    $stmt = $pdo->prepare(
        'UPDATE equipamentos SET cliente_id = ?, tipo_equipamento_id = ?, marca = ?, modelo = ?, numero_serie = ?, patrimonio = ?, data_fabricacao = ?, tensao = ? WHERE id = ?'
    );
    $stmt->execute([
        (int) ($body['clienteId'] ?? 0), $body['tipoEquipamentoId'] ?: null, $body['marca'] ?? '', $body['modelo'] ?? '',
        $body['numeroSerie'] ?? '', $body['patrimonio'] ?? '', $body['dataFabricacao'] ?? '', $body['tensao'] ?? '', $id,
    ]);
    Auth::log($user['id'], 'editar', 'equipamentos', $id, $body['marca'] ?? '');

    $stmt = $pdo->prepare('SELECT * FROM equipamentos WHERE id = ?');
    $stmt->execute([$id]);
    Response::ok(formatarEquip($stmt->fetch()));
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('equipamentos.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);

    $vinculo = $pdo->prepare('SELECT COUNT(*) FROM ordens WHERE equipamento_id = ?');
    $vinculo->execute([$id]);
    if ((int) $vinculo->fetchColumn() > 0) {
        Response::error('Este equipamento tem ordens de serviço vinculadas.', 409);
    }

    $pdo->prepare('DELETE FROM equipamentos WHERE id = ?')->execute([$id]);
    Auth::log($user['id'], 'excluir', 'equipamentos', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
