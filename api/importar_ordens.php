<?php
/**
 * importar_ordens.php — importação em massa de OS a partir de uma planilha.
 *
 * POST /api/importar_ordens.php
 * Body: {
 *   linhas: [{ clienteNome, clienteDocumento, clienteTelefone, clienteEmail,
 *              equipamentoTipoNome, equipamentoMarca, equipamentoModelo, equipamentoNumeroSerie, equipamentoPatrimonio,
 *              numero, dataEntrada, dataConclusao, dataEntrega, status, tipoManutencao, tipoAtendimento,
 *              tecnico, observacoesGerais }, ...],
 *   tipoEquipamentoPadraoId: int|null
 * }
 *
 * Para cada linha: encontra ou cria o cliente (por nome), encontra ou cria o
 * equipamento (por número de série, ou marca+modelo, dentro do mesmo cliente),
 * e insere a OS diretamente (sem forçar status "recebido" como o POST normal
 * de ordens.php faz — aqui o status/datas vêm da própria planilha, porque é
 * dado histórico). Uma linha com erro não derruba o restante da importação.
 */
require_once __DIR__ . '/bootstrap.php';

$metodo = $_SERVER['REQUEST_METHOD'];
if ($metodo !== 'POST') {
    Response::error('Método não suportado.', 405);
}

$user = Auth::requirePermission('dados.importar');
$body = readJsonBody();
$linhas = $body['linhas'] ?? [];
$tipoPadraoId = !empty($body['tipoEquipamentoPadraoId']) ? (int) $body['tipoEquipamentoPadraoId'] : null;

if (!is_array($linhas) || count($linhas) === 0) {
    Response::error('Nenhuma linha para importar.', 400);
}

function valor(array $linha, string $campo): string {
    return trim((string) ($linha[$campo] ?? ''));
}

$avisos = [];
$criadosClientes = 0;
$criadosEquipamentos = 0;
$criadasOrdens = 0;

$pdo->beginTransaction();

