<?php
/**
 * usuarios.php — gestão de usuários e papéis. Tudo aqui é 'gestao'-only,
 * inclusive ver a lista (Auth::requirePermission já barra o resto).
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : null;
$PAPEIS_VALIDOS = ['gestao', 'administrativo', 'tecnico'];

if ($metodo === 'GET') {
    // Modo restrito: nomes de todos os usuários ativos, para o campo "técnico
    // responsável" ao preencher uma OS — qualquer papel pode ser o responsável
    // por um atendimento, não só quem tem papel="tecnico". Quem só PODE VER
    // uma OS (inclusive técnico) também precisa dessa lista, não só quem cria.
    if (isset($_GET['apenas']) && $_GET['apenas'] === 'tecnicos') {
        Auth::requirePermission('ordens.ver');
        $rows = $pdo->query("SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome")->fetchAll();
        Response::ok($rows);
    }
    Auth::requirePermission('usuarios.ver');
    $rows = $pdo->query('SELECT id, nome, email, papel, ativo, criado_em FROM usuarios ORDER BY nome')->fetchAll();
    Response::ok($rows);
}

if ($metodo === 'POST') {
    $user = Auth::requirePermission('usuarios.gerenciar');
    $body = readJsonBody();
    $nome = trim($body['nome'] ?? '');
    $email = trim($body['email'] ?? '');
    $senha = (string) ($body['senha'] ?? '');
    $papel = $body['papel'] ?? 'tecnico';

    if ($nome === '' || $email === '' || $senha === '') Response::error('Nome, e-mail e senha são obrigatórios.', 400);
    if (strlen($senha) < 6) Response::error('A senha precisa ter pelo menos 6 caracteres.', 400);
    if (!in_array($papel, $PAPEIS_VALIDOS, true)) Response::error('Papel inválido.', 400);

    try {
        $stmt = $pdo->prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)');
        $stmt->execute([$nome, $email, password_hash($senha, PASSWORD_DEFAULT), $papel]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') Response::error('Já existe um usuário com esse e-mail.', 409);
        throw $e;
    }
    $novoId = (int) $pdo->lastInsertId();
    Auth::log($user['id'], 'criar', 'usuarios', $novoId, "{$nome} ({$papel})");

    Response::ok(['id' => $novoId, 'nome' => $nome, 'email' => $email, 'papel' => $papel, 'ativo' => 1]);
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('usuarios.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);
    $body = readJsonBody();

    $sets = ['nome = ?', 'email = ?', 'papel = ?', 'ativo = ?'];
    $papel = $body['papel'] ?? 'tecnico';
    if (!in_array($papel, $PAPEIS_VALIDOS, true)) Response::error('Papel inválido.', 400);
    $valores = [$body['nome'] ?? '', $body['email'] ?? '', $papel, !empty($body['ativo']) ? 1 : 0];

    if (!empty($body['senha'])) {
        if (strlen($body['senha']) < 6) Response::error('A senha precisa ter pelo menos 6 caracteres.', 400);
        $sets[] = 'senha_hash = ?';
        $valores[] = password_hash($body['senha'], PASSWORD_DEFAULT);
    }
    $valores[] = $id;

    $pdo->prepare('UPDATE usuarios SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($valores);
    Auth::log($user['id'], 'editar', 'usuarios', $id, $body['nome'] ?? '');

    $stmt = $pdo->prepare('SELECT id, nome, email, papel, ativo FROM usuarios WHERE id = ?');
    $stmt->execute([$id]);
    Response::ok($stmt->fetch());
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('usuarios.gerenciar');
    if (!$id) Response::error('Informe o id.', 400);
    if ($id === $user['id']) Response::error('Você não pode excluir seu próprio usuário.', 400);

    $pdo->prepare('DELETE FROM usuarios WHERE id = ?')->execute([$id]);
    Auth::log($user['id'], 'excluir', 'usuarios', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
