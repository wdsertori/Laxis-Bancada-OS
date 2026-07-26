<?php
/**
 * tipos_equipamento.php — catálogo de tipos, cada um com 3 checklists-modelo.
 * GET / POST / PUT?id= / DELETE?id=
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : null;

function formatarTipo(array $row): array {
    $row['checklistEntradaPadrao'] = json_decode($row['checklist_entrada_padrao'] ?? '[]', true) ?? [];
    $row['checklistPrePadrao'] = json_decode($row['checklist_pre_padrao'] ?? '[]', true) ?? [];
    $row['checklistPosPadrao'] = json_decode($row['checklist_pos_padrao'] ?? '[]', true) ?? [];
    $row['intervaloPreventivoMeses'] = $row['intervalo_preventivo_meses'];
    unset($row['checklist_entrada_padrao'], $row['checklist_pre_padrao'], $row['checklist_pos_padrao'], $row['intervalo_preventivo_meses']);
    return $row;
}

if ($metodo === 'GET') {
    Auth::requirePermission('tipos_equipamento.ver');
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM tipos_equipamento WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) Response::error('Tipo não encontrado.', 404);
        Response::ok(formatarTipo($row));
    }
    $rows = $pdo->query('SELECT * FROM tipos_equipamento ORDER BY nome')->fetchAll();
    Response::ok(array_map('formatarTipo', $rows));
}

if ($metodo === 'POST') {
    $user = Auth::requirePermission('tipos_equipamento.gerenciar');
    $body = readJsonBody();
    $nome = trim($body['nome'] ?? '');
    if ($nome === '') Response::error('Nome é obrigatório.', 400);

    $stmt = $pdo->prepare(
        'INSERT INTO tipos_equipamento (nome, intervalo_preventivo_meses, checklist_entrada_padrao, checklist_pre_padrao, checklist_pos_padrao) VALUES (?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $nome,
        $body['intervaloPreventivoMeses'] ?: null,
        json_encode($body['checklistEntradaPadrao'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistPrePadrao'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistPosPadrao'] ?? [], JSON_UNESCAPED_UNICODE),
    ]);
    $novoId = (int) $pdo->lastInsertId();
    Auth::log($user['id'], 'criar', 'tipos_equipamento', $novoId, $nome);

    $stmt = $pdo->prepare('SELECT * FROM tipos_equipamento WHERE id = ?');
    $stmt->execute([$novoId]);
    Response::ok(formatarTipo($stmt->fetch()));
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('tipos_equipamento.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);
    $body = readJsonBody();

    $stmt = $pdo->prepare(
        'UPDATE tipos_equipamento SET nome = ?, intervalo_preventivo_meses = ?, checklist_entrada_padrao = ?, checklist_pre_padrao = ?, checklist_pos_padrao = ? WHERE id = ?'
    );
    $stmt->execute([
        $body['nome'] ?? '',
        $body['intervaloPreventivoMeses'] ?: null,
        json_encode($body['checklistEntradaPadrao'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistPrePadrao'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($body['checklistPosPadrao'] ?? [], JSON_UNESCAPED_UNICODE),
        $id,
    ]);
    Auth::log($user['id'], 'editar', 'tipos_equipamento', $id, $body['nome'] ?? '');

    $stmt = $pdo->prepare('SELECT * FROM tipos_equipamento WHERE id = ?');
    $stmt->execute([$id]);
    Response::ok(formatarTipo($stmt->fetch()));
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('tipos_equipamento.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);

    $vinculo = $pdo->prepare('SELECT COUNT(*) FROM equipamentos WHERE tipo_equipamento_id = ?');
    $vinculo->execute([$id]);
    if ((int) $vinculo->fetchColumn() > 0) {
        Response::error('Existem equipamentos cadastrados com este tipo.', 409);
    }

    $pdo->prepare('DELETE FROM tipos_equipamento WHERE id = ?')->execute([$id]);
    Auth::log($user['id'], 'excluir', 'tipos_equipamento', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
