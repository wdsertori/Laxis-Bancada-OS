<?php
/**
 * config/database.php
 *
 * PREENCHA com os dados do seu banco MySQL do HostGator (cPanel > MySQL Databases)
 * e faça upload SEM o nome ".example" — ou seja, este arquivo deve se chamar
 * exatamente "database.php" no servidor. Ele nunca deve ser exposto publicamente:
 * o .htaccess da pasta /api/config já bloqueia acesso direto por navegador.
 */

// Normalmente no HostGator o usuário/banco vêm prefixados, ex: "laxis_bancada"
define('DB_HOST', 'localhost');
define('DB_NAME', 'seuusuario_bancada');
define('DB_USER', 'seuusuario_bancada');
define('DB_PASS', 'SUA_SENHA_AQUI');
define('DB_CHARSET', 'utf8mb4');
