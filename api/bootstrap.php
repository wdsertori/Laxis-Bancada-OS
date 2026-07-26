<?php
/**
 * bootstrap.php
 * Incluído no topo de todo endpoint. Abre sessão, conecta ao banco,
 * configura headers e disponibiliza helpers pequenos usados em todo lugar.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0'); // nunca mostrar erro PHP cru pro navegador em produção
ini_set('log_errors', '1');

// ---- sessão (mesma origem: front e /api no mesmo domínio os.laxis.com.br) ----
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
if (!empty($_SERVER['HTTPS'])) {
    ini_set('session.cookie_secure', '1');
}
session_start();

// ---- headers padrão ----
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Se algum dia o front rodar em subdomínio separado, ajuste aqui a origem
// e troque para credentials 'include' + Access-Control-Allow-Credentials.
// Como o padrão é mesma origem, isso fica desligado por padrão.

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/core/Response.php';
require_once __DIR__ . '/core/Auth.php';

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET,
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (PDOException $e) {
    error_log('Falha de conexão com banco: ' . $e->getMessage());
    Response::error('Erro de conexão com o banco de dados.', 500);
}

/** Lê o corpo JSON da requisição (POST/PUT) como array associativo. */
function readJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        Response::error('JSON inválido no corpo da requisição.', 400);
    }
    return $data ?? [];
}

Auth::init($pdo);
