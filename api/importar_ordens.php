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

function numeroDecimal(string $bruto): float {
    $limpo = trim($bruto);
    if ($limpo === '') { return 0.0; }
    // aceita "1.234,56" (padrão BR) ou "1234.56" (padrão US)
    if (preg_match('/^-?\d{1,3}(\.\d{3})*,\d+$/', $limpo)) {
        $limpo = str_replace('.', '', $limpo);
        $limpo = str_replace(',', '.', $limpo);
    } elseif (strpos($limpo, ',') !== false && strpos($limpo, '.') === false) {
        $limpo = str_replace(',', '.', $limpo);
    }
    return is_numeric($limpo) ? (float) $limpo : 0.0;
}

function mapearAprovado(string $bruto): string {
    $t = strtolower(trim($bruto));
    $t = preg_replace('/[^a-z]/', '', $t); // tira acento/pontuação (ex: "não" -> "nao")
    if (in_array($t, ['sim', 'aprovado', 's', 'yes'], true)) { return 'aprovado'; }
    if (in_array($t, ['nao', 'reprovado', 'n', 'no'], true)) { return 'reprovado'; }
    if ($t === 'descarte') { return 'descarte'; }
    return 'pendente';
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
        'INSERT INTO clientes (codigo, nome, tipo_pessoa, documento, apelido, contato, telefone, email,
            cep, rua, numero, bairro, cidade, estado, atuacao, como_ficou_sabendo, observacoes, data_cadastro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
    $stmtInsereOrdem = $pdo->prepare(
        'INSERT INTO ordens (numero, token_publico, cliente_id, equipamento_id, tipo_atendimento, data_entrada, origem, tipo_manutencao,
            tecnico, status, observacoes_gerais, garantia_equipamento, data_conclusao, data_pagamento, data_entrega,
            checklist_entrada, checklist_pre_orcamento, checklist_pos_orcamento, checklist_atendimento, orcamento, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
                    $codigo, $nomeCliente, 'PF', valor($linha, 'clienteDocumento'),
                    valor($linha, 'clienteApelido'), valor($linha, 'clienteContato'),
                    valor($linha, 'clienteTelefone'), valor($linha, 'clienteEmail'),
                    valor($linha, 'clienteCep'), valor($linha, 'clienteRua'), valor($linha, 'clienteNumero'),
                    valor($linha, 'clienteBairro'), valor($linha, 'clienteCidade'), valor($linha, 'clienteEstado'),
                    valor($linha, 'clienteAtuacao'), valor($linha, 'clienteComoFicouSabendo'), valor($linha, 'clienteObservacoes'),
                    valor($linha, 'clienteDataCadastro') ?: null,
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
            $dataPagamento = valor($linha, 'dataPagamento') ?: null;
            $dataEntrega = valor($linha, 'dataEntrega') ?: null;

            // --- peças: até 10 pares nome/valor viram um item genérico somado + texto de referência ---
            $itensPecasTexto = [];
            $totalPecas = 0.0;
            for ($p = 1; $p <= 10; $p++) {
                $nomePeca = valor($linha, "peca{$p}Nome");
                $valorPecaBruto = valor($linha, "peca{$p}Valor");
                $valorPeca = numeroDecimal($valorPecaBruto);
                if ($nomePeca === '' && $valorPeca == 0.0) { continue; }
                $totalPecas += $valorPeca;
                $itensPecasTexto[] = ($nomePeca !== '' ? $nomePeca : 'Peça sem nome') . ' — R$ ' . number_format($valorPeca, 2, ',', '.');
            }
            $pecasArray = [];
            if ($totalPecas > 0) {
                $pecasArray[] = ['id' => uniqid('imp_'), 'descricao' => 'Peças utilizadas (importação)', 'preco' => round($totalPecas, 2)];
            }

            $acessorios = valor($linha, 'acessorios');
            $partesObs = [];
            if ($itensPecasTexto) {
                $partesObs[] = 'Peças (histórico da importação): ' . implode('; ', $itensPecasTexto) . ' | Total peças: R$ ' . number_format($totalPecas, 2, ',', '.');
            }
            if ($acessorios !== '') {
                $partesObs[] = 'Acessórios: ' . $acessorios;
            }
            $obsInternas = implode(' — ', $partesObs);

            $orcamento = json_encode([
                'descricaoServico' => '',
                'valorServico' => valor($linha, 'valorServico'),
                'pecas' => $pecasArray,
                'deslocamento' => valor($linha, 'deslocamento'),
                'desconto' => valor($linha, 'desconto'),
                'formaPagamento' => valor($linha, 'formaPagamento'),
                'aprovado' => mapearAprovado(valor($linha, 'aprovado')),
                'obsInternas' => $obsInternas,
            ], JSON_UNESCAPED_UNICODE);

            $stmtInsereOrdem->execute([
                $numero, bin2hex(random_bytes(16)), $clienteId, $equipamentoId,
                valor($linha, 'tipoAtendimento') ?: 'interno', $dataEntrada, 'cliente_trouxe',
                valor($linha, 'tipoManutencao') ?: 'preventiva', valor($linha, 'tecnico'), $status,
                valor($linha, 'observacoesGerais'), 'nao_informado', $dataConclusao, $dataPagamento, $dataEntrega,
                '[]', '[]', '[]', '[]', $orcamento, $user['id'],
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
