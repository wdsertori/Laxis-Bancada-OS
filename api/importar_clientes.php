<?php
/**
 * importar_clientes.php — importação em massa de clientes a partir de planilha.
 *
 * POST /api/importar_clientes.php
 * Body: { linhas: [{ codigo, nome, apelido, documento, contato, telefone, email,
 *                     cep, rua, numero, complemento, bairro, cidade, estado,
 *                     atuacao, comoFicouSabendo, observacoes, dataCadastro }, ...] }
 *
 * Cliente é buscado por código (se informado — mais seguro contra nomes
 * duplicados/parecidos) ou por nome; se encontrado, é atualizado em vez de
 * duplicado. Sem código nem nome batendo, cria um cliente novo.
 */
require_once __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método não suportado.', 405);
}

$user = Auth::requirePermission('dados.importar');
$body = readJsonBody();
$linhas = $body['linhas'] ?? [];

if (!is_array($linhas) || count($linhas) === 0) {
    Response::error('Nenhuma linha para importar.', 400);
}

function valorCliente(array $linha, string $campo): string {
    return trim((string) ($linha[$campo] ?? ''));
}

$avisos = [];
$criados = 0;
$atualizados = 0;

$pdo->beginTransaction();

try {
    $stmtPorCodigo = $pdo->prepare('SELECT id FROM clientes WHERE codigo = ? LIMIT 1');
    $stmtPorNome = $pdo->prepare('SELECT id FROM clientes WHERE LOWER(nome) = LOWER(?) LIMIT 1');
    $proximoCodigo = (int) $pdo->query('SELECT COALESCE(MAX(CAST(codigo AS UNSIGNED)), 0) FROM clientes')->fetchColumn();

    $stmtInsere = $pdo->prepare(
        'INSERT INTO clientes (codigo, nome, tipo_pessoa, documento, apelido, contato, telefone, email,
            cep, rua, numero, complemento, bairro, cidade, estado, atuacao, como_ficou_sabendo, observacoes, data_cadastro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmtAtualiza = $pdo->prepare(
        'UPDATE clientes SET documento = ?, apelido = ?, contato = ?, telefone = ?, email = ?,
            cep = ?, rua = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, estado = ?,
            atuacao = ?, como_ficou_sabendo = ?, observacoes = ?, data_cadastro = COALESCE(data_cadastro, ?)
         WHERE id = ?'
    );

    foreach ($linhas as $i => $linha) {
        $numeroLinha = $i + 2;
        try {
            if (!is_array($linha)) { continue; }
            $nome = valorCliente($linha, 'nome');
            if ($nome === '') {
                $avisos[] = "Linha {$numeroLinha}: sem nome — ignorada.";
                continue;
            }

            $codigoLinha = valorCliente($linha, 'codigo');
            $documento = valorCliente($linha, 'documento');
            $apelido = valorCliente($linha, 'apelido');
            $contato = valorCliente($linha, 'contato');
            $telefone = valorCliente($linha, 'telefone');
            $email = valorCliente($linha, 'email');
            $cep = valorCliente($linha, 'cep');
            $rua = valorCliente($linha, 'rua');
            $numero = valorCliente($linha, 'numero');
            $complemento = valorCliente($linha, 'complemento');
            $bairro = valorCliente($linha, 'bairro');
            $cidade = valorCliente($linha, 'cidade');
            $estado = valorCliente($linha, 'estado');
            $atuacao = valorCliente($linha, 'atuacao');
            $comoFicouSabendo = valorCliente($linha, 'comoFicouSabendo');
            $observacoes = valorCliente($linha, 'observacoes');
            $dataCadastro = valorCliente($linha, 'dataCadastro') ?: null;

            // Código tem prioridade (evita atualizar o cliente errado quando
            // há nomes iguais/parecidos); sem código, cai pra busca por nome.
            $existenteId = null;
            if ($codigoLinha !== '') {
                $stmtPorCodigo->execute([$codigoLinha]);
                $existenteId = $stmtPorCodigo->fetchColumn() ?: null;
                if (!$existenteId) {
                    $avisos[] = "Linha {$numeroLinha}: código '{$codigoLinha}' não encontrado — tentando por nome.";
                }
            }
            if (!$existenteId) {
                $stmtPorNome->execute([$nome]);
                $existenteId = $stmtPorNome->fetchColumn() ?: null;
            }

            if ($existenteId) {
                $stmtAtualiza->execute([
                    $documento, $apelido, $contato, $telefone, $email,
                    $cep, $rua, $numero, $complemento, $bairro, $cidade, $estado,
                    $atuacao, $comoFicouSabendo, $observacoes, $dataCadastro,
                    $existenteId,
                ]);
                $atualizados++;
            } else {
                $proximoCodigo++;
                $codigo = str_pad((string) $proximoCodigo, 4, '0', STR_PAD_LEFT);
                $stmtInsere->execute([
                    $codigo, $nome, 'PF', $documento, $apelido, $contato, $telefone, $email,
                    $cep, $rua, $numero, $complemento, $bairro, $cidade, $estado,
                    $atuacao, $comoFicouSabendo, $observacoes, $dataCadastro,
                ]);
                $criados++;
            }
        } catch (Throwable $e) {
            $avisos[] = "Linha {$numeroLinha}: erro — " . $e->getMessage();
        }
    }

    $pdo->commit();
    Auth::log($user['id'], 'importar', 'clientes', null, "{$criados} criados, {$atualizados} atualizados via planilha");

    Response::ok([
        'linhasProcessadas' => count($linhas),
        'clientesCriados' => $criados,
        'clientesAtualizados' => $atualizados,
        'avisos' => $avisos,
    ]);
} catch (Throwable $e) {
    $pdo->rollBack();
    error_log('Falha na importação de clientes: ' . $e->getMessage());
    Response::error('Falha na importação: ' . $e->getMessage(), 500);
}
