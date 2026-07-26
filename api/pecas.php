<?php
/**
 * pecas.php — catálogo de peças. GET / upsert (POST faz upsert por descrição).
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : null;

if ($metodo === 'GET') {
    Auth::requirePermission('pecas.ver');
    $rows = $pdo->query('SELECT * FROM pecas_catalogo ORDER BY descricao')->fetchAll();
    Response::ok($rows);
}

if ($metodo === 'POST') {
    // upsert: usado tanto ao cadastrar peça nova quanto ao atualizar preço de uma existente
    $user = Auth::requirePermission('pecas.gerenciar');
    $body = readJsonBody();
    $descricao = trim($body['descricao'] ?? '');
    if ($descricao === '') Response::error('Descrição é obrigatória.', 400);
    $preco = $body['preco'] ?? 0;

    $stmt = $pdo->prepare(
        'INSERT INTO pecas_catalogo (descricao, preco) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE preco = VALUES(preco)'
    );
    $stmt->execute([$descricao, $preco]);
    Auth::log($user['id'], 'criar_ou_editar', 'pecas_catalogo', null, $descricao);

    $stmt = $pdo->prepare('SELECT * FROM pecas_catalogo WHERE descricao = ?');
    $stmt->execute([$descricao]);
    Response::ok($stmt->fetch());
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('pecas.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);
    $pdo->prepare('DELETE FROM pecas_catalogo WHERE id = ?')->execute([$id]);
    Auth::log($user['id'], 'excluir', 'pecas_catalogo', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
