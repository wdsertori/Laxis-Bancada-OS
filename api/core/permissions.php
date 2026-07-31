<?php
/**
 * core/permissions.php
 *
 * Matriz central de permissões: chave => papéis que podem.
 * Pra adicionar um módulo novo (estoque, financeiro, CRM...), basta
 * acrescentar novas chaves aqui — nada na autenticação muda.
 *
 * Uso em qualquer endpoint: Auth::requirePermission('ordens.excluir');
 */
return [
    // usuários
    'usuarios.ver'       => ['gestao'],
    'usuarios.gerenciar' => ['gestao'], // criar / editar / excluir / inativar

    // dados da empresa e parâmetros operacionais
    'empresa.ver'        => ['gestao', 'administrativo', 'tecnico'],
    'empresa.editar'     => ['gestao'],
    'parametros.ver'     => ['gestao', 'administrativo', 'tecnico'],
    'parametros.editar'  => ['gestao'],

    // clientes
    'clientes.ver'       => ['gestao', 'administrativo', 'tecnico'],
    'clientes.gerenciar' => ['gestao', 'administrativo'],

    // tipos de equipamento (catálogo/checklist-modelo)
    'tipos_equipamento.ver'       => ['gestao', 'administrativo', 'tecnico'],
    'tipos_equipamento.gerenciar' => ['gestao'],

    // equipamentos
    'equipamentos.ver'       => ['gestao', 'administrativo', 'tecnico'],
    'equipamentos.gerenciar' => ['gestao', 'administrativo'],

    // ordens de serviço
    'ordens.ver'              => ['gestao', 'administrativo', 'tecnico'],
    'ordens.criar'            => ['gestao', 'administrativo'],
    'ordens.editar'           => ['gestao', 'administrativo', 'tecnico'],
    'ordens.orcamento.editar' => ['gestao', 'administrativo'],
    'ordens.excluir'          => ['gestao'],
    'ordens.fotos.gerenciar'  => ['gestao', 'administrativo', 'tecnico'],

    // catálogo de peças
    'pecas.ver'       => ['gestao', 'administrativo', 'tecnico'],
    'pecas.gerenciar' => ['gestao', 'administrativo'],

    // dados do sistema (backup/import por conjunto)
    'dados.exportar' => ['gestao'],
    'dados.importar' => ['gestao'],
];