try {
    // próximo número sequencial de OS, calculado uma vez e incrementado em memória
    $proximoSeq = (int) $pdo->query(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(numero, 4) AS UNSIGNED)), 0) FROM ordens"
    )->fetchColumn();

    $stmtClientePorNome = $pdo->prepare('SELECT id FROM clientes WHERE LOWER(nome) = LOWER(?) LIMIT 1');
    $stmtInsereCliente = $pdo->prepare(
        'INSERT INTO clientes (codigo, nome, tipo_pessoa, documento, telefone, email) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmtMaxCodigo = $pdo->query('SELECT COALESCE(MAX(CAST(codigo AS UNSIGNED)), 0) FROM clientes');
    $proximoCodigoCliente = (int) $stmtMaxCodigo->fetchColumn();

    $stmtTipoPorNome = $pdo->prepare('SELECT id FROM tipos_equipamento WHERE LOWER(nome) = LOWER(?) LIMIT 1');

    $stmtEquipPorSerie = $pdo->prepare('SELECT id FROM equipamentos WHERE cliente_id = ? AND numero_serie = ? AND numero_serie <> \'\' LIMIT 1');
    $stmtEquipPorMarcaModelo = $pdo->prepare('SELECT id FROM equipamentos WHERE cliente_id = ? AND marca = ? AND modelo = ? LIMIT 1');
    $stmtInsereEquip = $pdo->prepare(
        'INSERT INTO equipamentos (cliente_id, tipo_equipamento_id, marca, modelo, numero_serie, patrimonio, data_fabricacao, tensao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    $stmtNumeroExiste = $pdo->prepare('SELECT COUNT(*) FROM ordens WHERE numero = ?');
    $orcamentoPadrao = json_encode(
        ['descricaoServico' => '', 'valorServico' => '', 'pecas' => [], 'deslocamento' => '', 'desconto' => '', 'formaPagamento' => '', 'aprovado' => 'pendente', 'obsInternas' => ''],
        JSON_UNESCAPED_UNICODE
    );
    $stmtInsereOrdem = $pdo->prepare(
        'INSERT INTO ordens (numero, cliente_id, equipamento_id, tipo_atendimento, data_entrada, origem, tipo_manutencao,
            tecnico, status, observacoes_gerais, garantia_equipamento, data_conclusao, data_entrega,
            checklist_entrada, checklist_pre_orcamento, checklist_pos_orcamento, checklist_atendimento, orcamento, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    foreach ($linhas as $i => $linha) {
        $numeroLinha = $i + 2; // linha 1 = cabeçalho da planilha
        try {
            if (!is_array($linha)) { continue; }

            $nomeCliente = valor($linha, 'clienteNome');
            if ($nomeCliente === '') {
                $avisos[] = "Linha {$numeroLinha}: sem nome de cliente — ignorada.";
                continue;
            }

            // --- cliente: encontra ou cria ---
            $stmtClientePorNome->execute([$nomeCliente]);
            $clienteId = $stmtClientePorNome->fetchColumn();
            if (!$clienteId) {
                $proximoCodigoCliente++;
                $codigo = str_pad((string) $proximoCodigoCliente, 4, '0', STR_PAD_LEFT);
                $stmtInsereCliente->execute([
                    $codigo, $nomeCliente, 'PF',
                    valor($linha, 'clienteDocumento'), valor($linha, 'clienteTelefone'), valor($linha, 'clienteEmail'),
                ]);
                $clienteId = (int) $pdo->lastInsertId();
                $criadosClientes++;
            }

            // --- tipo de equipamento: tenta casar pelo nome, senão usa o padrão escolhido ---
            $tipoId = $tipoPadraoId;
            $nomeTipo = valor($linha, 'equipamentoTipoNome');
            if ($nomeTipo !== '') {
                $stmtTipoPorNome->execute([$nomeTipo]);
                $encontrado = $stmtTipoPorNome->fetchColumn();
                if ($encontrado) { $tipoId = (int) $encontrado; }
            }

            // --- equipamento: encontra ou cria ---
            $numeroSerie = valor($linha, 'equipamentoNumeroSerie');
            $marca = valor($linha, 'equipamentoMarca');
            $modelo = valor($linha, 'equipamentoModelo');
            $equipamentoId = null;

            if ($numeroSerie !== '') {
                $stmtEquipPorSerie->execute([$clienteId, $numeroSerie]);
                $encontrado = $stmtEquipPorSerie->fetchColumn();
                if ($encontrado) { $equipamentoId = (int) $encontrado; }
            }
            if (!$equipamentoId && ($marca !== '' || $modelo !== '')) {
                $stmtEquipPorMarcaModelo->execute([$clienteId, $marca, $modelo]);
                $encontrado = $stmtEquipPorMarcaModelo->fetchColumn();
                if ($encontrado) { $equipamentoId = (int) $encontrado; }
            }
            if (!$equipamentoId) {
                $stmtInsereEquip->execute([
                    $clienteId, $tipoId, $marca, $modelo, $numeroSerie,
                    valor($linha, 'equipamentoPatrimonio'), valor($linha, 'equipamentoDataFabricacao'), valor($linha, 'equipamentoTensao'),
                ]);
                $equipamentoId = (int) $pdo->lastInsertId();
                $criadosEquipamentos++;
            }

            // --- número da OS: usa o da planilha se existir e não estiver duplicado ---
            $numero = valor($linha, 'numero');
            if ($numero !== '') {
                $stmtNumeroExiste->execute([$numero]);
                if ((int) $stmtNumeroExiste->fetchColumn() > 0) {
                    $avisos[] = "Linha {$numeroLinha}: número '{$numero}' já existe — foi gerado um novo número automático.";
                    $numero = '';
                }
            }
            if ($numero === '') {
                $proximoSeq++;
                $numero = 'OS-' . str_pad((string) $proximoSeq, 4, '0', STR_PAD_LEFT);
            }

            $status = valor($linha, 'status') ?: 'recebido';
            $dataEntrada = valor($linha, 'dataEntrada') ?: date('Y-m-d');
            $dataConclusao = valor($linha, 'dataConclusao') ?: null;
            $dataEntrega = valor($linha, 'dataEntrega') ?: null;

            $stmtInsereOrdem->execute([
                $numero, $clienteId, $equipamentoId,
                valor($linha, 'tipoAtendimento') ?: 'interno', $dataEntrada, 'cliente_trouxe',
                valor($linha, 'tipoManutencao') ?: 'preventiva', valor($linha, 'tecnico'), $status,
                valor($linha, 'observacoesGerais'), 'nao_informado', $dataConclusao, $dataEntrega,
                '[]', '[]', '[]', '[]', $orcamentoPadrao, $user['id'],
            ]);
            $criadasOrdens++;
        } catch (Throwable $e) {
            $avisos[] = "Linha {$numeroLinha}: erro — " . $e->getMessage();
        }
    }

    $pdo->commit();
    Auth::log($user['id'], 'importar', 'ordens', null, "{$criadasOrdens} OS importadas de planilha");

    Response::ok([
        'linhasProcessadas' => count($linhas),
        'ordensCriadas' => $criadasOrdens,
        'clientesCriados' => $criadosClientes,
        'equipamentosCriados' => $criadosEquipamentos,
        'avisos' => $avisos,
    ]);
} catch (Throwable $e) {
    $pdo->rollBack();
    error_log('Falha na importação de OS: ' . $e->getMessage());
    Response::error('Falha na importação: ' . $e->getMessage(), 500);
}
