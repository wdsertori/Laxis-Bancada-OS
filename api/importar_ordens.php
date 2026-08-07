<?php
/**
 * importar_ordens.php — importação em massa de OS a partir de uma planilha.
 *
 * POST /api/importar_ordens.php
 * Body: {
 *   linhas: [{ clienteCodigo, clienteNome,
 *              equipamentoTipoNome, equipamentoMarca, equipamentoModelo, equipamentoNumeroSerie,
 *              equipamentoPatrimonio, equipamentoTensao, garantiaEquipamento,
 *              numero, dataEntrada, dataConclusao, dataPagamento, dataEntrega, status, aprovado,
 *              tipoManutencao, tipoAtendimento, tecnico, observacoesGerais, descricaoServico,
 *              valorServico, deslocamento, desconto, formaPagamento, acessorios,
 *              peca1Nome..peca10Nome, peca1Valor..peca10Valor }, ...],
 *   tipoEquipamentoPadraoId: int|null
 * }
 *
 * Cliente é buscado por código (se informado) ou por nome; se nenhum dos
 * dois encontrar, cria um cliente NOVO só com o nome — dados completos de
 * cliente (endereço, contato etc.) entram pela importação de clientes
 * dedicada, não por aqui, pra não duplicar preenchimento nas duas planilhas.
 * Equipamento é encontrado ou criado (por número de série, ou marca+modelo,
 * dentro do mesmo cliente). A OS é inserida diretamente (sem forçar status
 * "recebido" como o POST normal de ordens.php faz — aqui o status/datas vêm
 * da própria planilha, porque é dado histórico). Uma linha com erro não
 * derruba o restante da importação.
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

function mapearGarantia(string $bruto): string {
    $t = strtolower(trim($bruto));
    $t = preg_replace('/[^a-z]/', '', $t);
    if (in_array($t, ['sim', 's', 'yes'], true)) { return 'sim'; }
    if (in_array($t, ['nao', 'n', 'no'], true)) { return 'nao'; }
    return 'nao_informado';
}

function mapearStatus(string $bruto): string {
    // "aprovado"/"reprovado" não são mais Status válidos — a decisão do
    // cliente já fica no campo Aprovado; o Status de uma OS já decidida
    // (aprovada, reprovada ou descartada) é sempre "concluido".
    $validos = ['recebido', 'em_orcamento', 'aguardando_aprovacao', 'em_execucao', 'concluido', 'entregue'];
    $t = strtolower(trim($bruto));
    $t = preg_replace('/[^a-z_]/', '', $t);
    if (in_array($t, ['aprovado', 'reprovado', 'descarte', 'cancelado'], true)) { return 'concluido'; }
    if (in_array($t, $validos, true)) { return $t; }
    return 'recebido';
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

    $stmtClientePorCodigo = $pdo->prepare('SELECT id FROM clientes WHERE codigo = ? LIMIT 1');
    $stmtClientePorNome = $pdo->prepare('SELECT id FROM clientes WHERE LOWER(nome) = LOWER(?) LIMIT 1');
    $stmtInsereCliente = $pdo->prepare('INSERT INTO clientes (codigo, nome, tipo_pessoa) VALUES (?, ?, ?)');
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
            $codigoCliente = valor($linha, 'clienteCodigo');
            if ($nomeCliente === '' && $codigoCliente === '') {
                $avisos[] = "Linha {$numeroLinha}: sem nome nem código de cliente — ignorada.";
                continue;
            }

            // --- cliente: código tem prioridade (evita ambiguidade de nomes
            // repetidos); sem código, busca por nome; se não achar por
            // nenhum dos dois, cria um cliente mínimo só com o nome — o
            // resto dos dados dele entra pela importação de clientes, não
            // por aqui, pra não duplicar o preenchimento nas duas planilhas.
            $clienteId = null;
            if ($codigoCliente !== '') {
                $stmtClientePorCodigo->execute([$codigoCliente]);
                $clienteId = $stmtClientePorCodigo->fetchColumn() ?: null;
                if (!$clienteId) {
                    $avisos[] = "Linha {$numeroLinha}: código de cliente '{$codigoCliente}' não encontrado — tentando por nome.";
                }
            }
            if (!$clienteId && $nomeCliente !== '') {
                $stmtClientePorNome->execute([$nomeCliente]);
                $clienteId = $stmtClientePorNome->fetchColumn() ?: null;
            }
            if (!$clienteId) {
                if ($nomeCliente === '') {
                    $avisos[] = "Linha {$numeroLinha}: código '{$codigoCliente}' não encontrado e sem nome pra criar cliente novo — ignorada.";
                    continue;
                }
                $proximoCodigoCliente++;
                $codigo = str_pad((string) $proximoCodigoCliente, 4, '0', STR_PAD_LEFT);
                $stmtInsereCliente->execute([$codigo, $nomeCliente, 'PF']);
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

            $status = mapearStatus(valor($linha, 'status'));
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
                'descricaoServico' => valor($linha, 'descricaoServico'),
                'valorServico' => valor($linha, 'valorServico'),
                'pecas' => $pecasArray,
                'deslocamento' => valor($linha, 'deslocamento'),
                'desconto' => valor($linha, 'desconto'),
                'formaPagamento' => valor($linha, 'formaPagamento'),
                'numeroNf' => valor($linha, 'numeroNf'),
                'observacaoCliente' => valor($linha, 'observacaoCliente'),
                'aprovado' => mapearAprovado(valor($linha, 'aprovado')),
                'obsInternas' => $obsInternas,
            ], JSON_UNESCAPED_UNICODE);

            $stmtInsereOrdem->execute([
                $numero, bin2hex(random_bytes(16)), $clienteId, $equipamentoId,
                valor($linha, 'tipoAtendimento') ?: 'interno', $dataEntrada, 'cliente_trouxe',
                valor($linha, 'tipoManutencao') ?: 'preventiva', valor($linha, 'tecnico'), $status,
                valor($linha, 'observacoesGerais'), mapearGarantia(valor($linha, 'garantiaEquipamento')), $dataConclusao, $dataPagamento, $dataEntrega,
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
