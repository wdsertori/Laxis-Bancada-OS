<?php
/**
 * parametros.php — configurações operacionais (não aparecem em documento).
 * GET / PUT — os dois só para gestão. Sempre em camelCase pro front.
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$map = [
    'intervaloPreventivoMeses' => 'intervalo_preventivo_meses', 'mensagemRenovacao' => 'mensagem_renovacao',
    'custodiaDiasAlerta' => 'custodia_dias_alerta', 'custodiaDiasLimite' => 'custodia_dias_limite',
];

function buscarParametros(PDO $pdo, array $map): array {
    $colunas = array_values($map);
    $stmt = $pdo->query('SELECT ' . implode(', ', $colunas) . ' FROM configuracoes WHERE id = 1');
    $row = $stmt->fetch();
    $out = [];
    foreach ($map as $jsKey => $coluna) $out[$jsKey] = $row[$coluna];
    return $out;
}

if ($metodo === 'GET') {
    Auth::requirePermission('parametros.ver');
    Response::ok(buscarParametros($pdo, $map));
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('parametros.editar');
    $body = readJsonBody();
    $sets = [];
    $valores = [];
    foreach ($map as $jsKey => $coluna) {
        if (array_key_exists($jsKey, $body)) {
            $sets[] = "{$coluna} = ?";
            $valores[] = $body[$jsKey];
        }
    }
    if ($sets) {
        $pdo->prepare('UPDATE configuracoes SET ' . implode(', ', $sets) . ' WHERE id = 1')->execute($valores);
        Auth::log($user['id'], 'editar', 'configuracoes', 1, 'parâmetros');
    }
    Response::ok(buscarParametros($pdo, $map));
}

Response::error('Método não suportado.', 405);
