<?php
/**
 * auth.php — POST (login), GET (usuário atual), DELETE (logout)
 *
 * POST  /api/auth.php   body: {"email": "...", "senha": "..."}
 * GET   /api/auth.php   -> usuário da sessão atual, ou null
 * DELETE /api/auth.php  -> encerra a sessão
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];

if ($metodo === 'POST') {
    $body = readJsonBody();
    $email = trim($body['email'] ?? '');
    $senha = (string) ($body['senha'] ?? '');
    if ($email === '' || $senha === '') {
        Response::error('Informe e-mail e senha.', 400);
    }
    $usuario = Auth::login($email, $senha);
    Response::ok($usuario);
}

if ($metodo === 'GET') {
    Response::ok(Auth::currentUser());
}

if ($metodo === 'DELETE') {
    Auth::logout();
    Response::ok(null);
}

Response::error('Método não suportado.', 405);
