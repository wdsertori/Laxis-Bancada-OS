<?php
/**
 * fotos.php — upload e exclusão de fotos de uma OS.
 * Arquivo fica em /api/uploads/ordens/{numero da OS}/, só o caminho vai pro banco.
 *
 * POST   /api/fotos.php   multipart/form-data: ordemId, legenda, foto (arquivo)
 * DELETE /api/fotos.php?id=123
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$TIPOS_AVISO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
$TAMANHO_MAX = 8 * 1024 * 1024; // 8MB

if ($metodo === 'POST') {
    $user = Auth::requirePermission('ordens.fotos.gerenciar');

    $ordemId = (int) ($_POST['ordemId'] ?? 0);
    if (!$ordemId) Response::error('ordemId é obrigatório.', 400);

    $stmt = $pdo->prepare('SELECT numero FROM ordens WHERE id = ?');
    $stmt->execute([$ordemId]);
    $ordem = $stmt->fetch();
    if (!$ordem) Response::error('OS não encontrada.', 404);

    if (empty($_FILES['foto']) || $_FILES['foto']['error'] !== UPLOAD_ERR_OK) {
        Response::error('Envie o arquivo no campo "foto".', 400);
    }
    $arquivo = $_FILES['foto'];
    if ($arquivo['size'] > $TAMANHO_MAX) Response::error('Arquivo maior que 8MB.', 400);

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $arquivo['tmp_name']);
    finfo_close($finfo);
    if (!in_array($mime, $TIPOS_AVISO, true)) Response::error('Envie apenas imagens (jpg, png, webp, gif).', 400);

    $extensoes = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
    $ext = $extensoes[$mime];
    $nomeArquivo = bin2hex(random_bytes(8)) . '.' . $ext;

    $pastaRelativa = 'uploads/ordens/' . preg_replace('/[^A-Za-z0-9\-]/', '', $ordem['numero']);
    $pastaAbsoluta = __DIR__ . '/' . $pastaRelativa;
    if (!is_dir($pastaAbsoluta)) mkdir($pastaAbsoluta, 0755, true);

    if (!move_uploaded_file($arquivo['tmp_name'], $pastaAbsoluta . '/' . $nomeArquivo)) {
        Response::error('Falha ao salvar o arquivo no servidor.', 500);
    }

    $caminhoPublico = $pastaRelativa . '/' . $nomeArquivo;
    $stmt = $pdo->prepare('INSERT INTO ordens_fotos (ordem_id, caminho, legenda) VALUES (?, ?, ?)');
    $stmt->execute([$ordemId, $caminhoPublico, $_POST['legenda'] ?? '']);
    $novoId = (int) $pdo->lastInsertId();
    Auth::log($user['id'], 'criar', 'ordens_fotos', $novoId, $ordem['numero']);

    Response::ok(['id' => $novoId, 'url' => $caminhoPublico, 'legenda' => $_POST['legenda'] ?? '']);
}

if ($metodo === 'DELETE') {
    $user = Auth::requirePermission('ordens.fotos.gerenciar');
    $id = (int) ($_GET['id'] ?? 0);
    if (!$id) Response::error('Informe o id.', 400);

    $stmt = $pdo->prepare('SELECT caminho FROM ordens_fotos WHERE id = ?');
    $stmt->execute([$id]);
    $foto = $stmt->fetch();
    if (!$foto) Response::error('Foto não encontrada.', 404);

    $caminhoAbsoluto = __DIR__ . '/' . $foto['caminho'];
    if (is_file($caminhoAbsoluto)) unlink($caminhoAbsoluto);

    $pdo->prepare('DELETE FROM ordens_fotos WHERE id = ?')->execute([$id]);
    Auth::log($user['id'], 'excluir', 'ordens_fotos', $id, '');
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
