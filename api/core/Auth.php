<?php
/**
 * core/Auth.php
 * Login/sessão/permissões — o único lugar que sabe "quem pode o quê".
 * Qualquer módulo novo (estoque, financeiro, CRM...) só chama
 * Auth::requireLogin() / Auth::requirePermission() e pronto;
 * nada aqui precisa mudar quando um módulo novo é criado.
 */
class Auth
{
    private static PDO $pdo;
    private static array $permissions;

    public static function init(PDO $pdo): void
    {
        self::$pdo = $pdo;
        self::$permissions = require __DIR__ . '/permissions.php';
    }

    /** Autentica por e-mail/senha. Retorna os dados do usuário ou lança erro 401. */
    public static function login(string $email, string $senha): array
    {
        $stmt = self::$pdo->prepare('SELECT id, nome, email, senha_hash, papel, ativo FROM usuarios WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $usuario = $stmt->fetch();

        if (!$usuario || !$usuario['ativo'] || !password_verify($senha, $usuario['senha_hash'])) {
            self::log(null, 'login_falhou', 'usuarios', null, $email);
            Response::error('E-mail ou senha inválidos.', 401);
        }

        session_regenerate_id(true);
        $_SESSION['usuario_id'] = (int) $usuario['id'];
        $_SESSION['papel'] = $usuario['papel'];
        $_SESSION['nome'] = $usuario['nome'];

        self::log((int) $usuario['id'], 'login', 'usuarios', (int) $usuario['id'], '');

        unset($usuario['senha_hash']);
        return $usuario;
    }

    public static function logout(): void
    {
        if (self::currentUserId()) {
            self::log(self::currentUserId(), 'logout', 'usuarios', self::currentUserId(), '');
        }
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie('PHPSESSID', '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
    }

    public static function currentUserId(): ?int
    {
        return $_SESSION['usuario_id'] ?? null;
    }

    public static function currentUser(): ?array
    {
        $id = self::currentUserId();
        if (!$id) return null;
        return [
            'id' => $id,
            'nome' => $_SESSION['nome'] ?? '',
            'papel' => $_SESSION['papel'] ?? '',
        ];
    }

    /** Interrompe a requisição com 401 se ninguém estiver logado. */
    public static function requireLogin(): array
    {
        $user = self::currentUser();
        if (!$user) {
            Response::error('Sessão expirada ou inexistente. Faça login novamente.', 401);
        }
        return $user;
    }

    /**
     * Interrompe a requisição com 403 se o papel atual não tiver a
     * permissão pedida. Chame sempre requireLogin() antes (ou use
     * junto, como abaixo) — sem sessão não há papel pra checar.
     */
    public static function requirePermission(string $chave): array
    {
        $user = self::requireLogin();
        $papeis = self::$permissions[$chave] ?? null;
        if ($papeis === null) {
            error_log("Permissão desconhecida checada: {$chave}");
            Response::error('Permissão não configurada.', 500);
        }
        if (!in_array($user['papel'], $papeis, true)) {
            Response::error('Você não tem permissão para esta ação.', 403);
        }
        return $user;
    }

    /** Grava uma linha de auditoria. Nunca deixa a API cair se isso falhar. */
    public static function log(?int $usuarioId, string $acao, string $entidade, ?int $entidadeId, string $detalhes = ''): void
    {
        try {
            $stmt = self::$pdo->prepare(
                'INSERT INTO logs (usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?, ?, ?, ?, ?)'
            );
            $stmt->execute([$usuarioId, $acao, $entidade, $entidadeId, mb_substr($detalhes, 0, 255)]);
        } catch (Throwable $e) {
            error_log('Falha ao gravar log: ' . $e->getMessage());
        }
    }
}
