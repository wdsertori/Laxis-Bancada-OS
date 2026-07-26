<?php
/**
 * setup-admin.php — rode UMA VEZ pelo navegador, depois APAGUE este arquivo.
 *
 * Cria o primeiro usuário "gestão", com senha corretamente gerada pelo
 * password_hash() do SEU servidor (por isso não vem pronto no schema.sql —
 * eu não tenho como rodar PHP daqui pra garantir que um hash pronto bateria).
 *
 * Acesse: https://os.laxis.com.br/api/setup-admin.php
 * Troque o e-mail/senha abaixo antes de subir o arquivo, se quiser.
 */
require_once __DIR__ . '/config/database.php';

$nome  = 'Administrador';
$email = 'gestao@laxis.com.br';
$senha = 'trocar123'; // troque aqui antes de rodar, e troque de novo depois pelo sistema

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET,
        DB_USER,
        DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    $existe = $pdo->prepare('SELECT id FROM usuarios WHERE email = ?');
    $existe->execute([$email]);
    if ($existe->fetch()) {
        echo "Já existe um usuário com esse e-mail. Nada foi alterado.";
        exit;
    }

    $hash = password_hash($senha, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)');
    $stmt->execute([$nome, $email, $hash, 'gestao']);

    echo "Usuário gestão criado com sucesso: {$email}<br>";
    echo "<strong>Apague este arquivo (setup-admin.php) do servidor agora.</strong>";
} catch (Throwable $e) {
    http_response_code(500);
    echo "Erro: " . htmlspecialchars($e->getMessage());
}
