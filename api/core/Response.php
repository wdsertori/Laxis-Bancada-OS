<?php
/**
 * core/Response.php
 * Padroniza toda resposta da API em JSON, incluindo erros.
 */
class Response
{
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function ok($data = null): void
    {
        self::json(['ok' => true, 'data' => $data], 200);
    }

    public static function error(string $mensagem, int $status = 400): void
    {
        self::json(['ok' => false, 'erro' => $mensagem], $status);
    }
}
