<?php
/**
 * empresa.php — dados da empresa que aparecem nos documentos impressos.
 * GET (qualquer papel logado) / PUT (só gestão).
 * Sempre entra/sai em camelCase pro front, mesmo com colunas snake_case no banco.
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
$map = [
    'nome' => 'nome', 'logoUrl' => 'logo_url', 'endereco' => 'endereco', 'cidade' => 'cidade', 'uf' => 'uf',
    'cep' => 'cep', 'telefone' => 'telefone', 'email' => 'email', 'cnpj' => 'cnpj', 'ie' => 'ie', 'im' => 'im',
    'engenheiroNome' => 'engenheiro_nome', 'engenheiroCrea' => 'engenheiro_crea',
    'garantiaPadraoInterno' => 'garantia_padrao_interno', 'garantiaPadraoExterno' => 'garantia_padrao_externo',
    'custodiaPolitica' => 'custodia_politica',
];

function buscarEmpresa(PDO $pdo, array $map): array {
    $colunas = array_values($map);
    $stmt = $pdo->query('SELECT ' . implode(', ', $colunas) . ' FROM configuracoes WHERE id = 1');
    $row = $stmt->fetch();
    $out = [];
    foreach ($map as $jsKey => $coluna) $out[$jsKey] = $row[$coluna];
    return $out;
}

if ($metodo === 'GET') {
    Auth::requirePermission('empresa.ver');
    Response::ok(buscarEmpresa($pdo, $map));
}

if ($metodo === 'PUT') {
    $user = Auth::requirePermission('empresa.editar');
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
        Auth::log($user['id'], 'editar', 'configuracoes', 1, 'dados da empresa');
    }
    Response::ok(buscarEmpresa($pdo, $map));
}

Response::error('Método não suportado.', 405);
