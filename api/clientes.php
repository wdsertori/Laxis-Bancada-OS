<?php
/**
 * clientes.php — CRUD de clientes.
 *
 * GET    /api/clientes.php            -> lista todos
 * GET    /api/clientes.php?id=5       -> um cliente
 * POST   /api/clientes.php            -> cria (retorna o registro criado, com código gerado)
 * PUT    /api/clientes.php?id=5       -> atualiza
 * DELETE /api/clientes.php?id=5       -> exclui (bloqueado se tiver equipamento vinculado)
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : null;

if ($metodo === 'GET') {
    Auth::requirePermission('clientes.ver');
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM clientes WHERE id = ?');
        $stmt->execute([$id]);
        $cliente = $stmt->fetch();
        if (!$cliente) Response::error('Cliente não encontrado.', 404);
        Response::ok($cliente);
    }
    $rows = $pdo->query('SELECT * FROM clientes ORDER BY nome')->fetchAll();
    Response::ok($rows);
}

if ($metodo === 'POST') {
    $user = Auth::requirePermission('clientes.gerenciar');
    $body = readJsonBody();
    $nome = trim($body['nome'] ?? '');
    if ($nome === '') Response::error('Nome é obrigatório.', 400);

    $codigo = trim($body['codigo'] ?? '');
    if ($codigo === '') {
        $max = (int) $pdo->query('SELECT COALESCE(MAX(CAST(codigo AS UNSIGNED)), 0) FROM clientes')->fetchColumn();
        $codigo = str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO clientes (codigo, nome, tipo_pessoa, documento, telefone, email, endereco) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $codigo, $nome, $body['tipoPessoa'] ?? 'PF', $body['documento'] ?? '',
        $body['telefone'] ?? '', $body['email'] ?? '', $body['endereco'] ?? '',
    ]);
    $novoId = (int) $pdo->lastInsertId();
    Auth::log($user['id'], 'criar', 'clientes', $novoId, $nome);

    $stmt = $pdo->prepare('SELECT * FROM clientes WHERE id = ?');
    $stmt->execute([$novoId]);
    Response::ok($stmt->fetch());
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('clientes.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);
    $body = readJsonBody();

    $stmt = $pdo->prepare(
        'UPDATE clientes SET nome = ?, tipo_pessoa = ?, documento = ?, telefone = ?, email = ?, endereco = ? WHERE id = ?'
    );
    $stmt->execute([
        $body['nome'] ?? '', $body['tipoPessoa'] ?? 'PF', $body['documento'] ?? '',
        $body['telefone'] ?? '', $body['email'] ?? '', $body['endereco'] ?? '', $id,
    ]);
    Auth::log($user['id'], 'editar', 'clientes', $id, $body['nome'] ?? '');

    $stmt = $pdo->prepare('SELECT * FROM clientes WHERE id = ?');
    $stmt->execute([$id]);
    Response::ok($stmt->fetch());
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('clientes.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);

    $vinculo = $pdo->prepare('SELECT COUNT(*) FROM equipamentos WHERE cliente_id = ?');
    $vinculo->execute([$id]);
    if ((int) $vinculo->fetchColumn() > 0) {
        Response::error('Este cliente tem equipamentos cadastrados e não pode ser excluído.', 409);
    }

    $pdo->prepare('DELETE FROM clientes WHERE id = ?')->execute([$id]);
    Auth::log($user['id'], 'excluir', 'clientes', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
