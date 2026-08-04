import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Wrench, ClipboardList, Plus, Trash2, ArrowLeft, Search, RotateCcw, Camera, Building2, Layers, ChevronDown, ChevronUp, SlidersHorizontal, Printer, UserCog, LogOut, Lock, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { QRCodeSVG } from 'qrcode.react';

/* ---------- cliente da API (PHP) ---------- */
const API_BASE = '/api';
async function apiRequest(path, { method = 'GET', body, isFormData = false } = {}) {
  const opts = { method, credentials: 'include' };
  if (body !== undefined) {
    if (isFormData) {
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(API_BASE + path, opts);
  let payload;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || !payload || payload.ok === false) {
    const msg = (payload && payload.erro) || `Erro ${res.status} ao acessar ${path}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return payload.data;
}
const api = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', body }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body }),
  del: (path) => apiRequest(path, { method: 'DELETE' }),
  postForm: (path, formData) => apiRequest(path, { method: 'POST', body: formData, isFormData: true }),
};

/* ---------- helpers ---------- */
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function todayStr() {
  // Componentes LOCAIS, não toISOString() (que é UTC) — em UTC-3 (Brasil),
  // usar toISOString direto vira o dia errado depois das ~21h. Testado e confirmado.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('pt-BR');
}
function fmtMoney(v) {
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function mesesDesde(dataStr) {
  if (!dataStr) return 0;
  const data = new Date(dataStr + 'T00:00:00');
  const hoje = new Date();
  let meses = (hoje.getFullYear() - data.getFullYear()) * 12 + (hoje.getMonth() - data.getMonth());
  if (hoje.getDate() < data.getDate()) meses -= 1;
  return Math.max(meses, 0);
}
function telefoneParaWhatsapp(telefone) {
  let digits = (telefone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (!digits.startsWith('55')) digits = '55' + digits;
  return digits;
}
function montarMensagemRenovacao(template, { clienteNome, equipamentoNome, empresaNome, marca, modelo }) {
  return (template || '')
    .replaceAll('{cliente}', clienteNome || '')
    .replaceAll('{equipamento}', equipamentoNome || 'equipamento')
    .replaceAll('{empresa}', empresaNome || '')
    .replaceAll('{marca}', marca || '')
    .replaceAll('{modelo}', modelo || '');
}
function getRevisoesPendentes(db) {
  const padraoGlobal = Number(db.empresa.intervaloPreventivoMeses) || 12;
  const resultado = [];
  db.equipamentos.forEach((eq) => {
    const candidatas = db.ordens.filter((o) =>
      o.equipamentoId === eq.id &&
      (o.tipoManutencao === 'preventiva' || o.tipoManutencao === 'preventiva_corretiva') &&
      (o.dataConclusao || o.dataEntrega));
    if (candidatas.length === 0) return;
    candidatas.sort((a, b) => (b.dataConclusao || b.dataEntrega).localeCompare(a.dataConclusao || a.dataEntrega));
    const dataRef = candidatas[0].dataConclusao || candidatas[0].dataEntrega;
    const tipo = db.tiposEquipamento.find((t) => t.id === eq.tipoEquipamentoId);
    const intervalo = (tipo && tipo.intervaloPreventivoMeses) ? Number(tipo.intervaloPreventivoMeses) : padraoGlobal;
    const gatilho = intervalo - 1;
    const meses = mesesDesde(dataRef);
    if (meses < gatilho) return;
    if (eq.ultimoContatoRenovacao && eq.ultimoContatoRenovacao.referenciaUltimaPreventiva === dataRef) return;
    const cliente = db.clientes.find((c) => c.id === eq.clienteId);
    resultado.push({ equipamento: eq, cliente, dataUltimaPreventiva: dataRef, meses });
  });
  resultado.sort((a, b) => b.meses - a.meses);
  return resultado;
}
function getOsEmCustodia(db) {
  const diasAlerta = Number(db.empresa.custodiaDiasAlerta) || 90;
  const diasLimite = Number(db.empresa.custodiaDiasLimite) || 365;
  const hoje = new Date();
  return db.ordens
    .filter((o) => o.status === 'concluido' && o.tipoAtendimento !== 'externo' && o.dataConclusao)
    .map((o) => {
      const dataConclusao = new Date(o.dataConclusao + 'T00:00:00');
      const dias = Math.max(Math.floor((hoje - dataConclusao) / (1000 * 60 * 60 * 24)), 0);
      return { os: o, dias, vencido: dias >= diasLimite };
    })
    .filter((item) => item.dias >= diasAlerta)
    .sort((a, b) => b.dias - a.dias);
}
function makeChecklist(items) {
  return items.map((desc) => ({ id: uid(), descricao: desc, status: 'pendente', obs: '' }));
}
function normalizeOrcamento(orc) {
  return {
    descricaoServico: orc?.descricaoServico ?? orc?.descricao ?? '',
    valorServico: orc?.valorServico ?? orc?.valor ?? '',
    pecas: orc?.pecas ?? [],
    deslocamento: orc?.deslocamento ?? '',
    desconto: orc?.desconto ?? '',
    formaPagamento: orc?.formaPagamento ?? '',
    aprovado: orc?.aprovado ?? 'pendente',
    obsInternas: orc?.obsInternas ?? '',
  };
}
function defaultDb() {
  return {
    clientes: [], equipamentos: [], ordens: [], osCounter: 0, clienteCounter: 0, tecnicos: [], pecasCatalogo: [],
    tiposEquipamento: [
      {
        id: uid(), nome: 'Autoclave horizontal de bancada',
        checklistEntradaPadrao: ['Bandeja(s)', 'Suporte de bandejas', 'Cesto interno', 'Cabo de força', 'Mangueira/conector de água', 'Filtro de água', 'Manual ou documentação', 'Chave de abertura da porta'],
        checklistPrePadrao: ['Vedação da porta (gaxeta)', 'Teste de vácuo', 'Resistência de aquecimento', 'Válvula de segurança', 'Painel/display', 'Vazamento de água', 'Instalação elétrica', 'Ruído da bomba/compressor'],
        checklistPosPadrao: ['Repetição dos testes críticos', 'Ciclo completo de esterilização', 'Indicador biológico/químico', 'Temperatura e pressão', 'Estanqueidade final', 'Limpeza e organização'],
        intervaloPreventivoMeses: '',
      },
      {
        id: uid(), nome: 'Seladora',
        checklistEntradaPadrao: ['Cabo de força', 'Manual ou documentação', 'Bobina de teste'],
        checklistPrePadrao: ['Resistência de solda', 'Temperatura de selagem', 'Tempo de ciclo', 'Corte/guilhotina', 'Painel/display'],
        checklistPosPadrao: ['Teste de selagem em embalagem', 'Uniformidade da solda', 'Limpeza e organização'],
        intervaloPreventivoMeses: '',
      },
      {
        id: uid(), nome: 'Ultrassom odontológico',
        checklistEntradaPadrao: ['Cabo de força', 'Peça de mão', 'Ponteiras', 'Pedal', 'Manual ou documentação'],
        checklistPrePadrao: ['Potência/vibração', 'Fluxo de água', 'Peça de mão', 'Painel/display', 'Fiação e conectores'],
        checklistPosPadrao: ['Teste de vibração final', 'Fluxo de água ajustado', 'Limpeza e organização'],
        intervaloPreventivoMeses: '',
      },
      {
        id: uid(), nome: 'Compressor odontológico',
        checklistEntradaPadrao: ['Cabo de força', 'Mangueira de saída', 'Manual ou documentação'],
        checklistPrePadrao: ['Pressão de trabalho', 'Válvula de segurança', 'Dreno de condensado', 'Nível de óleo (se lubrificado)', 'Ruído do motor', 'Vazamento de ar'],
        checklistPosPadrao: ['Teste de pressão final', 'Tempo de recarga do reservatório', 'Vazamento de ar', 'Limpeza e organização'],
        intervaloPreventivoMeses: '',
      },
      {
        id: uid(), nome: 'Fotopolimerizador',
        checklistEntradaPadrao: ['Cabo de força/carregador', 'Ponteira', 'Manual ou documentação'],
        checklistPrePadrao: ['Intensidade de luz (radiômetro)', 'Bateria/carregador', 'Ventoinha de resfriamento', 'Botão/timer'],
        checklistPosPadrao: ['Teste de intensidade final', 'Ciclo completo de cura', 'Limpeza e organização'],
        intervaloPreventivoMeses: '',
      },
      {
        id: uid(), nome: 'Raio-X odontológico',
        checklistEntradaPadrao: ['Cabo de força', 'Colimador/localizador', 'Manual ou documentação'],
        checklistPrePadrao: ['Emissão de radiação', 'Tempo de exposição', 'Painel/display', 'Fiação e conectores', 'Braço articulado'],
        checklistPosPadrao: ['Teste de imagem final', 'Calibração de tempo/kV', 'Limpeza e organização'],
        intervaloPreventivoMeses: '',
      },
    ],
    empresa: {
      nome: 'Laxis',
      logoDataUrl: '',
      endereco: 'R. Otto Benz',
      cidade: 'Ribeirão Preto',
      uf: 'SP',
      cep: '14096-580',
      telefone: '(16) 98856-3801',
      email: 'at@laxis.com.br',
      cnpj: '38.141.015/0001-42',
      ie: '797.631.007.117',
      im: '20.126.656',
      engenheiroNome: '',
      engenheiroCrea: 'CREA-SP 5068941986',
      garantiaPadraoInterno: 'Garantia de peças e serviços: 3 (três) meses. Garantia não cobre deslocamentos. Caso necessário, será cobrado novo frete.',
      garantiaPadraoExterno: 'Garantia de peças e serviços: 90 dias. Garantia não cobre custos de deslocamentos (estacionamento, pedágio, km rodado).\nValor visita técnica: R$200,00 (até 2h) | Hora Adicional: R$100,00',
      custodiaPolitica: 'O equipamento será avaliado em até 5 (cinco) dias úteis, e o orçamento comunicado por telefone/WhatsApp. Equipamentos não retirados em até 90 (noventa) dias após a comunicação de conclusão estarão sujeitos à cobrança de taxa de custódia de R$ 5,00 (cinco reais) por dia. Após 12 (doze) meses sem retirada e sem contato do cliente, o equipamento poderá ser vendido para ressarcimento dos custos de mão de obra, peças e armazenagem.',
      intervaloPreventivoMeses: 12,
      mensagemRenovacao: 'Olá {cliente}! Aqui é da {empresa}. Faz quase um ano da última revisão preventiva do seu {equipamento} — vamos agendar uma nova visita pra manter tudo funcionando certinho?',
      custodiaDiasAlerta: 90,
      custodiaDiasLimite: 365,
    },
  };
}
function hydrateDb(raw) {
  const base = defaultDb();
  if (!raw) return base;
  const empresaRaw = raw.empresa || {};
  const empresa = { ...base.empresa, ...empresaRaw };
  if (empresaRaw.garantiaPadrao && !empresaRaw.garantiaPadraoInterno) empresa.garantiaPadraoInterno = empresaRaw.garantiaPadrao;
  return { ...base, ...raw, empresa };
}

/* ---------- import/export de cada conjunto de dados, por chaves legíveis (não por id interno) ---------- */
const DATASET_CONFIG = {
  tiposEquipamento: {
    label: 'Tipos de equipamento',
    ordem: 1,
    toExport: (db) => db.tiposEquipamento.map((t) => ({
      nome: t.nome, intervaloPreventivoMeses: t.intervaloPreventivoMeses || '', checklistEntradaPadrao: t.checklistEntradaPadrao, checklistPrePadrao: t.checklistPrePadrao, checklistPosPadrao: t.checklistPosPadrao,
    })),
    template: () => ([{ nome: 'Nome do tipo (ex: Compressor odontológico)', intervaloPreventivoMeses: '(opcional — vazio usa o padrão da empresa)', checklistEntradaPadrao: ['Cabo de força'], checklistPrePadrao: ['Funcionamento geral'], checklistPosPadrao: ['Limpeza e organização'] }]),
    importUpsert: (db, rows) => {
      let tiposEquipamento = [...db.tiposEquipamento];
      const warnings = [];
      rows.forEach((r) => {
        if (!r.nome || !String(r.nome).trim()) { warnings.push('Tipo de equipamento sem nome — linha ignorada.'); return; }
        const nome = String(r.nome).trim();
        const idx = tiposEquipamento.findIndex((t) => t.nome.trim().toLowerCase() === nome.toLowerCase());
        const dados = {
          nome,
          intervaloPreventivoMeses: r.intervaloPreventivoMeses || '',
          checklistEntradaPadrao: Array.isArray(r.checklistEntradaPadrao) ? r.checklistEntradaPadrao : [],
          checklistPrePadrao: Array.isArray(r.checklistPrePadrao) ? r.checklistPrePadrao : [],
          checklistPosPadrao: Array.isArray(r.checklistPosPadrao) ? r.checklistPosPadrao : [],
        };
        if (idx >= 0) tiposEquipamento[idx] = { ...tiposEquipamento[idx], ...dados };
        else tiposEquipamento.push({ id: uid(), ...dados });
      });
      return { patch: { tiposEquipamento }, warnings };
    },
  },
  clientes: {
    label: 'Clientes',
    ordem: 2,
    toExport: (db) => db.clientes.map((c) => ({
      codigo: c.codigo || '', nome: c.nome, tipoPessoa: c.tipoPessoa || 'PF', documento: c.documento || '', telefone: c.telefone || '', email: c.email || '', endereco: c.endereco || '',
    })),
    template: () => ([{ codigo: '0001 (opcional — se vazio, gera automático)', nome: 'Nome do cliente', tipoPessoa: 'PF ou PJ', documento: 'CPF ou CNPJ', telefone: '', email: '', endereco: '' }]),
    importUpsert: (db, rows) => {
      let clientes = [...db.clientes];
      let counter = db.clienteCounter || 0;
      const warnings = [];
      rows.forEach((r) => {
        if (!r.nome || !String(r.nome).trim()) { warnings.push('Cliente sem nome — linha ignorada.'); return; }
        const codigoLimpo = r.codigo ? String(r.codigo).trim() : '';
        let idx = codigoLimpo ? clientes.findIndex((c) => c.codigo === codigoLimpo) : -1;
        if (idx === -1) idx = clientes.findIndex((c) => c.nome.trim().toLowerCase() === String(r.nome).trim().toLowerCase());
        const dados = { nome: String(r.nome).trim(), tipoPessoa: r.tipoPessoa || 'PF', documento: r.documento || '', telefone: r.telefone || '', email: r.email || '', endereco: r.endereco || '' };
        if (idx >= 0) {
          clientes[idx] = { ...clientes[idx], ...dados };
        } else {
          let codigo = codigoLimpo;
          const n = parseInt(codigo, 10);
          if (codigo && !isNaN(n)) { if (n > counter) counter = n; } else { counter += 1; codigo = String(counter).padStart(4, '0'); }
          clientes.push({ id: uid(), codigo, ...dados });
        }
      });
      return { patch: { clientes, clienteCounter: counter }, warnings };
    },
  },
  equipamentos: {
    label: 'Equipamentos',
    ordem: 3,
    toExport: (db) => db.equipamentos.map((e) => {
      const cli = db.clientes.find((c) => c.id === e.clienteId);
      const tipo = db.tiposEquipamento.find((t) => t.id === e.tipoEquipamentoId);
      return {
        clienteCodigo: cli?.codigo || '', tipoEquipamento: tipo?.nome || e.tipo || '', marca: e.marca || '', modelo: e.modelo || '',
        numeroSerie: e.numeroSerie || '', patrimonio: e.patrimonio || '', dataFabricacao: e.dataFabricacao || '', tensao: e.tensao || '',
      };
    }),
    template: () => ([{ clienteCodigo: '0001 (código do cliente já cadastrado)', tipoEquipamento: 'Nome de um tipo já cadastrado', marca: '', modelo: '', numeroSerie: '', patrimonio: '', dataFabricacao: '', tensao: '127V | 220V | Bivolt manual | Bivolt automático' }]),
    importUpsert: (db, rows) => {
      let equipamentos = [...db.equipamentos];
      let tiposEquipamento = [...db.tiposEquipamento];
      const warnings = [];
      rows.forEach((r) => {
        const cli = db.clientes.find((c) => c.codigo === String(r.clienteCodigo || '').trim());
        if (!cli) { warnings.push(`Equipamento "${r.tipoEquipamento || '—'}" ignorado: cliente com código "${r.clienteCodigo}" não encontrado.`); return; }
        let tipo = tiposEquipamento.find((t) => t.nome.trim().toLowerCase() === String(r.tipoEquipamento || '').trim().toLowerCase());
        if (!tipo && r.tipoEquipamento) {
          tipo = { id: uid(), nome: String(r.tipoEquipamento).trim(), checklistEntradaPadrao: [], checklistPrePadrao: [], checklistPosPadrao: [] };
          tiposEquipamento.push(tipo);
          warnings.push(`Tipo "${r.tipoEquipamento}" não existia e foi criado automaticamente (sem checklist).`);
        }
        const numeroSerie = r.numeroSerie ? String(r.numeroSerie).trim() : '';
        let idx = numeroSerie ? equipamentos.findIndex((e) => e.clienteId === cli.id && e.numeroSerie === numeroSerie) : -1;
        if (idx === -1) idx = equipamentos.findIndex((e) => e.clienteId === cli.id && e.tipoEquipamentoId === tipo?.id && e.marca === (r.marca || '') && e.modelo === (r.modelo || ''));
        const dados = {
          clienteId: cli.id, tipoEquipamentoId: tipo?.id || '', marca: r.marca || '', modelo: r.modelo || '', numeroSerie,
          patrimonio: r.patrimonio || '', dataFabricacao: r.dataFabricacao || '', tensao: r.tensao || '',
        };
        if (idx >= 0) equipamentos[idx] = { ...equipamentos[idx], ...dados };
        else equipamentos.push({ id: uid(), ...dados });
      });
      return { patch: { equipamentos, tiposEquipamento }, warnings };
    },
  },
  tecnicos: {
    label: 'Técnicos',
    ordem: 4,
    toExport: (db) => db.tecnicos.map((t) => ({ nome: t.nome })),
    template: () => ([{ nome: 'Nome do técnico' }]),
    importUpsert: (db, rows) => {
      let tecnicos = [...db.tecnicos];
      const warnings = [];
      rows.forEach((r) => {
        if (!r.nome || !String(r.nome).trim()) { warnings.push('Técnico sem nome — linha ignorada.'); return; }
        const nome = String(r.nome).trim();
        if (!tecnicos.some((t) => t.nome.trim().toLowerCase() === nome.toLowerCase())) tecnicos.push({ id: uid(), nome });
      });
      return { patch: { tecnicos }, warnings };
    },
  },
  pecasCatalogo: {
    label: 'Peças (catálogo)',
    ordem: 5,
    toExport: (db) => db.pecasCatalogo.map((p) => ({ descricao: p.descricao, preco: p.preco })),
    template: () => ([{ descricao: 'Nome da peça', preco: '0.00' }]),
    importUpsert: (db, rows) => {
      let pecasCatalogo = [...db.pecasCatalogo];
      const warnings = [];
      rows.forEach((r) => {
        if (!r.descricao || !String(r.descricao).trim()) { warnings.push('Peça sem descrição — linha ignorada.'); return; }
        const desc = String(r.descricao).trim();
        const idx = pecasCatalogo.findIndex((p) => p.descricao.trim().toLowerCase() === desc.toLowerCase());
        if (idx >= 0) pecasCatalogo[idx] = { ...pecasCatalogo[idx], preco: r.preco ?? pecasCatalogo[idx].preco };
        else pecasCatalogo.push({ id: uid(), descricao: desc, preco: r.preco ?? '0' });
      });
      return { patch: { pecasCatalogo }, warnings };
    },
  },
  ordens: {
    label: 'Ordens de serviço',
    ordem: 6,
    toExport: (db) => db.ordens.map((o) => {
      const cli = db.clientes.find((c) => c.id === o.clienteId);
      const eq = db.equipamentos.find((e) => e.id === o.equipamentoId);
      const { clienteId, equipamentoId, ...resto } = o;
      return { clienteCodigo: cli?.codigo || '', equipamentoNumeroSerie: eq?.numeroSerie || '', ...resto };
    }),
    template: () => ([{
      numero: 'OS-0001 (se já existir, atualiza; se não, cria)', clienteCodigo: '0001', equipamentoNumeroSerie: 'deixe vazio se o equipamento não tiver série',
      tipoAtendimento: 'interno ou externo', status: 'recebido', dataEntrada: '2026-01-31', tipoManutencao: 'preventiva | corretiva | preditiva',
      tecnico: '', origem: 'cliente_trouxe | retirada', observacoesGerais: '',
      checklistEntrada: [], checklistPreOrcamento: [], checklistPosOrcamento: [], checklistAtendimento: [],
      orcamento: { descricaoServico: '', valorServico: '', pecas: [], deslocamento: '', desconto: '', formaPagamento: '', aprovado: 'pendente', obsInternas: '' },
      garantiaEquipamento: 'nao_informado', dataConclusao: null, dataPagamento: null, dataEntrega: null, fotos: [],
    }]),
    importUpsert: (db, rows) => {
      let ordens = [...db.ordens];
      let osCounter = db.osCounter || 0;
      const warnings = [];
      rows.forEach((r) => {
        const cli = db.clientes.find((c) => c.codigo === String(r.clienteCodigo || '').trim());
        if (!cli) { warnings.push(`OS ${r.numero || '(sem número)'} ignorada: cliente com código "${r.clienteCodigo}" não encontrado.`); return; }
        const serieAlvo = r.equipamentoNumeroSerie ? String(r.equipamentoNumeroSerie).trim() : '';
        let eq = serieAlvo ? db.equipamentos.find((e) => e.clienteId === cli.id && e.numeroSerie === serieAlvo) : null;
        if (!eq) eq = db.equipamentos.find((e) => e.clienteId === cli.id);
        if (!eq) { warnings.push(`OS ${r.numero || '(sem número)'} ignorada: nenhum equipamento encontrado para o cliente ${cli.codigo}.`); return; }
        const { clienteCodigo, equipamentoNumeroSerie, numero, ...resto } = r;
        let numeroFinal = numero;
        const numMatch = numeroFinal ? String(numeroFinal).match(/(\d+)/) : null;
        if (numMatch) { const n = parseInt(numMatch[1], 10); if (n > osCounter) osCounter = n; }
        const idx = numeroFinal ? ordens.findIndex((o) => o.numero === numeroFinal) : -1;
        if (!numeroFinal) { osCounter += 1; numeroFinal = `OS-${String(osCounter).padStart(4, '0')}`; }
        const dados = { ...resto, numero: numeroFinal, clienteId: cli.id, equipamentoId: eq.id };
        if (idx >= 0) ordens[idx] = { ...ordens[idx], ...dados };
        else ordens.push({ id: uid(), fotos: [], checklistEntrada: [], checklistPreOrcamento: [], checklistPosOrcamento: [], checklistAtendimento: [], ...dados });
      });
      return { patch: { ordens, osCounter }, warnings };
    },
  },
};

function getTemplateFor(tipoEquip = '') {
  const t = tipoEquip.toLowerCase();
  if (t.includes('autoclave')) {
    return {
      entrada: ['Bandeja(s)', 'Suporte de bandejas', 'Cesto interno', 'Cabo de força', 'Mangueira/conector de água', 'Filtro de água', 'Manual ou documentação', 'Chave de abertura da porta'],
      pre: ['Vedação da porta (gaxeta)', 'Teste de vácuo', 'Resistência de aquecimento', 'Válvula de segurança', 'Painel/display', 'Vazamento de água', 'Instalação elétrica', 'Ruído da bomba/compressor'],
      pos: ['Repetição dos testes críticos', 'Ciclo completo de esterilização', 'Indicador biológico/químico', 'Temperatura e pressão', 'Estanqueidade final', 'Limpeza e organização'],
    };
  }
  return {
    entrada: ['Cabo de força', 'Manual ou documentação', 'Acessórios inclusos'],
    pre: ['Verificação visual externa', 'Funcionamento geral', 'Segurança elétrica'],
    pos: ['Repetição dos testes críticos', 'Calibração/ajuste final', 'Limpeza e organização'],
  };
}
const EXTERNO_CHECKLIST_TEMPLATE = ['Verificação geral do equipamento', 'Substituição de peças danificadas', 'Limpeza e organização da área de atuação', 'Ajustes / regulagens necessárias', 'Teste funcional após reparo'];

const TIPO_ATENDIMENTO_LABEL = { interno: 'Interno (oficina)', externo: 'Externo (in loco)' };
const FORMAS_PAGAMENTO = ['Dinheiro', 'Pix', 'Cartão de crédito', 'Cartão de débito', 'Boleto', 'Transferência', 'Pagar outro dia (somente se autorizado)', 'Outro'];
const SITUACAO_OPCOES = {
  interno: [['pendente', 'Pendente'], ['aprovado', 'Aprovado'], ['reprovado', 'Reprovado'], ['descarte', 'Descarte']],
  externo: [['pendente', 'Pendente'], ['aprovado', 'Aprovado'], ['reprovado', 'Reprovado'], ['nao_finalizada', 'Não finalizada']],
};

function tipoNomeFor(tiposEquipamento, equipamento) {
  if (!equipamento) return '—';
  const found = (tiposEquipamento || []).find((t) => t.id === equipamento.tipoEquipamentoId);
  if (found) return found.nome;
  return equipamento.tipo || 'Tipo não definido';
}
function getChecklistTemplateForEquip(tiposEquipamento, equip) {
  const found = (tiposEquipamento || []).find((t) => t.id === equip?.tipoEquipamentoId);
  if (found) return { entrada: found.checklistEntradaPadrao, pre: found.checklistPrePadrao, pos: found.checklistPosPadrao };
  return getTemplateFor(equip?.tipo); // fallback para equipamentos antigos sem tipo cadastrado no catálogo
}

const TIPO_LABEL = { preventiva: 'Preventiva', corretiva: 'Corretiva', preditiva: 'Preditiva', preventiva_corretiva: 'Preventiva e Corretiva' };
const STATUS_META = {
  recebido: { label: 'Recebido', tone: 'neutral' },
  em_orcamento: { label: 'Em orçamento', tone: 'amber' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', tone: 'amber' },
  aprovado: { label: 'Aprovado', tone: 'accent' },
  em_execucao: { label: 'Em execução', tone: 'accent' },
  concluido: { label: 'Concluído', tone: 'success' },
  entregue: { label: 'Entregue', tone: 'success-solid' },
  reprovado: { label: 'Reprovado / cancelado', tone: 'danger' },
};
const NAV = [
  { key: 'dashboard', label: 'Painel', icon: LayoutDashboard },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'tipos', label: 'Tipos de equipamento', icon: Layers },
  { key: 'equipamentos', label: 'Equipamentos', icon: Wrench },
  { key: 'ordens', label: 'Ordens de serviço', icon: ClipboardList },
  { key: 'importar', label: 'Importar OS', icon: Upload, papeis: ['gestao'] },
  { key: 'importarClientes', label: 'Importar clientes', icon: Upload, papeis: ['gestao'] },
  { key: 'empresa', label: 'Empresa', icon: Building2, papeis: ['gestao'] },
  { key: 'parametros', label: 'Parâmetros', icon: SlidersHorizontal, papeis: ['gestao'] },
  { key: 'usuarios', label: 'Usuários', icon: UserCog, papeis: ['gestao'] },
];

/* ---------- small UI pieces ---------- */
function Badge({ tone, children }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}
function OsTag({ numero }) {
  return <span className="os-tag">{numero}</span>;
}
function ClienteAutocomplete({ clientes, value, onChange, placeholder, onCreateNew }) {
  const selected = clientes.find((c) => c.id === value);
  const [query, setQuery] = useState(selected ? selected.nome : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sel = clientes.find((c) => c.id === value);
    setQuery(sel ? sel.nome : '');
    // eslint-disable-next-line
  }, [value]);

  const q = query.trim().toLowerCase();
  const filtered = q ? clientes.filter((c) => c.nome.toLowerCase().includes(q) || (c.codigo || '').includes(q)) : clientes;
  const exactMatch = clientes.some((c) => c.nome.trim().toLowerCase() === q);

  function selectClient(c) {
    onChange(c.id);
    setQuery(c.nome);
    setOpen(false);
  }

  return (
    <div className="autocomplete">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || 'Buscar cliente por nome ou código...'}
      />
      {open && (
        <div className="autocomplete-list">
          {filtered.length === 0 && !onCreateNew && <div className="autocomplete-empty">Nenhum cliente encontrado</div>}
          {filtered.slice(0, 30).map((c) => (
            <button type="button" key={c.id} className="autocomplete-item" onMouseDown={() => selectClient(c)}>
              {c.codigo ? `${c.codigo} — ` : ''}{c.nome}
            </button>
          ))}
          {onCreateNew && query.trim() && !exactMatch && (
            <button type="button" className="autocomplete-item autocomplete-create" onMouseDown={() => { onCreateNew(query.trim()); setOpen(false); }}>
              <Plus size={13} /> Cadastrar novo cliente: "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ClienteQuickCreate({ nomeInicial, onSave, onCancel }) {
  const [nome, setNome] = useState(nomeInicial || '');
  const [telefone, setTelefone] = useState('');
  return (
    <div className="quick-add-card">
      <span className="quick-add-title">Cadastro rápido de cliente</span>
      <div className="form-grid">
        <label>Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </label>
        <label>Telefone (opcional)
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </label>
      </div>
      <p className="muted small">Dá pra completar CPF/CNPJ, endereço, atuação, etc. depois em "Clientes".</p>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn primary" disabled={!nome.trim()} onClick={() => onSave({ nome: nome.trim(), telefone: telefone.trim() })}>Cadastrar cliente</button>
      </div>
    </div>
  );
}

function DadosSection({ db, onExportDataset, onDownloadTemplate, onExportBackup }) {
  const datasets = Object.entries(DATASET_CONFIG).sort((a, b) => a[1].ordem - b[1].ordem);
  return (
    <div className="form-card">
      <h3 style={{ marginBottom: 4 }}>Dados do sistema</h3>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Exportação por conjunto, prontas pra conferir ou guardar. A <strong>importação em massa está temporariamente
        desativada</strong> — o sistema passou a salvar direto no banco de dados do servidor, e a importação por arquivo
        ainda vai ser adaptada pra esse novo formato. Pra cadastrar agora, use as telas normais (Clientes, Equipamentos, etc.).
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Conjunto</th><th>Registros</th><th></th></tr></thead>
          <tbody>
            {datasets.map(([key, cfg]) => (
              <tr key={key}>
                <td>{cfg.label}</td>
                <td className="mono">{db[key]?.length ?? 0}</td>
                <td className="row-actions">
                  <button type="button" className="link-btn" onClick={() => onExportDataset(key)}>Exportar</button>
                  <button type="button" className="link-btn" onClick={() => onDownloadTemplate(key)}>Modelo</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="subsection-title" style={{ marginTop: 18 }}>Backup completo</h4>
      <p className="muted small" style={{ marginBottom: 10 }}>Tudo junto num arquivo só, pra guardar uma cópia do estado atual.</p>
      <div className="form-actions" style={{ justifyContent: 'flex-start', gap: 10 }}>
        <button type="button" className="btn ghost" onClick={onExportBackup}>Exportar backup completo (.json)</button>
      </div>
    </div>
  );
}

const CAMPOS_IMPORTACAO = [
  { key: 'clienteCodigo', label: 'Código do cliente (se souber)' },
  { key: 'clienteNome', label: 'Nome do cliente', obrigatorio: true },
  { key: 'equipamentoTipoNome', label: 'Tipo de equipamento (nome)' },
  { key: 'equipamentoMarca', label: 'Marca do equipamento' },
  { key: 'equipamentoModelo', label: 'Modelo do equipamento' },
  { key: 'equipamentoNumeroSerie', label: 'Número de série' },
  { key: 'equipamentoPatrimonio', label: 'Patrimônio' },
  { key: 'equipamentoTensao', label: 'Tensão do equipamento' },
  { key: 'garantiaEquipamento', label: 'Garantia do equipamento (sim / não)' },
  { key: 'numero', label: 'Número da OS (se já existir um)' },
  { key: 'dataEntrada', label: 'Data de entrada' },
  { key: 'dataConclusao', label: 'Data de conclusão' },
  { key: 'dataPagamento', label: 'Data de pagamento' },
  { key: 'dataEntrega', label: 'Data de entrega' },
  { key: 'status', label: 'Status (recebido / em_orcamento / aguardando_aprovacao / aprovado / em_execucao / concluido / entregue / reprovado)' },
  { key: 'aprovado', label: 'Aprovado (sim / não / descarte)' },
  { key: 'tipoManutencao', label: 'Tipo de manutenção (preventiva / corretiva / preditiva / preventiva_corretiva)' },
  { key: 'tipoAtendimento', label: 'Tipo de atendimento (interno / externo)' },
  { key: 'tecnico', label: 'Técnico responsável' },
  { key: 'observacoesGerais', label: 'Solicitação do cliente / relato' },
  { key: 'descricaoServico', label: 'Descrição do serviço realizado' },
  { key: 'valorServico', label: 'Valor de mão de obra' },
  { key: 'deslocamento', label: 'Frete / deslocamento' },
  { key: 'desconto', label: 'Desconto' },
  { key: 'formaPagamento', label: 'Forma de pagamento' },
  { key: 'acessorios', label: 'Acessórios' },
  ...Array.from({ length: 10 }, (_, i) => i + 1).flatMap((n) => [
    { key: `peca${n}Nome`, label: `Peça ${n} (nome)` },
    { key: `peca${n}Valor`, label: `Peça ${n} (valor)` },
  ]),
  { key: 'observacoesGerais', label: 'Observações' },
];

function normalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function ImportadorPlanilha({ titulo, descricao, campos, campoObrigatorio, campoOrigemArquivo = '.xlsx,.xls,.csv', mostrarTipoEquipamento, db, onImportar, renderResumo, linkModelo }) {
  const [etapa, setEtapa] = useState('upload'); // upload | mapear | resultado
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [colunas, setColunas] = useState([]);
  const [linhasBrutas, setLinhasBrutas] = useState([]);
  const [mapeamento, setMapeamento] = useState({});
  const [tipoEquipamentoPadraoId, setTipoEquipamentoPadraoId] = useState('');
  const [erroArquivo, setErroArquivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  function processarArquivo(file) {
    setErroArquivo('');
    setNomeArquivo(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const linhas = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (linhas.length === 0) { setErroArquivo('A planilha está vazia ou não tem dados na primeira aba.'); return; }
        const cols = Object.keys(linhas[0]);

        const auto = {};
        campos.forEach((campo) => {
          const alvo = normalizarTexto(campo.label.split('(')[0]);
          const achada = cols.find((c) => normalizarTexto(c) === normalizarTexto(campo.key) || normalizarTexto(c) === alvo || normalizarTexto(c).includes(normalizarTexto(campo.key)));
          if (achada) auto[campo.key] = achada;
        });

        setColunas(cols);
        setLinhasBrutas(linhas);
        setMapeamento(auto);
        setEtapa('mapear');
      } catch (err) {
        setErroArquivo('Não consegui ler esse arquivo. Confirma se é um .xlsx, .xls ou .csv válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function formatarValor(campoKey, bruto) {
    if (/data/i.test(campoKey) && bruto instanceof Date) {
      // Usa os componentes LOCAIS (getFullYear/getMonth/getDate), não
      // toISOString() — o SheetJS ancora a data lida do Excel de um jeito
      // que só bate certo pelos getters locais; toISOString (que é UTC)
      // pode voltar um dia em fusos à frente de UTC. Testado e confirmado.
      const pad = (n) => String(n).padStart(2, '0');
      return `${bruto.getFullYear()}-${pad(bruto.getMonth() + 1)}-${pad(bruto.getDate())}`;
    }
    return String(bruto ?? '').trim();
  }

  function montarLinhas() {
    return linhasBrutas.map((row) => {
      const obj = {};
      campos.forEach((campo) => {
        const col = mapeamento[campo.key];
        obj[campo.key] = col ? formatarValor(campo.key, row[col]) : '';
      });
      return obj;
    });
  }

  async function confirmar() {
    setEnviando(true);
    try {
      const linhas = montarLinhas();
      const extras = mostrarTipoEquipamento ? { tipoEquipamentoPadraoId: tipoEquipamentoPadraoId || null } : {};
      const r = await onImportar({ linhas, ...extras });
      setResultado(r);
      setEtapa('resultado');
    } catch (err) {
      window.alert(err.message || 'Falha ao importar.');
    } finally {
      setEnviando(false);
    }
  }

  function reiniciar() {
    setEtapa('upload'); setNomeArquivo(''); setColunas([]); setLinhasBrutas([]);
    setMapeamento({}); setResultado(null); setErroArquivo('');
  }

  const mapeamentoValido = !!mapeamento[campoObrigatorio];

  return (
    <div>
      <div className="view-header"><h2>{titulo}</h2></div>
      <p className="muted small" style={{ marginBottom: 14 }}>{descricao}</p>
      {linkModelo && etapa === 'upload' && (
        <p className="muted small" style={{ marginBottom: 14 }}>
          <a href={linkModelo} download>Baixar planilha modelo</a>
        </p>
      )}

      {etapa === 'upload' && (
        <div className="form-card">
          <label>Arquivo da planilha
            <input type="file" accept={campoOrigemArquivo} onChange={(e) => e.target.files[0] && processarArquivo(e.target.files[0])} />
          </label>
          {erroArquivo && <p className="login-erro" style={{ marginTop: 10 }}>{erroArquivo}</p>}
        </div>
      )}

      {etapa === 'mapear' && (
        <div className="form-card">
          <p className="muted small" style={{ marginBottom: 12 }}>
            <strong>{nomeArquivo}</strong> — {linhasBrutas.length} linha(s) detectada(s). Confirma o mapeamento abaixo
            (campos em branco ficam vazios/com valor padrão na importação).
          </p>

          <div className="form-grid">
            {campos.map((campo) => (
              <label key={campo.key}>
                {campo.label}{campo.obrigatorio && ' *'}
                <select value={mapeamento[campo.key] || ''} onChange={(e) => setMapeamento({ ...mapeamento, [campo.key]: e.target.value })}>
                  <option value="">— não usar —</option>
                  {colunas.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ))}
            {mostrarTipoEquipamento && (
              <label>Tipo de equipamento padrão (quando a planilha não indicar ou não encontrar)
                <select value={tipoEquipamentoPadraoId} onChange={(e) => setTipoEquipamentoPadraoId(e.target.value)}>
                  <option value="">— nenhum —</option>
                  {db.tiposEquipamento.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </label>
            )}
          </div>

          {!mapeamentoValido && <p className="login-erro" style={{ marginTop: 10 }}>Mapeia o campo obrigatório (*) pra continuar.</p>}

          <h4 className="subsection-title" style={{ marginTop: 18 }}>Prévia (3 primeiras linhas)</h4>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>{campos.filter((c) => mapeamento[c.key]).map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {linhasBrutas.slice(0, 3).map((row, i) => (
                  <tr key={i}>
                    {campos.filter((c) => mapeamento[c.key]).map((c) => (
                      <td key={c.key}>{formatarValor(c.key, row[mapeamento[c.key]])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <button className="btn ghost" onClick={reiniciar}>Cancelar</button>
            <button className="btn primary" disabled={!mapeamentoValido || enviando} onClick={confirmar}>
              {enviando ? 'Importando...' : `Importar ${linhasBrutas.length} linha(s)`}
            </button>
          </div>
        </div>
      )}

      {etapa === 'resultado' && resultado && (
        <div className="form-card">
          <h3 style={{ marginBottom: 10 }}>Importação concluída</h3>
          {renderResumo(resultado)}
          {resultado.avisos.length > 0 && (
            <>
              <h4 className="subsection-title">Avisos</h4>
              <div className="template-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {resultado.avisos.map((a, i) => <div key={i} className="template-item"><span>{a}</span></div>)}
              </div>
            </>
          )}
          <div className="form-actions">
            <button className="btn primary" onClick={reiniciar}>Importar outro arquivo</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportarOrdensView({ db, onImportar }) {
  return (
    <ImportadorPlanilha
      titulo="Importar OS"
      descricao="Sobe uma planilha (.xlsx, .xls ou .csv) com OS's — de qualquer origem. Você escolhe qual coluna da planilha corresponde a cada campo do sistema. Cliente e equipamento são localizados pelo nome/série; se não existirem ainda, são criados automaticamente."
      campos={CAMPOS_IMPORTACAO}
      campoObrigatorio="clienteNome"
      mostrarTipoEquipamento
      db={db}
      onImportar={onImportar}
      linkModelo="/modelo_importacao_os.xlsx"
      renderResumo={(resultado) => (
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card success"><span className="stat-num">{resultado.ordensCriadas}</span><span className="stat-label">OS criadas</span></div>
          <div className="stat-card"><span className="stat-num">{resultado.clientesCriados}</span><span className="stat-label">Clientes novos</span></div>
          <div className="stat-card"><span className="stat-num">{resultado.equipamentosCriados}</span><span className="stat-label">Equipamentos novos</span></div>
          <div className="stat-card amber"><span className="stat-num">{resultado.avisos.length}</span><span className="stat-label">Avisos</span></div>
        </div>
      )}
    />
  );
}

const CAMPOS_IMPORTACAO_CLIENTES = [
  { key: 'codigo', label: 'Código (se já for cliente existente no sistema)' },
  { key: 'nome', label: 'Nome / Razão Social', obrigatorio: true },
  { key: 'apelido', label: 'Apelido / Fantasia' },
  { key: 'documento', label: 'CNPJ / CPF' },
  { key: 'contato', label: 'Contato' },
  { key: 'telefone', label: 'Cel / Whats' },
  { key: 'email', label: 'E-mail' },
  { key: 'cep', label: 'CEP' },
  { key: 'rua', label: 'Endereço' },
  { key: 'numero', label: 'Número' },
  { key: 'complemento', label: 'Complemento' },
  { key: 'bairro', label: 'Bairro' },
  { key: 'cidade', label: 'Cidade' },
  { key: 'estado', label: 'Estado' },
  { key: 'atuacao', label: 'Atuação' },
  { key: 'comoFicouSabendo', label: 'Como ficou sabendo?' },
  { key: 'observacoes', label: 'Observação' },
  { key: 'dataCadastro', label: 'Data Cadastro' },
];

function ImportarClientesView({ onImportar }) {
  return (
    <ImportadorPlanilha
      titulo="Importar clientes"
      descricao="Sobe a planilha de clientes (.xlsx, .xls ou .csv). Cliente já existente (mesmo nome) tem os dados atualizados em vez de duplicado."
      campos={CAMPOS_IMPORTACAO_CLIENTES}
      campoObrigatorio="nome"
      db={null}
      onImportar={onImportar}
      linkModelo="/modelo_importacao_clientes.xlsx"
      renderResumo={(resultado) => (
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card success"><span className="stat-num">{resultado.clientesCriados}</span><span className="stat-label">Clientes novos</span></div>
          <div className="stat-card"><span className="stat-num">{resultado.clientesAtualizados}</span><span className="stat-label">Clientes atualizados</span></div>
          <div className="stat-card amber"><span className="stat-num">{resultado.avisos.length}</span><span className="stat-label">Avisos</span></div>
        </div>
      )}
    />
  );
}

function SidebarBrand({ nomeEmpresa }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="brand">
      {!imgError ? (
        <img src="/logo.png" alt={nomeEmpresa || 'Logo'} className="brand-logo" onError={() => setImgError(true)} />
      ) : (
        <span className="brand-text">{(nomeEmpresa || 'Empresa').toUpperCase()}</span>
      )}
      <small>Engenharia clínica</small>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const usuario = await api.post('/auth.php', { email: email.trim(), senha });
      onLogin(usuario);
    } catch (err) {
      setErro(err.message || 'Não foi possível entrar.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="bancada-app login-screen">
      <style>{CSS}</style>
      <form className="login-card" onSubmit={entrar}>
        <div className="login-logo"><Lock size={22} /></div>
        <h1>Bancada</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>Entre com seu e-mail e senha.</p>
        {erro && <p className="login-erro">{erro}</p>}
        <label>E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label>Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        <button className="btn primary" type="submit" disabled={carregando} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

const PAPEL_LABEL = { gestao: 'Gestão', administrativo: 'Administrativo', tecnico: 'Técnico' };

function UsuariosView({ usuarioAtual }) {
  const [usuarios, setUsuarios] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [erro, setErro] = useState('');

  function carregar() {
    api.get('/usuarios.php').then(setUsuarios).catch((e) => setErro(e.message));
  }
  useEffect(() => { carregar(); }, []);

  async function salvar(dados) {
    setErro('');
    try {
      if (editing) await api.put(`/usuarios.php?id=${editing.id}`, dados);
      else await api.post('/usuarios.php', dados);
      setShowForm(false); setEditing(null);
      carregar();
    } catch (e) { setErro(e.message); }
  }

  async function excluir(id) {
    if (!window.confirm('Excluir este usuário?')) return;
    try { await api.del(`/usuarios.php?id=${id}`); carregar(); }
    catch (e) { window.alert(e.message); }
  }

  if (!usuarios) return <p className="muted small">Carregando...</p>;

  return (
    <div>
      <div className="view-header">
        <h2>Usuários</h2>
        <button className="btn primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={15} /> Novo usuário</button>
      </div>
      {erro && <p className="hint danger-text">{erro}</p>}

      {showForm && (
        <UsuarioForm initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={salvar} />
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nome}</td>
                <td>{u.email}</td>
                <td>{PAPEL_LABEL[u.papel] || u.papel}</td>
                <td>{Number(u.ativo) ? 'Ativo' : 'Inativo'}</td>
                <td className="row-actions">
                  <button className="link-btn" onClick={() => { setEditing(u); setShowForm(true); }}>Editar</button>
                  {u.id !== usuarioAtual.id && <button className="link-btn danger" onClick={() => excluir(u.id)}>Excluir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsuarioForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial ? { ...initial, senha: '' } : { nome: '', email: '', senha: '', papel: 'tecnico', ativo: 1 });
  return (
    <div className="form-card">
      <div className="form-grid">
        <label>Nome
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus />
        </label>
        <label>E-mail
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label>{initial ? 'Nova senha (deixe em branco pra manter)' : 'Senha'}
          <input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} />
        </label>
        <label>Papel
          <select value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value })}>
            <option value="gestao">Gestão — controle total</option>
            <option value="administrativo">Administrativo — abre/encerra OS, orçamento</option>
            <option value="tecnico">Técnico — preenche OS, fotos</option>
          </select>
        </label>
        {initial && (
          <label>Status
            <select value={f.ativo ? '1' : '0'} onChange={(e) => setF({ ...f, ativo: e.target.value === '1' })}>
              <option value="1">Ativo</option>
              <option value="0">Inativo (não consegue mais logar)</option>
            </select>
          </label>
        )}
      </div>
      <div className="form-actions">
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={!f.nome.trim() || !f.email.trim() || (!initial && !f.senha)} onClick={() => onSave(f)}>Salvar usuário</button>
      </div>
    </div>
  );
}

function Empty({ title, hint, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{hint}</p>
      {actionLabel && <button className="btn primary" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function ChecklistSection({ title, items, mode, onChange, onAdd, onRemove, defaultOpen = true }) {
  const [newItem, setNewItem] = useState('');
  const [open, setOpen] = useState(defaultOpen);
  const preenchidos = items.filter((i) => i.status && i.status !== 'pendente').length;
  return (
    <div className="checklist-card">
      <button type="button" className="checklist-header" onClick={() => setOpen((v) => !v)}>
        <h3>{title}</h3>
        <span className="checklist-header-right">
          {items.length > 0 && <span className="checklist-summary">{preenchidos}/{items.length}</span>}
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {open && (
        <>
          {items.length === 0 && <p className="muted small">Nenhum item ainda.</p>}
          {items.map((item) => (
            <div key={item.id} className="checklist-row">
              <span className="checklist-desc">{item.descricao}</span>
              <div className="status-btns">
                {mode === 'presenca' ? (
                  <>
                    <button type="button" className={`status-btn ${item.status === 'presente' ? 'active ok' : ''}`} onClick={() => onChange(item.id, { status: 'presente' })}>Presente</button>
                    <button type="button" className={`status-btn ${item.status === 'ausente' ? 'active bad' : ''}`} onClick={() => onChange(item.id, { status: 'ausente' })}>Ausente</button>
                  </>
                ) : mode === 'feito' ? (
                  <button type="button" className={`status-btn ${item.status === 'feito' ? 'active ok' : ''}`} onClick={() => onChange(item.id, { status: item.status === 'feito' ? 'pendente' : 'feito' })}>{item.status === 'feito' ? 'Concluído' : 'Marcar concluído'}</button>
                ) : (
                  <>
                    <button type="button" className={`status-btn ${item.status === 'ok' ? 'active ok' : ''}`} onClick={() => onChange(item.id, { status: 'ok' })}>OK</button>
                    <button type="button" className={`status-btn ${item.status === 'nao_ok' ? 'active bad' : ''}`} onClick={() => onChange(item.id, { status: 'nao_ok' })}>Não OK</button>
                    <button type="button" className={`status-btn ${item.status === 'na' ? 'active neutral' : ''}`} onClick={() => onChange(item.id, { status: 'na' })}>N/A</button>
                  </>
                )}
              </div>
              <input className="checklist-obs" placeholder="Observação" defaultValue={item.obs} onBlur={(e) => onChange(item.id, { obs: e.target.value })} />
              <button type="button" className="icon-btn" onClick={() => onRemove(item.id)} title="Remover item"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="checklist-add">
            <input placeholder="Adicionar item ao checklist..." value={newItem} onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) { onAdd(newItem.trim()); setNewItem(''); } }} />
            <button type="button" className="btn small" onClick={() => { if (newItem.trim()) { onAdd(newItem.trim()); setNewItem(''); } }}><Plus size={14} /> Adicionar</button>
          </div>
        </>
      )}
    </div>
  );
}

function PecasList({ pecas, onChange, pecasCatalogo, onUpsertPeca }) {
  const [desc, setDesc] = useState('');
  const [preco, setPreco] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);

  const q = desc.trim().toLowerCase();
  const sugestoes = q ? pecasCatalogo.filter((p) => p.descricao.toLowerCase().includes(q)).slice(0, 8) : [];

  function selecionarSugestao(p) {
    setDesc(p.descricao);
    setPreco(String(p.preco));
    setShowSuggest(false);
  }

  function add() {
    if (!desc.trim()) return;
    const precoFinal = preco || '0';
    onChange([...pecas, { id: uid(), descricao: desc.trim(), preco: precoFinal }]);
    onUpsertPeca(desc.trim(), precoFinal);
    setDesc(''); setPreco(''); setShowSuggest(false);
  }
  function remove(id) { onChange(pecas.filter((p) => p.id !== id)); }
  function updateDesc(id, val) {
    onChange(pecas.map((p) => (p.id === id ? { ...p, descricao: val } : p)));
    const row = pecas.find((p) => p.id === id);
    if (row && val.trim()) onUpsertPeca(val.trim(), row.preco);
  }
  function updatePreco(id, val) {
    onChange(pecas.map((p) => (p.id === id ? { ...p, preco: val } : p)));
    const row = pecas.find((p) => p.id === id);
    if (row) onUpsertPeca(row.descricao, val);
  }

  const subtotal = pecas.reduce((s, p) => s + (Number(p.preco) || 0), 0);

  return (
    <div className="pecas-list">
      {pecas.length === 0 && <p className="muted small">Nenhuma peça lançada.</p>}
      {pecas.map((p) => (
        <div key={p.id} className="peca-row">
          <input className="peca-desc" defaultValue={p.descricao} placeholder="Descrição da peça" onBlur={(e) => updateDesc(p.id, e.target.value)} />
          <input className="peca-preco" type="number" step="0.01" defaultValue={p.preco} placeholder="0,00" onBlur={(e) => updatePreco(p.id, e.target.value)} />
          <button type="button" className="icon-btn" onClick={() => remove(p.id)} title="Remover peça"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="peca-add">
        <div className="autocomplete">
          <input placeholder="Nova peça..." value={desc}
            onChange={(e) => { setDesc(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          {showSuggest && sugestoes.length > 0 && (
            <div className="autocomplete-list">
              {sugestoes.map((s) => (
                <button type="button" key={s.id} className="autocomplete-item autocomplete-peca" onMouseDown={() => selecionarSugestao(s)}>
                  <span>{s.descricao}</span><span className="autocomplete-price">{fmtMoney(s.preco)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input type="number" step="0.01" placeholder="Preço" value={preco} onChange={(e) => setPreco(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button type="button" className="btn small" onClick={add}><Plus size={14} /> Adicionar</button>
      </div>
      <p className="subtotal-line">Subtotal de peças: <strong>{fmtMoney(subtotal)}</strong></p>
    </div>
  );
}

function FotosSection({ ordemId, fotos, onUpload, onRemove }) {
  const [processing, setProcessing] = useState(false);
  const [erro, setErro] = useState('');

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setErro('');
    setProcessing(true);
    try {
      for (const file of files) {
        await onUpload(ordemId, file, '');
      }
    } catch (err) {
      setErro(err.message || 'Falha ao enviar foto.');
    } finally {
      setProcessing(false);
    }
  }

  async function remove(fotoId) {
    try { await onRemove(ordemId, fotoId); }
    catch (err) { window.alert(err.message || 'Falha ao remover foto.'); }
  }

  return (
    <div className="checklist-card">
      <h3>Fotos do serviço</h3>
      <p className="muted small">Aparecem em uma segunda página ao imprimir a OS.</p>
      {erro && <p className="hint danger-text">{erro}</p>}
      {fotos.length === 0 && <p className="muted small">Nenhuma foto anexada.</p>}
      {fotos.length > 0 && (
        <div className="fotos-grid">
          {fotos.map((f) => (
            <div key={f.id} className="foto-card">
              <img src={`${API_BASE}/${f.url}`} alt={f.legenda || ''} />
              <button type="button" className="icon-btn" onClick={() => remove(f.id)} title="Remover foto"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <label className="btn small foto-upload-btn">
        <Camera size={14} /> {processing ? 'Enviando…' : 'Adicionar foto'}
        <input type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: 'none' }} disabled={processing} />
      </label>
    </div>
  );
}

/* ---------- forms ---------- */
function ClienteForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || {
    nome: '', tipoPessoa: 'PF', documento: '', apelido: '', contato: '', telefone: '', email: '',
    cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
    atuacao: '', comoFicouSabendo: '', observacoes: '', dataCadastro: '',
  });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepErro, setCepErro] = useState('');

  async function buscarCep(valorDigitado) {
    const cepLimpo = valorDigitado.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    setCepErro('');
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const dados = await resp.json();
      if (dados.erro) {
        setCepErro('CEP não encontrado.');
      } else {
        setF((prev) => ({
          ...prev,
          rua: dados.logradouro || prev.rua,
          bairro: dados.bairro || prev.bairro,
          cidade: dados.localidade || prev.cidade,
          estado: dados.uf || prev.estado,
        }));
      }
    } catch {
      setCepErro('Não foi possível consultar o CEP agora.');
    } finally {
      setBuscandoCep(false);
    }
  }

  return (
    <div className="form-card">
      <div className="form-grid">
        <label>Nome / razão social
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus />
        </label>
        <label>Tipo
          <select value={f.tipoPessoa} onChange={(e) => setF({ ...f, tipoPessoa: e.target.value })}>
            <option value="PF">Pessoa física</option>
            <option value="PJ">Pessoa jurídica</option>
          </select>
        </label>
        <label>CPF / CNPJ
          <input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} />
        </label>
        <label>Apelido / fantasia
          <input value={f.apelido} onChange={(e) => setF({ ...f, apelido: e.target.value })} />
        </label>
        <label>Contato (com quem falar)
          <input value={f.contato} onChange={(e) => setF({ ...f, contato: e.target.value })} />
        </label>
        <label>Atuação
          <input value={f.atuacao} onChange={(e) => setF({ ...f, atuacao: e.target.value })} placeholder="médico, dentista, podólogo..." />
        </label>
        <label>Telefone
          <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
        </label>
        <label>E-mail
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label>CEP
          <input
            value={f.cep}
            onChange={(e) => setF({ ...f, cep: e.target.value })}
            onBlur={(e) => buscarCep(e.target.value)}
            placeholder="00000-000"
            maxLength={9}
          />
          {buscandoCep && <span className="muted small">Buscando endereço...</span>}
          {cepErro && <span className="muted small" style={{ color: '#c0392b' }}>{cepErro}</span>}
        </label>
        <label className="span-2">Rua
          <input value={f.rua} onChange={(e) => setF({ ...f, rua: e.target.value })} />
        </label>
        <label>Número
          <input value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
        </label>
        <label>Complemento
          <input value={f.complemento} onChange={(e) => setF({ ...f, complemento: e.target.value })} placeholder="sala, loja, andar..." />
        </label>
        <label>Bairro
          <input value={f.bairro} onChange={(e) => setF({ ...f, bairro: e.target.value })} />
        </label>
        <label>Cidade
          <input value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} />
        </label>
        <label>Estado
          <input value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value.toUpperCase() })} maxLength={2} placeholder="SP" />
        </label>
        <label>Como ficou sabendo?
          <input value={f.comoFicouSabendo} onChange={(e) => setF({ ...f, comoFicouSabendo: e.target.value })} placeholder="indicação, Instagram, Google..." />
        </label>
        <label>Data de cadastro
          <input type="date" value={f.dataCadastro || ''} onChange={(e) => setF({ ...f, dataCadastro: e.target.value })} />
        </label>
        <label className="span-2">Observações
          <textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} placeholder="preferências de atendimento, pendências, etc." />
        </label>
      </div>
      <div className="form-actions">
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={!f.nome.trim()} onClick={() => onSave(f)}>Salvar cliente</button>
      </div>
    </div>
  );
}

function TemplateItemList({ items, onChange }) {
  const [val, setVal] = useState('');
  function add() { if (!val.trim()) return; onChange([...items, val.trim()]); setVal(''); }
  function remove(i) { onChange(items.filter((_, idx) => idx !== i)); }
  return (
    <div className="template-list">
      {items.length === 0 && <p className="muted small">Nenhum item ainda.</p>}
      {items.map((it, i) => (
        <div key={i} className="template-item">
          <span>{it}</span>
          <button type="button" className="icon-btn" onClick={() => remove(i)}><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="template-add">
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Adicionar item..."
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn small" onClick={add}><Plus size={13} /></button>
      </div>
    </div>
  );
}

function TipoEquipamentoForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || { nome: '', checklistEntradaPadrao: [], checklistPrePadrao: [], checklistPosPadrao: [], intervaloPreventivoMeses: '' });
  return (
    <div className="form-card">
      <div className="form-grid">
        <label className="span-2">Nome do tipo
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus placeholder="ex: Autoclave horizontal de bancada" />
        </label>
        <label>Prazo de preventiva (meses)
          <input type="number" min="1" value={f.intervaloPreventivoMeses} onChange={(e) => setF({ ...f, intervaloPreventivoMeses: e.target.value })} placeholder="Padrão: 12" />
        </label>
      </div>
      <h4 className="subsection-title">Itens removíveis na entrada</h4>
      <TemplateItemList items={f.checklistEntradaPadrao} onChange={(v) => setF({ ...f, checklistEntradaPadrao: v })} />
      <h4 className="subsection-title">Testes antes do orçamento</h4>
      <TemplateItemList items={f.checklistPrePadrao} onChange={(v) => setF({ ...f, checklistPrePadrao: v })} />
      <h4 className="subsection-title">Testes após o orçamento</h4>
      <TemplateItemList items={f.checklistPosPadrao} onChange={(v) => setF({ ...f, checklistPosPadrao: v })} />
      <div className="form-actions">
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={!f.nome.trim()} onClick={() => onSave(f)}>Salvar tipo de equipamento</button>
      </div>
    </div>
  );
}

function TiposEquipamentoView({ db, onAdd, onEdit, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  return (
    <div>
      <div className="view-header">
        <h2>Tipos de equipamento</h2>
        <button className="btn primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={15} /> Novo tipo</button>
      </div>
      <p className="muted small" style={{ marginBottom: 14 }}>Cada tipo tem seu próprio checklist — assim um compressor nunca mostra item de autoclave.</p>

      {showForm && (
        <TipoEquipamentoForm
          initial={editing}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={(data) => { editing ? onEdit(editing.id, data) : onAdd(data); setShowForm(false); setEditing(null); }}
        />
      )}

      {db.tiposEquipamento.length === 0 ? (
        <Empty title="Nenhum tipo cadastrado" hint="Cadastre os tipos de equipamento que vocês atendem, cada um com seu checklist específico." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Prazo preventiva</th><th>Itens de entrada</th><th>Testes pré</th><th>Testes pós</th><th>Equipamentos</th><th></th></tr></thead>
            <tbody>
              {db.tiposEquipamento.map((t) => (
                <tr key={t.id}>
                  <td>{t.nome}</td>
                  <td>{t.intervaloPreventivoMeses ? `${t.intervaloPreventivoMeses} meses` : 'Padrão (12)'}</td>
                  <td>{t.checklistEntradaPadrao.length}</td>
                  <td>{t.checklistPrePadrao.length}</td>
                  <td>{t.checklistPosPadrao.length}</td>
                  <td>{db.equipamentos.filter((e) => e.tipoEquipamentoId === t.id).length}</td>
                  <td className="row-actions">
                    <button className="link-btn" onClick={() => { setEditing(t); setShowForm(true); }}>Editar</button>
                    <button className="link-btn danger" onClick={() => onDelete(t.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EquipamentoForm({ initial, clientes, tiposEquipamento, lockedClienteId, onCreateTipo, onSave, onCancel }) {
  const [f, setF] = useState(() => {
    if (initial) return { ...initial };
    return { clienteId: lockedClienteId || clientes[0]?.id || '', tipoEquipamentoId: tiposEquipamento[0]?.id || '', marca: '', modelo: '', numeroSerie: '', patrimonio: '', dataFabricacao: '', tensao: '' };
  });
  const [showNovoTipo, setShowNovoTipo] = useState(false);
  const [novoTipoNome, setNovoTipoNome] = useState('');
  const legadoSemTipo = initial && !initial.tipoEquipamentoId && initial.tipo;

  async function criarTipoRapido() {
    if (!novoTipoNome.trim()) return;
    const novo = await onCreateTipo({ nome: novoTipoNome.trim(), checklistEntradaPadrao: [], checklistPrePadrao: [], checklistPosPadrao: [] });
    setF((prev) => ({ ...prev, tipoEquipamentoId: novo.id }));
    setNovoTipoNome('');
    setShowNovoTipo(false);
  }

  return (
    <div className="form-card">
      <div className="form-grid">
        {!lockedClienteId && (
          <label>Cliente
            <ClienteAutocomplete clientes={clientes} value={f.clienteId} onChange={(id) => setF({ ...f, clienteId: id })} />
          </label>
        )}
        <label>Tipo de equipamento
          <select value={f.tipoEquipamentoId} onChange={(e) => setF({ ...f, tipoEquipamentoId: e.target.value })} disabled={tiposEquipamento.length === 0}>
            {tiposEquipamento.length === 0 && <option value="">Nenhum tipo cadastrado</option>}
            {tiposEquipamento.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </label>
        <div className="inline-add-btn">
          <button type="button" className="btn small ghost" onClick={() => setShowNovoTipo((v) => !v)}>{showNovoTipo ? 'Cancelar' : '+ Novo tipo'}</button>
        </div>
        <label>Marca
          <input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} />
        </label>
        <label>Modelo
          <input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} />
        </label>
        <label>Nº de série
          <input value={f.numeroSerie} onChange={(e) => setF({ ...f, numeroSerie: e.target.value })} />
        </label>
        <label>Patrimônio (opcional)
          <input value={f.patrimonio} onChange={(e) => setF({ ...f, patrimonio: e.target.value })} />
        </label>
        <label>Data de fabricação
          <input placeholder="ex: 07/2021" value={f.dataFabricacao} onChange={(e) => setF({ ...f, dataFabricacao: e.target.value })} />
        </label>
        <label>Tensão
          <select value={f.tensao} onChange={(e) => setF({ ...f, tensao: e.target.value })}>
            <option value="">Não informada</option>
            <option value="127V">127V</option>
            <option value="220V">220V</option>
            <option value="Bivolt manual">Bivolt manual</option>
            <option value="Bivolt automático">Bivolt automático</option>
          </select>
        </label>
      </div>

      {legadoSemTipo && (
        <p className="hint">Este equipamento foi cadastrado antes do catálogo de tipos (era "{initial.tipo}") — selecione o tipo correto acima.</p>
      )}

      {showNovoTipo && (
        <div className="quick-add-card">
          <span className="quick-add-title">Cadastro rápido de tipo de equipamento</span>
          <p className="muted small">Sem checklist por enquanto — dá pra detalhar depois em "Tipos de equipamento".</p>
          <div className="form-grid">
            <label className="span-2">Nome do tipo
              <input value={novoTipoNome} onChange={(e) => setNovoTipoNome(e.target.value)} placeholder="ex: Compressor odontológico" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarTipoRapido(); } }} />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={() => setShowNovoTipo(false)}>Cancelar</button>
            <button type="button" className="btn primary" disabled={!novoTipoNome.trim()} onClick={criarTipoRapido}>Criar tipo</button>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={!f.clienteId || !f.tipoEquipamentoId} onClick={() => onSave(f)}>Salvar equipamento</button>
      </div>
    </div>
  );
}

function OsForm({ clientes, equipamentos, tiposEquipamento, tecnicos, onCreateCliente, onSave, onCancel }) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id || '');
  const equipsDoCliente = equipamentos.filter((e) => e.clienteId === clienteId);
  const [equipamentoId, setEquipamentoId] = useState(equipsDoCliente[0]?.id || '');
  const [tipoAtendimento, setTipoAtendimento] = useState('interno');
  const [origem, setOrigem] = useState('cliente_trouxe');
  const [tipoManutencao, setTipoManutencao] = useState('preventiva');
  const [tecnico, setTecnico] = useState('');
  const [dataEntrada, setDataEntrada] = useState(todayStr());
  const [obsInicial, setObsInicial] = useState('');
  const [checklistEntrada, setChecklistEntrada] = useState([]);
  const [novoClienteNome, setNovoClienteNome] = useState(null);

  useEffect(() => {
    const list = equipamentos.filter((e) => e.clienteId === clienteId);
    setEquipamentoId(list[0]?.id || '');
    // eslint-disable-next-line
  }, [clienteId]);

  useEffect(() => {
    if (tipoAtendimento !== 'interno' || !equipamentoId) { setChecklistEntrada([]); return; }
    const equip = equipamentos.find((e) => e.id === equipamentoId);
    const tmpl = getChecklistTemplateForEquip(tiposEquipamento, equip);
    setChecklistEntrada(makeChecklist(tmpl.entrada));
    // eslint-disable-next-line
  }, [equipamentoId, tipoAtendimento]);

  function patchChecklist(id, patch) { setChecklistEntrada((items) => items.map((it) => (it.id === id ? { ...it, ...patch } : it))); }
  function addChecklist(desc) { setChecklistEntrada((items) => [...items, { id: uid(), descricao: desc, status: 'pendente', obs: '' }]); }
  function removeChecklist(id) { setChecklistEntrada((items) => items.filter((it) => it.id !== id)); }

  const podeCriar = clienteId && equipamentoId;

  return (
    <div className="form-card">
      <div className="form-grid">
        <label>Tipo de atendimento
          <select value={tipoAtendimento} onChange={(e) => setTipoAtendimento(e.target.value)}>
            <option value="interno">Interno (oficina)</option>
            <option value="externo">Externo (in loco)</option>
          </select>
        </label>
        <label>Cliente
          <ClienteAutocomplete clientes={clientes} value={clienteId} onChange={setClienteId} onCreateNew={setNovoClienteNome} />
        </label>
        <label>Equipamento
          <select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)} disabled={equipsDoCliente.length === 0}>
            {equipsDoCliente.length === 0 && <option value="">Nenhum equipamento cadastrado</option>}
            {equipsDoCliente.map((eq) => <option key={eq.id} value={eq.id}>{tipoNomeFor(tiposEquipamento, eq)} — {eq.marca} {eq.modelo}</option>)}
          </select>
        </label>
        {tipoAtendimento === 'interno' && (
          <label>Origem
            <select value={origem} onChange={(e) => setOrigem(e.target.value)}>
              <option value="cliente_trouxe">Cliente trouxe</option>
              <option value="retirada">Retirada no local</option>
            </select>
          </label>
        )}
        <label>Tipo de manutenção
          <select value={tipoManutencao} onChange={(e) => setTipoManutencao(e.target.value)}>
            <option value="preventiva">Preventiva</option>
            <option value="corretiva">Corretiva</option>
            <option value="preditiva">Preditiva</option>
            <option value="preventiva_corretiva">Preventiva e Corretiva</option>
          </select>
        </label>
        <label>Técnico responsável
          <select value={tecnico} onChange={(e) => setTecnico(e.target.value)} disabled={tecnicos.length === 0}>
            <option value="">{tecnicos.length === 0 ? 'Nenhum técnico cadastrado' : 'Selecione...'}</option>
            {tecnicos.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
          </select>
        </label>
        <label>{tipoAtendimento === 'externo' ? 'Data da visita' : 'Data de entrada'}
          <input type="date" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} />
        </label>
        <label className="span-2">Observações iniciais
          <textarea rows={2} value={obsInicial} onChange={(e) => setObsInicial(e.target.value)} />
        </label>
      </div>
      {equipsDoCliente.length === 0 && <p className="hint">Este cliente ainda não tem equipamentos cadastrados. Cadastre um equipamento antes de abrir a OS.</p>}
      {tecnicos.length === 0 && <p className="hint">Nenhum técnico cadastrado ainda — cadastre em "Empresa".</p>}

      {novoClienteNome !== null && (
        <ClienteQuickCreate
          nomeInicial={novoClienteNome}
          onCancel={() => setNovoClienteNome(null)}
          onSave={async (data) => {
            const novo = await onCreateCliente(data);
            setClienteId(novo.id);
            setNovoClienteNome(null);
          }}
        />
      )}

      {tipoAtendimento === 'interno' && equipamentoId && (
        <>
          <p className="hint" style={{ marginBottom: 10 }}>Esse checklist sai no comprovante de custódia — marque o que veio junto com o equipamento antes de salvar.</p>
          <ChecklistSection title="Itens recebidos junto com o equipamento" mode="presenca" items={checklistEntrada}
            onChange={patchChecklist} onAdd={addChecklist} onRemove={removeChecklist} defaultOpen />
        </>
      )}

      <div className="form-actions">
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={!podeCriar} onClick={() => onSave({ clienteId, equipamentoId, tipoAtendimento, origem: tipoAtendimento === 'externo' ? 'retirada' : origem, tipoManutencao, tecnico, dataEntrada, obsInicial, checklistEntradaPreenchido: checklistEntrada })}>Abrir ordem de serviço</button>
      </div>
    </div>
  );
}

/* ---------- views ---------- */
function Dashboard({ db, onOpenOs, onGoNovaOs, onMarcarContatado }) {
  const ordens = db.ordens;
  const abertas = ordens.filter((o) => !['entregue', 'reprovado'].includes(o.status));
  const decisao = ordens.filter((o) => ['em_orcamento', 'aguardando_aprovacao'].includes(o.status));
  const execucao = ordens.filter((o) => ['aprovado', 'em_execucao'].includes(o.status));
  const entregues = ordens.filter((o) => o.status === 'entregue');
  const pendentes = [...abertas].sort((a, b) => a.dataEntrada.localeCompare(b.dataEntrada)).slice(0, 8);
  const revisoes = getRevisoesPendentes(db);
  const custodia = getOsEmCustodia(db);
  const [printSeq, setPrintSeq] = useState(0);
  useEffect(() => { if (printSeq > 0) window.print(); }, [printSeq]);

  if (ordens.length === 0) {
    return <Empty title="Nenhuma ordem de serviço ainda" hint="Cadastre um cliente, um equipamento e abra a primeira OS para ver o painel funcionando." actionLabel="Abrir nova OS" onAction={onGoNovaOs} />;
  }

  function contatar(item) {
    const nome = tipoNomeFor(db.tiposEquipamento, item.equipamento);
    const mensagem = montarMensagemRenovacao(db.empresa.mensagemRenovacao, { clienteNome: item.cliente?.nome, equipamentoNome: nome, empresaNome: db.empresa.nome, marca: item.equipamento.marca, modelo: item.equipamento.modelo });
    const numero = telefoneParaWhatsapp(item.cliente?.telefone);
    if (!numero) { window.alert('Este cliente não tem telefone cadastrado.'); return; }
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`, '_blank');
    onMarcarContatado(item.equipamento.id, item.dataUltimaPreventiva);
  }

  return (
    <div>
      <div className="screen-only">
        <div className="view-header">
          <h2>Painel</h2>
          <button type="button" className="btn ghost" onClick={() => setPrintSeq(Date.now())}><Printer size={15} /> Relatório de pendências</button>
        </div>

        <div className="stat-grid">
          <div className="stat-card"><span className="stat-num">{abertas.length}</span><span className="stat-label">Abertas</span></div>
          <div className="stat-card amber"><span className="stat-num">{decisao.length}</span><span className="stat-label">Aguardando decisão</span></div>
          <div className="stat-card accent"><span className="stat-num">{execucao.length}</span><span className="stat-label">Em execução</span></div>
          <div className="stat-card success"><span className="stat-num">{entregues.length}</span><span className="stat-label">Entregues</span></div>
        </div>

        {custodia.length > 0 && (
          <>
            <h3 className="section-title">Equipamentos parados aguardando retirada ({custodia.length})</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Concluído em</th><th>Dias parado</th><th></th></tr></thead>
                <tbody>
                  {custodia.map(({ os, dias, vencido }) => {
                    const cli = db.clientes.find((c) => c.id === os.clienteId);
                    const eq = db.equipamentos.find((e) => e.id === os.equipamentoId);
                    return (
                      <tr key={os.id} className="clickable" onClick={() => onOpenOs(os.id)}>
                        <td><OsTag numero={os.numero} /></td>
                        <td>{cli?.nome || '—'}</td>
                        <td>{eq ? tipoNomeFor(db.tiposEquipamento, eq) : '—'}</td>
                        <td>{fmtDate(os.dataConclusao)}</td>
                        <td>{dias} dias</td>
                        <td><Badge tone={vencido ? 'danger' : 'amber'}>{vencido ? 'Limite atingido' : 'Alerta'}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {revisoes.length > 0 && (
          <>
            <h3 className="section-title">Revisões preventivas para recontatar ({revisoes.length})</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Cliente</th><th>Equipamento</th><th>Última preventiva</th><th>Há quanto tempo</th><th></th></tr></thead>
                <tbody>
                  {revisoes.map((item) => (
                    <tr key={item.equipamento.id}>
                      <td>{item.cliente?.nome || '—'}</td>
                      <td>{tipoNomeFor(db.tiposEquipamento, item.equipamento)}</td>
                      <td>{fmtDate(item.dataUltimaPreventiva)}</td>
                      <td>{item.meses} {item.meses === 1 ? 'mês' : 'meses'}</td>
                      <td className="row-actions">
                        <button type="button" className="link-btn" onClick={() => contatar(item)}>WhatsApp</button>
                        <button type="button" className="link-btn" onClick={() => onMarcarContatado(item.equipamento.id, item.dataUltimaPreventiva)}>Marcar como contatado</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3 className="section-title">Precisam de atenção</h3>
        <table className="data-table">
          <thead><tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Tipo</th><th>Status</th><th>Entrada</th></tr></thead>
          <tbody>
            {pendentes.map((os) => {
              const eq = db.equipamentos.find((e) => e.id === os.equipamentoId);
              const cli = db.clientes.find((c) => c.id === os.clienteId);
              const meta = STATUS_META[os.status];
              return (
                <tr key={os.id} className="clickable" onClick={() => onOpenOs(os.id)}>
                  <td><OsTag numero={os.numero} /></td>
                  <td>{cli?.nome || '—'}</td>
                  <td>{eq ? tipoNomeFor(db.tiposEquipamento, eq) : '—'}</td>
                  <td>{TIPO_LABEL[os.tipoManutencao]}</td>
                  <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  <td>{fmtDate(os.dataEntrada)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {printSeq > 0 && <PrintableRelatorioPendencias db={db} />}
    </div>
  );
}

function ClientesView({ db, onAdd, onEdit, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  return (
    <div>
      <div className="view-header">
        <h2>Clientes</h2>
        <button className="btn primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={15} /> Novo cliente</button>
      </div>

      {showForm && (
        <ClienteForm
          initial={editing}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={(data) => { editing ? onEdit(editing.id, data) : onAdd(data); setShowForm(false); setEditing(null); }}
        />
      )}

      {db.clientes.length === 0 ? (
        <Empty title="Nenhum cliente cadastrado" hint="Cadastre o primeiro cliente para começar a vincular equipamentos e ordens de serviço." />
      ) : (
        <table className="data-table">
          <thead><tr><th>Código</th><th>Nome</th><th>Documento</th><th>Telefone</th><th>Equipamentos</th><th></th></tr></thead>
          <tbody>
            {db.clientes.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.codigo || '—'}</td>
                <td>{c.nome}</td>
                <td>{c.documento || '—'}</td>
                <td>{c.telefone || '—'}</td>
                <td>{db.equipamentos.filter((e) => e.clienteId === c.id).length}</td>
                <td className="row-actions">
                  <button className="link-btn" onClick={() => { setEditing(c); setShowForm(true); }}>Editar</button>
                  <button className="link-btn danger" onClick={() => onDelete(c.id)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EquipamentosView({ db, onAdd, onEdit, onDelete, onCreateTipo }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filtroCliente, setFiltroCliente] = useState('');

  const lista = db.equipamentos.filter((e) => !filtroCliente || e.clienteId === filtroCliente);

  if (db.clientes.length === 0) {
    return <Empty title="Cadastre um cliente primeiro" hint="Todo equipamento precisa estar vinculado a um cliente." />;
  }
  if (db.tiposEquipamento.length === 0) {
    return <Empty title="Cadastre um tipo de equipamento primeiro" hint='Vá em "Tipos de equipamento" e cadastre pelo menos um tipo, com seu checklist específico.' />;
  }

  return (
    <div>
      <div className="view-header">
        <h2>Equipamentos</h2>
        <button className="btn primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={15} /> Novo equipamento</button>
      </div>

      {showForm && (
        <EquipamentoForm
          initial={editing}
          clientes={db.clientes}
          tiposEquipamento={db.tiposEquipamento}
          onCreateTipo={onCreateTipo}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={(data) => { editing ? onEdit(editing.id, data) : onAdd(data); setShowForm(false); setEditing(null); }}
        />
      )}

      <div className="filter-row">
        <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {db.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {lista.length === 0 ? (
        <Empty title="Nenhum equipamento aqui" hint="Cadastre um equipamento para poder abrir ordens de serviço para ele." />
      ) : (
        <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Cliente</th><th>Tipo</th><th>Marca / modelo</th><th>Nº série</th><th>Tensão</th><th></th></tr></thead>
          <tbody>
            {lista.map((eq) => {
              const cli = db.clientes.find((c) => c.id === eq.clienteId);
              return (
                <tr key={eq.id}>
                  <td>{cli?.nome || '—'}</td>
                  <td>{tipoNomeFor(db.tiposEquipamento, eq)}</td>
                  <td>{eq.marca} {eq.modelo}</td>
                  <td className="mono">{eq.numeroSerie || '—'}</td>
                  <td>{eq.tensao || '—'}</td>
                  <td className="row-actions">
                    <button className="link-btn" onClick={() => { setEditing(eq); setShowForm(true); }}>Editar</button>
                    <button className="link-btn danger" onClick={() => onDelete(eq.id)}>Excluir</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function OrdensView({ db, onCreate, onOpen, forceOpenForm, onConsumedForceOpen, onCreateCliente }) {
  const [showForm, setShowForm] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (forceOpenForm) { setShowForm(true); onConsumedForceOpen(); }
    // eslint-disable-next-line
  }, [forceOpenForm]);

  if (db.clientes.length === 0 || db.equipamentos.length === 0) {
    return <Empty title="Cadastre cliente e equipamento primeiro" hint="Uma ordem de serviço sempre parte de um equipamento já cadastrado." />;
  }

  let lista = db.ordens;
  if (filtroStatus) lista = lista.filter((o) => o.status === filtroStatus);
  if (busca.trim()) {
    const b = busca.toLowerCase();
    lista = lista.filter((o) => {
      const cli = db.clientes.find((c) => c.id === o.clienteId);
      const eq = db.equipamentos.find((e) => e.id === o.equipamentoId);
      return o.numero.toLowerCase().includes(b) || cli?.nome.toLowerCase().includes(b) || tipoNomeFor(db.tiposEquipamento, eq).toLowerCase().includes(b);
    });
  }
  lista = [...lista].sort((a, b) => b.dataEntrada.localeCompare(a.dataEntrada));

  return (
    <div>
      <div className="view-header">
        <h2>Ordens de serviço</h2>
        <button className="btn primary" onClick={() => setShowForm(true)}><Plus size={15} /> Nova OS</button>
      </div>

      {showForm && (
        <OsForm clientes={db.clientes} equipamentos={db.equipamentos} tiposEquipamento={db.tiposEquipamento} tecnicos={db.tecnicos} onCreateCliente={onCreateCliente}
          onCancel={() => setShowForm(false)}
          onSave={(data) => { onCreate(data); setShowForm(false); }} />
      )}

      <div className="filter-row">
        <div className="search-box">
          <Search size={14} />
          <input placeholder="Buscar por OS, cliente ou equipamento..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {lista.length === 0 ? (
        <Empty title="Nenhuma ordem encontrada" hint="Ajuste os filtros ou abra uma nova OS." />
      ) : (
        <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Atendimento</th><th>Tipo</th><th>Status</th><th>Entrada</th></tr></thead>
          <tbody>
            {lista.map((os) => {
              const eq = db.equipamentos.find((e) => e.id === os.equipamentoId);
              const cli = db.clientes.find((c) => c.id === os.clienteId);
              const meta = STATUS_META[os.status];
              return (
                <tr key={os.id} className="clickable" onClick={() => onOpen(os.id)}>
                  <td><OsTag numero={os.numero} /></td>
                  <td>{cli?.nome || '—'}</td>
                  <td>{eq ? tipoNomeFor(db.tiposEquipamento, eq) : '—'}</td>
                  <td>{os.tipoAtendimento === 'externo' ? 'Externo' : 'Interno'}</td>
                  <td>{TIPO_LABEL[os.tipoManutencao]}</td>
                  <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  <td>{fmtDate(os.dataEntrada)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function PrintableOs({ os, cliente, equipamento, empresa, tipoNome }) {
  const orc = normalizeOrcamento(os.orcamento);
  const subtotalPecas = orc.pecas.reduce((s, p) => s + (Number(p.preco) || 0), 0);
  const totalGeral = (Number(orc.valorServico) || 0) + subtotalPecas + (Number(orc.deslocamento) || 0) - (Number(orc.desconto) || 0);
  const acessorios = os.checklistEntrada.filter((i) => i.status === 'presente').map((i) => i.descricao).join(', ');
  const fotos = os.fotos || [];

  return (
    <div className="print-only print-doc">
      <div className="print-header">
        <div className="print-header-left">
          {empresa.logoDataUrl ? <img src={empresa.logoDataUrl} alt="logo" className="print-logo" /> : <div className="print-logo-placeholder">{empresa.nome || 'Empresa'}</div>}
          <h1>Ordem de Serviço</h1>
        </div>
        <div className="print-header-right">
          <div className="print-os-number"><span>Ordem de Serviço</span><strong>{os.numero}</strong></div>
          <div className="print-dates"><span>Abertura: {fmtDate(os.dataEntrada)}</span><span>Conclusão: {fmtDate(os.dataConclusao)}</span></div>
        </div>
      </div>

      <section className="print-section">
        <h2>Dados do cliente</h2>
        <p>{cliente?.codigo ? `${cliente.codigo} — ` : ''}{cliente?.nome || '—'}{cliente?.telefone ? ` - ${cliente.telefone}` : ''}</p>
        <p>{cliente?.endereco || ''}{cliente?.documento ? ` - CPF/CNPJ: ${cliente.documento}` : ''}</p>
      </section>

      <section className="print-section print-grid-2">
        <div>
          <h2>Dados do produto/serviço</h2>
          <p><strong>Equip.:</strong> {tipoNome || equipamento?.tipo || '—'}</p>
          <p><strong>Nº de série:</strong> {equipamento?.numeroSerie || '—'}</p>
          <p><strong>Acessórios:</strong> {acessorios || 'Sem acessórios'}</p>
        </div>
        <div>
          <p><strong>Marca:</strong> {equipamento?.marca || '—'}</p>
          <p><strong>Data fabr.:</strong> {equipamento?.dataFabricacao || '—'}</p>
          <p><strong>Tensão:</strong> {equipamento?.tensao || '—'}</p>
          <p><strong>Garantia equip.:</strong> {os.garantiaEquipamento === 'sim' ? 'Sim' : os.garantiaEquipamento === 'nao' ? 'Não' : '—'}</p>
        </div>
      </section>

      <section className="print-section">
        <h2>Relato / solicitação do cliente</h2>
        <p>{os.observacoesGerais || '—'}</p>
      </section>

      <section className="print-section">
        <h2>Serviço realizado</h2>
        <p>{orc.descricaoServico || '—'}</p>
      </section>

      <section className="print-section">
        <h2>Peças utilizadas</h2>
        <table className="print-table">
          <thead><tr><th>Item</th><th>Descrição</th><th>Valor</th></tr></thead>
          <tbody>
            {orc.pecas.length === 0 && <tr><td colSpan={3} className="print-muted">Nenhuma peça utilizada</td></tr>}
            {orc.pecas.map((p, i) => (<tr key={p.id}><td>{i + 1}</td><td>{p.descricao}</td><td>{fmtMoney(p.preco)}</td></tr>))}
          </tbody>
        </table>
      </section>

      <section className="print-section print-grid-2">
        <div className="chem-label-box">
          <span className="chem-label-title">Etiqueta de teste químico</span>
          <span className="chem-label-hint">(colar aqui)</span>
        </div>
        <div className="print-totals">
          <div><span>Total de peças</span><strong>{fmtMoney(subtotalPecas)}</strong></div>
          <div><span>Total de mão de obra</span><strong>{fmtMoney(orc.valorServico)}</strong></div>
          <div><span>Frete / deslocamento</span><strong>{fmtMoney(orc.deslocamento)}</strong></div>
          <div><span>Desconto</span><strong>{fmtMoney(orc.desconto)}</strong></div>
          <div className="print-total-final"><span>TOTAL</span><strong>{fmtMoney(totalGeral)}</strong></div>
        </div>
      </section>

      <p className="print-payment">Forma de pagamento: {orc.formaPagamento || '—'}</p>

      <section className="print-section">
        <h2>Observações</h2>
        <p>{empresa.garantiaPadraoInterno}</p>
      </section>

      <div className="print-signatures">
        <div className="sig-block"><div className="sig-line" /><span>Engº Responsável{empresa.engenheiroCrea ? ` — ${empresa.engenheiroCrea}` : ''}</span></div>
        <div className="sig-approval">
          <span>{orc.aprovado === 'aprovado' ? '☑' : '☐'} Aprovado</span>
          <span>{orc.aprovado === 'reprovado' ? '☑' : '☐'} Reprovado</span>
          <span>{orc.aprovado === 'descarte' ? '☑' : '☐'} Descarte</span>
        </div>
        <div className="sig-block"><div className="sig-line" /><span>Assinatura Cliente</span></div>
      </div>

      <div className="print-footer">
        {empresa.endereco}{empresa.cidade ? `, ${empresa.cidade}` : ''}{empresa.uf ? `/${empresa.uf}` : ''}{empresa.cep ? ` - CEP ${empresa.cep}` : ''}{empresa.telefone ? ` - ${empresa.telefone}` : ''}{empresa.email ? ` - ${empresa.email}` : ''}<br />
        {empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : ''}{empresa.ie ? ` | I.E. ${empresa.ie}` : ''}{empresa.im ? ` | I.M. ${empresa.im}` : ''}
      </div>

      {fotos.length > 0 && (
        <div className="print-photos-page">
          <h2>Fotos do serviço — OS {os.numero}</h2>
          <div className="print-photos-grid">
            {fotos.map((f) => (
              <figure key={f.id}><img src={`${API_BASE}/${f.url}`} alt={f.legenda || ''} />{f.legenda && <figcaption>{f.legenda}</figcaption>}</figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PrintableOsExterno({ os, cliente, equipamento, empresa, tipoNome }) {
  const orc = normalizeOrcamento(os.orcamento);
  const subtotalPecas = orc.pecas.reduce((s, p) => s + (Number(p.preco) || 0), 0);
  const totalGeral = (Number(orc.valorServico) || 0) + subtotalPecas;
  const fotos = os.fotos || [];

  return (
    <div className="print-only print-doc">
      <div className="print-header">
        <div className="print-header-left">
          {empresa.logoDataUrl ? <img src={empresa.logoDataUrl} alt="logo" className="print-logo" /> : <div className="print-logo-placeholder">{empresa.nome || 'Empresa'}</div>}
          <h1>Ordem de Serviço - Atendimento in loco</h1>
        </div>
        <div className="print-header-right">
          <div className="print-os-number"><span>nº da OS</span><strong>{os.numero}</strong></div>
          <div className="print-dates"><span>Data da visita: {fmtDate(os.dataEntrada)}</span></div>
        </div>
      </div>

      <section className="print-section">
        <h2>Dados do cliente</h2>
        <p>{cliente?.codigo ? `${cliente.codigo} — ` : ''}{cliente?.nome || '—'}{cliente?.telefone ? ` - ${cliente.telefone}` : ''}</p>
        <p>{cliente?.endereco || ''}{cliente?.documento ? ` - CPF/CNPJ: ${cliente.documento}` : ''}</p>
      </section>

      <section className="print-section print-grid-2">
        <div>
          <h2>Dados do produto/serviço</h2>
          <p><strong>Equipamento/modelo:</strong> {tipoNome || equipamento?.tipo || '—'}</p>
        </div>
        <div>
          <p><strong>Garantia:</strong> {os.garantiaEquipamento === 'sim' ? 'Sim' : os.garantiaEquipamento === 'nao' ? 'Não' : '—'}</p>
          <p><strong>Marca:</strong> {equipamento?.marca || '—'}</p>
        </div>
      </section>

      <section className="print-section">
        <h2>Problema relatado / solicitação do cliente</h2>
        <p>{os.observacoesGerais || '—'}</p>
      </section>

      <section className="print-section">
        <h2>Serviço realizado</h2>
        <p>{orc.descricaoServico || '—'}</p>
      </section>

      <section className="print-section">
        <h2>Peças utilizadas</h2>
        <table className="print-table">
          <thead><tr><th>Item</th><th>Descrição</th><th>Valor</th></tr></thead>
          <tbody>
            {orc.pecas.length === 0 && <tr><td colSpan={3} className="print-muted">Nenhuma peça utilizada</td></tr>}
            {orc.pecas.map((p, i) => (<tr key={p.id}><td>{i + 1}</td><td>{p.descricao}</td><td>{fmtMoney(p.preco)}</td></tr>))}
          </tbody>
        </table>
      </section>

      <section className="print-section print-grid-2">
        <div>
          {(os.checklistAtendimento || []).map((item) => (
            <p key={item.id} className="print-checklist-item">{item.status === 'feito' ? '☑' : '☐'} {item.descricao}</p>
          ))}
          <p className="print-horas"><strong>Hora início:</strong> {os.horaInicio || '—'} &nbsp; <strong>Hora término:</strong> {os.horaFim || '—'}</p>
        </div>
        <div className="print-totals">
          <div><span>Total de peças</span><strong>{fmtMoney(subtotalPecas)}</strong></div>
          <div><span>Total de mão de obra</span><strong>{fmtMoney(orc.valorServico)}</strong></div>
          <div className="print-total-final"><span>TOTAL</span><strong>{fmtMoney(totalGeral)}</strong></div>
        </div>
      </section>

      <p className="print-payment">Forma de pagamento: {orc.formaPagamento || '—'}</p>

      <section className="print-section">
        <h2>Observações</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{empresa.garantiaPadraoExterno}</p>
      </section>

      <div className="print-signatures">
        <div className="sig-block"><div className="sig-line" /><span>Técnico Responsável</span></div>
        <div className="sig-approval">
          <span>{orc.aprovado === 'aprovado' ? '☑' : '☐'} Aprovado</span>
          <span>{orc.aprovado === 'reprovado' ? '☑' : '☐'} Reprovado</span>
          <span>{orc.aprovado === 'nao_finalizada' ? '☑' : '☐'} Não finalizada</span>
        </div>
        <div className="sig-block"><div className="sig-line" /><span>Aprovação do Serviço Cliente</span></div>
      </div>

      <div className="print-footer">
        {empresa.endereco}{empresa.cidade ? `, ${empresa.cidade}` : ''}{empresa.uf ? `/${empresa.uf}` : ''}{empresa.cep ? ` - CEP ${empresa.cep}` : ''}{empresa.telefone ? ` - ${empresa.telefone}` : ''}{empresa.email ? ` - ${empresa.email}` : ''}<br />
        {empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : ''}{empresa.ie ? ` | I.E. ${empresa.ie}` : ''}{empresa.im ? ` | I.M. ${empresa.im}` : ''}
      </div>

      {fotos.length > 0 && (
        <div className="print-photos-page">
          <h2>Fotos do serviço — OS {os.numero}</h2>
          <div className="print-photos-grid">
            {fotos.map((f) => (
              <figure key={f.id}><img src={`${API_BASE}/${f.url}`} alt={f.legenda || ''} />{f.legenda && <figcaption>{f.legenda}</figcaption>}</figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CustodiaVia({ via, os, cliente, equipamento, empresa, tipoNome, itensPresentes }) {
  return (
    <div className="via">
      <div className="via-header">
        <div className="via-header-left">
          {empresa.logoDataUrl ? <img src={empresa.logoDataUrl} alt="logo" className="print-logo" /> : <div className="print-logo-placeholder">{empresa.nome || 'Empresa'}</div>}
          <div>
            <div className="via-title">Comprovante de Custódia</div>
            <span className="via-tag">{via === 1 ? '1ª via · cliente' : '2ª via · empresa'}</span>
          </div>
        </div>
        <div className="via-header-right">
          <span className="os-tag">{os.numero}</span>
          <div className="via-date">Entrada: {fmtDate(os.dataEntrada)}</div>
        </div>
      </div>

      <div className="via-row">
        <div className="via-field"><span className="label">Cliente</span><span className="value">{cliente?.codigo ? `${cliente.codigo} — ` : ''}{cliente?.nome || '—'}{cliente?.telefone ? ` · ${cliente.telefone}` : ''}</span></div>
        <div className="via-field"><span className="label">Técnico</span><span className="value">{os.tecnico || 'A definir'}</span></div>
      </div>
      <div className="via-row">
        <div className="via-field"><span className="label">Equipamento</span><span className="value">{tipoNome} {equipamento?.marca ? `— ${equipamento.marca} ${equipamento.modelo || ''}` : ''}</span></div>
        <div className="via-field"><span className="label">Nº de série</span><span className="value">{equipamento?.numeroSerie || '—'}</span></div>
      </div>

      <div className="itens-box">
        <span className="label">Itens recebidos junto com o equipamento</span>
        {itensPresentes || 'Nenhum item marcado como recebido'}
      </div>

      <div className="policy-box">
        <strong>Prazo de avaliação e retirada</strong>
        {empresa.custodiaPolitica}
      </div>

      <div className="sign-row">
        <div className="sign-block"><div className="sign-line" /><span>Assinatura do Cliente</span></div>
        <div className="sign-block"><div className="sign-line" /><span>Responsável {empresa.nome || 'Empresa'}</span></div>
      </div>
      <div className="declar">Ao assinar, o cliente declara estar ciente das condições acima.</div>
    </div>
  );
}

function PrintableCustodia({ os, cliente, equipamento, empresa, tipoNome }) {
  const itensPresentes = (os.checklistEntrada || []).filter((i) => i.status === 'presente').map((i) => i.descricao).join(', ');
  return (
    <div className="print-only print-doc custodia-sheet">
      <CustodiaVia via={1} os={os} cliente={cliente} equipamento={equipamento} empresa={empresa} tipoNome={tipoNome} itensPresentes={itensPresentes} />
      <div className="cut-line"><span>✂ corte aqui</span></div>
      <CustodiaVia via={2} os={os} cliente={cliente} equipamento={equipamento} empresa={empresa} tipoNome={tipoNome} itensPresentes={itensPresentes} />
    </div>
  );
}

function PrintableEtiqueta({ os, cliente, equipamento, tipoNome }) {
  const itensPresentes = (os.checklistEntrada || []).filter((i) => i.status === 'presente').map((i) => i.descricao).join(', ');
  const numeroCurto = os.numero.replace(/^OS-0*/, '');
  const linkPublico = os.tokenPublico ? `${window.location.origin}/?os=${os.tokenPublico}` : '';
  return (
    <div className="print-only print-doc etiqueta-sheet">
      <div className="etiqueta-corte">
        <div className="etiqueta-numero-grande">{numeroCurto}</div>
        {linkPublico && (
          <div className="etiqueta-qr">
            <QRCodeSVG value={linkPublico} size={90} level="M" />
            <span>Escaneie para ver o histórico</span>
          </div>
        )}
      </div>

      <div className="cut-line"><span>✂ corte aqui — cole no equipamento</span></div>

      <div className="tag-ficha">
        <div className="tag-ficha-header">
          <span className="os-tag">{os.numero}</span>
          <span className="tag-title">Ficha de identificação do equipamento</span>
        </div>
        <div className="tag-facts">
          <div className="tag-fact"><span className="label">Cliente</span><span className="value">{cliente?.nome || '—'}</span></div>
          <div className="tag-fact"><span className="label">Equipamento</span><span className="value">{tipoNome} {equipamento?.marca || ''}</span></div>
          <div className="tag-fact"><span className="label">Nº de série</span><span className="value">{equipamento?.numeroSerie || '—'}</span></div>
          <div className="tag-fact"><span className="label">Tensão</span><span className="value">{equipamento?.tensao || '—'}</span></div>
          <div className="tag-fact"><span className="label">Entrada</span><span className="value">{fmtDate(os.dataEntrada)}</span></div>
          <div className="tag-fact"><span className="label">Manutenção</span><span className="value">{TIPO_LABEL[os.tipoManutencao]}</span></div>
          <div className="tag-fact"><span className="label">Origem</span><span className="value">{os.origem === 'cliente_trouxe' ? 'Cliente trouxe' : 'Retirada no local'}</span></div>
        </div>
        <div className="tag-itens">
          <span className="label">Itens recebidos</span>
          {itensPresentes || '—'}
        </div>
        <div className="tag-service-label">Descrição do serviço / avaliação</div>
        <div className="tag-lines" />
      </div>
    </div>
  );
}

function PrintableRelatorioPendencias({ db }) {
  const hoje = new Date();
  function diasDesde(dataStr) {
    if (!dataStr) return '—';
    const d = new Date(dataStr + 'T00:00:00');
    return Math.max(Math.floor((hoje - d) / (1000 * 60 * 60 * 24)), 0);
  }
  const grupos = [
    { titulo: 'Aguardando análise', ordens: db.ordens.filter((o) => ['recebido', 'em_orcamento'].includes(o.status)) },
    { titulo: 'Aguardando aprovação do cliente', ordens: db.ordens.filter((o) => o.status === 'aguardando_aprovacao') },
    { titulo: 'Em execução', ordens: db.ordens.filter((o) => ['aprovado', 'em_execucao'].includes(o.status)) },
    { titulo: 'Aguardando retirada', ordens: db.ordens.filter((o) => o.status === 'concluido') },
  ];
  return (
    <div className="print-only print-doc">
      <div className="print-header">
        <div className="print-header-left">
          {db.empresa.logoDataUrl ? <img src={db.empresa.logoDataUrl} alt="logo" className="print-logo" /> : <div className="print-logo-placeholder">{db.empresa.nome || 'Empresa'}</div>}
          <h1>Relatório de OS em aberto</h1>
        </div>
        <div className="print-header-right">
          <div className="via-date">Gerado em {fmtDate(todayStr())}</div>
        </div>
      </div>

      {grupos.map((g) => (
        <section className="print-section" key={g.titulo}>
          <h2>{g.titulo} ({g.ordens.length})</h2>
          {g.ordens.length === 0 ? (
            <p className="print-muted">Nenhuma OS nessa situação.</p>
          ) : (
            <table className="print-table">
              <thead><tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Entrada</th><th>Dias em aberto</th></tr></thead>
              <tbody>
                {g.ordens.map((o) => {
                  const cli = db.clientes.find((c) => c.id === o.clienteId);
                  const eq = db.equipamentos.find((e) => e.id === o.equipamentoId);
                  return (
                    <tr key={o.id}>
                      <td>{o.numero}</td>
                      <td>{cli?.nome || '—'}</td>
                      <td>{eq ? tipoNomeFor(db.tiposEquipamento, eq) : '—'}</td>
                      <td>{fmtDate(o.dataEntrada)}</td>
                      <td>{diasDesde(o.dataEntrada)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function OsDetailView({ os, cliente, equipamento, empresa, tiposEquipamento, tecnicos, pecasCatalogo, onUpsertPeca, onUploadFoto, onRemoveFoto, onBack, onUpdate, onDelete }) {
  const [orc, setOrc] = useState(normalizeOrcamento(os.orcamento));
  useEffect(() => { setOrc(normalizeOrcamento(os.orcamento)); }, [os.id]);
  const equipTipoNome = tipoNomeFor(tiposEquipamento, equipamento);
  const [printJob, setPrintJob] = useState(null);
  useEffect(() => { if (printJob) window.print(); }, [printJob]);
  function triggerPrint(target) { setPrintJob({ target, seq: Date.now() }); }

  function linkPublico() {
    return `${window.location.origin}/?os=${os.tokenPublico}`;
  }
  function copiarLinkPublico() {
    navigator.clipboard.writeText(linkPublico())
      .then(() => window.alert('Link copiado.'))
      .catch(() => window.alert(linkPublico()));
  }
  function enviarLinkWhatsapp() {
    const numero = telefoneParaWhatsapp(cliente?.telefone);
    if (!numero) { window.alert('Este cliente não tem telefone cadastrado.'); return; }
    const mensagem = `Olá! Segue o link da sua OS ${os.numero} na Laxis: ${linkPublico()}`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`, '_blank');
  }

  function patchItem(section, itemId, patch) {
    onUpdate({ ...os, [section]: os[section].map((it) => (it.id === itemId ? { ...it, ...patch } : it)) });
  }
  function addItem(section, desc) {
    onUpdate({ ...os, [section]: [...(os[section] || []), { id: uid(), descricao: desc, status: 'pendente', obs: '' }] });
  }
  function removeItem(section, itemId) {
    onUpdate({ ...os, [section]: os[section].filter((it) => it.id !== itemId) });
  }
  function saveOrcamento(next) {
    onUpdate({ ...os, orcamento: next || orc });
  }
  function setStatus(newStatus) {
    const patch = { status: newStatus };
    if (newStatus === 'entregue') patch.dataEntrega = os.dataEntrega || todayStr();
    if (newStatus === 'concluido') patch.dataConclusao = os.dataConclusao || todayStr();
    onUpdate({ ...os, ...patch });
  }

  const isExterno = os.tipoAtendimento === 'externo';
  const meta = STATUS_META[os.status];
  const subtotalPecas = orc.pecas.reduce((s, p) => s + (Number(p.preco) || 0), 0);
  const totalGeral = isExterno
    ? (Number(orc.valorServico) || 0) + subtotalPecas
    : (Number(orc.valorServico) || 0) + subtotalPecas + (Number(orc.deslocamento) || 0) - (Number(orc.desconto) || 0);
  const situacaoOpcoes = SITUACAO_OPCOES[isExterno ? 'externo' : 'interno'];

  return (
    <div className="os-detail">
      <div className="screen-only">
        <button className="link-back" onClick={onBack}><ArrowLeft size={15} /> Voltar</button>

        <div className="os-header">
          <div>
            <OsTag numero={os.numero} />
            <h2>{equipamento ? equipTipoNome : 'Equipamento removido'}</h2>
            <p className="muted">{cliente?.nome || '—'} · {equipamento ? `${equipamento.marca} ${equipamento.modelo}` : ''} · Nº série {equipamento?.numeroSerie || '—'}</p>
          </div>
          <div className="os-header-right">
            <Badge tone="neutral">{TIPO_ATENDIMENTO_LABEL[os.tipoAtendimento] || TIPO_ATENDIMENTO_LABEL.interno}</Badge>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <select value={os.status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {!isExterno && <button className="btn ghost small" onClick={() => triggerPrint('custodia')}>Imprimir Custódia</button>}
            {!isExterno && <button className="btn ghost small" onClick={() => triggerPrint('etiqueta')}>Imprimir Etiqueta</button>}
            <button className="btn ghost small" onClick={() => triggerPrint('os')}>Imprimir OS</button>
            {os.tokenPublico && <button className="btn ghost small" onClick={copiarLinkPublico}>Copiar link</button>}
            {os.tokenPublico && <button className="btn ghost small" onClick={enviarLinkWhatsapp}>Enviar WhatsApp</button>}
          </div>
        </div>

        <div className="os-meta-grid">
          <div><span className="label">Tipo de manutenção</span><span>{TIPO_LABEL[os.tipoManutencao]}</span></div>
          {!isExterno && (
            <div><span className="label">Origem</span><span>{os.origem === 'cliente_trouxe' ? 'Cliente trouxe' : 'Retirada no local'}</span></div>
          )}
          <div>
            <span className="label">Técnico</span>
            <select className="meta-select" value={os.tecnico || ''} onChange={(e) => onUpdate({ ...os, tecnico: e.target.value })}>
              <option value="">—</option>
              {os.tecnico && !tecnicos.some((t) => t.nome === os.tecnico) && <option value={os.tecnico}>{os.tecnico}</option>}
              {tecnicos.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
            </select>
          </div>
          <div><span className="label">{isExterno ? 'Data da visita' : 'Data de entrada'}</span><span>{fmtDate(os.dataEntrada)}</span></div>
          <div>
            <span className="label">Garantia do equipamento</span>
            <select className="meta-select" value={os.garantiaEquipamento || 'nao_informado'} onChange={(e) => onUpdate({ ...os, garantiaEquipamento: e.target.value })}>
              <option value="nao_informado">Não informado</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
          </div>
          <div>
            <span className="label">Data de conclusão</span>
            <input className="meta-select" type="date" value={os.dataConclusao || ''} onChange={(e) => onUpdate({ ...os, dataConclusao: e.target.value })} />
          </div>
          <div>
            <span className="label">Data de pagamento</span>
            <input className="meta-select" type="date" value={os.dataPagamento || ''} onChange={(e) => onUpdate({ ...os, dataPagamento: e.target.value })} />
          </div>
          {isExterno && (
            <>
              <div>
                <span className="label">Hora início</span>
                <input className="meta-select" type="time" value={os.horaInicio || ''} onChange={(e) => onUpdate({ ...os, horaInicio: e.target.value })} />
              </div>
              <div>
                <span className="label">Hora término</span>
                <input className="meta-select" type="time" value={os.horaFim || ''} onChange={(e) => onUpdate({ ...os, horaFim: e.target.value })} />
              </div>
            </>
          )}
        </div>

        {!isExterno && (
          <>
            <ChecklistSection title="1 · Itens removíveis na entrada" mode="presenca" items={os.checklistEntrada}
              onChange={(id, patch) => patchItem('checklistEntrada', id, patch)}
              onAdd={(desc) => addItem('checklistEntrada', desc)}
              onRemove={(id) => removeItem('checklistEntrada', id)} />

            <ChecklistSection title="2 · Testes antes do orçamento" mode="teste" items={os.checklistPreOrcamento}
              onChange={(id, patch) => patchItem('checklistPreOrcamento', id, patch)}
              onAdd={(desc) => addItem('checklistPreOrcamento', desc)}
              onRemove={(id) => removeItem('checklistPreOrcamento', id)} />
          </>
        )}

        {isExterno && (
          <ChecklistSection title="Checklist do atendimento" mode="feito" items={os.checklistAtendimento || []}
            onChange={(id, patch) => patchItem('checklistAtendimento', id, patch)}
            onAdd={(desc) => addItem('checklistAtendimento', desc)}
            onRemove={(id) => removeItem('checklistAtendimento', id)} />
        )}

        <div className="orcamento-card">
          <h3>Orçamento</h3>
          <div className="form-grid">
            <label className="span-2">Serviço realizado (mão de obra)
              <textarea rows={2} value={orc.descricaoServico} onChange={(e) => setOrc({ ...orc, descricaoServico: e.target.value })} onBlur={() => saveOrcamento()} />
            </label>
            <label>Valor do serviço (R$)
              <input type="number" step="0.01" value={orc.valorServico} onChange={(e) => setOrc({ ...orc, valorServico: e.target.value })} onBlur={() => saveOrcamento()} />
            </label>
            {!isExterno && (
              <label>Custo de deslocamento (R$)
                <input type="number" step="0.01" value={orc.deslocamento} onChange={(e) => setOrc({ ...orc, deslocamento: e.target.value })} onBlur={() => saveOrcamento()} />
                {os.origem === 'retirada' && <span className="field-note">Preenchido automaticamente por ser retirada — edite se necessário.</span>}
              </label>
            )}
            {!isExterno && (
              <label>Desconto (R$)
                <input type="number" step="0.01" value={orc.desconto} onChange={(e) => setOrc({ ...orc, desconto: e.target.value })} onBlur={() => saveOrcamento()} />
              </label>
            )}
            <label>Forma de pagamento
              <select value={orc.formaPagamento} onChange={(e) => { const next = { ...orc, formaPagamento: e.target.value }; setOrc(next); saveOrcamento(next); }}>
                <option value="">Selecione...</option>
                {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label>Situação
              <select value={orc.aprovado} onChange={(e) => { const next = { ...orc, aprovado: e.target.value }; setOrc(next); saveOrcamento(next); }}>
                {situacaoOpcoes.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </label>
          </div>

          <h4 className="subsection-title">Peças utilizadas</h4>
          <PecasList pecas={orc.pecas} pecasCatalogo={pecasCatalogo} onUpsertPeca={onUpsertPeca} onChange={(pecas) => { const next = { ...orc, pecas }; setOrc(next); saveOrcamento(next); }} />

          <p className="total-line">Total geral: {fmtMoney(totalGeral)}</p>

          <div className="internal-field">
            <span className="tag-interno">Uso interno · não aparece na OS impressa</span>
            <textarea rows={2} value={orc.obsInternas} placeholder="Anotações internas: fornecedor da peça, negociação, margem, etc."
              onChange={(e) => setOrc({ ...orc, obsInternas: e.target.value })} onBlur={() => saveOrcamento()} />
          </div>
        </div>

        {!isExterno && (
          <ChecklistSection title="3 · Testes após o orçamento" mode="teste" items={os.checklistPosOrcamento}
            onChange={(id, patch) => patchItem('checklistPosOrcamento', id, patch)}
            onAdd={(desc) => addItem('checklistPosOrcamento', desc)}
            onRemove={(id) => removeItem('checklistPosOrcamento', id)} />
        )}

        <FotosSection ordemId={os.id} fotos={os.fotos || []} onUpload={onUploadFoto} onRemove={onRemoveFoto} />

        <div className="form-card">
          <label className="span-2">Relato do cliente / observações gerais
            <textarea rows={3} defaultValue={os.observacoesGerais} onBlur={(e) => onUpdate({ ...os, observacoesGerais: e.target.value })} />
          </label>
        </div>

        <div className="danger-zone">
          <button className="btn danger-ghost" onClick={onDelete}>Excluir ordem de serviço</button>
        </div>
      </div>

      {(!printJob || printJob.target === 'os') && (isExterno
        ? <PrintableOsExterno os={os} cliente={cliente} equipamento={equipamento} empresa={empresa} tipoNome={equipTipoNome} />
        : <PrintableOs os={os} cliente={cliente} equipamento={equipamento} empresa={empresa} tipoNome={equipTipoNome} />)}
      {printJob && printJob.target === 'custodia' && !isExterno && (
        <PrintableCustodia os={os} cliente={cliente} equipamento={equipamento} empresa={empresa} tipoNome={equipTipoNome} />
      )}
      {printJob && printJob.target === 'etiqueta' && !isExterno && (
        <PrintableEtiqueta os={os} cliente={cliente} equipamento={equipamento} tipoNome={equipTipoNome} />
      )}
    </div>
  );
}

function EmpresaForm({ empresa, onSave }) {
  const [f, setF] = useState(empresa);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setF(empresa); }, [empresa]);

  function handleLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 320;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setF((prev) => ({ ...prev, logoDataUrl: canvas.toDataURL('image/png') }));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function save() {
    onSave(f);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  return (
    <div>
      <div className="view-header"><h2>Dados da empresa</h2></div>
      <p className="muted small" style={{ marginBottom: 14 }}>Usados no cabeçalho e rodapé da OS impressa.</p>
      <div className="form-card">
        <div className="form-grid">
          <label>Nome da empresa
            <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </label>
          <label>Logotipo
            <input type="file" accept="image/*" onChange={handleLogo} />
          </label>
          {f.logoDataUrl && (
            <div className="span-2 logo-preview-row">
              <img src={f.logoDataUrl} alt="logo" />
              <button type="button" className="link-btn danger" onClick={() => setF({ ...f, logoDataUrl: '' })}>Remover logotipo</button>
            </div>
          )}
          <label>Telefone
            <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
          </label>
          <label>E-mail
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label>CNPJ
            <input value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />
          </label>
          <label>Inscrição estadual
            <input value={f.ie} onChange={(e) => setF({ ...f, ie: e.target.value })} />
          </label>
          <label>Inscrição municipal
            <input value={f.im} onChange={(e) => setF({ ...f, im: e.target.value })} />
          </label>

          <label>Engenheiro responsável
            <input value={f.engenheiroNome} onChange={(e) => setF({ ...f, engenheiroNome: e.target.value })} />
          </label>
          <label>CREA
            <input value={f.engenheiroCrea} onChange={(e) => setF({ ...f, engenheiroCrea: e.target.value })} />
          </label>
        </div>

        <h4 className="subsection-title">Endereço da empresa</h4>
        <div className="form-grid">
          <label className="span-2">Endereço
            <input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} placeholder="ex: R. Otto Benz, nº 000 - Bairro" />
          </label>
          <label>Cidade
            <input value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} />
          </label>
          <label>UF
            <input maxLength={2} value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} />
          </label>
          <label>CEP
            <input value={f.cep} onChange={(e) => setF({ ...f, cep: e.target.value })} />
          </label>
        </div>

        <h4 className="subsection-title">Textos de garantia impressos na OS</h4>
        <div className="form-grid">
          <label className="span-2">Atendimento interno
            <textarea rows={2} value={f.garantiaPadraoInterno} onChange={(e) => setF({ ...f, garantiaPadraoInterno: e.target.value })} />
          </label>
          <label className="span-2">Atendimento externo
            <textarea rows={3} value={f.garantiaPadraoExterno} onChange={(e) => setF({ ...f, garantiaPadraoExterno: e.target.value })} />
          </label>
        </div>

        <h4 className="subsection-title">Termo de custódia (comprovante impresso na abertura)</h4>
        <p className="muted small">Rascunho — os prazos e valores são exemplos, revise com contador/advogado antes de usar valendo.</p>
        <div className="form-grid">
          <label className="span-2">Texto de prazo de avaliação e política de custódia
            <textarea rows={4} value={f.custodiaPolitica} onChange={(e) => setF({ ...f, custodiaPolitica: e.target.value })} />
          </label>
        </div>

        <div className="form-actions">
          {savedFlash && <span className="muted small" style={{ marginRight: 'auto' }}>Salvo.</span>}
          <button className="btn primary" onClick={save}>Salvar dados da empresa</button>
        </div>
      </div>
    </div>
  );
}

function ParametrosView({ db, onSaveOperacional, onExportDataset, onDownloadTemplate, onExportBackup }) {
  const [f, setF] = useState({
    intervaloPreventivoMeses: db.empresa.intervaloPreventivoMeses,
    mensagemRenovacao: db.empresa.mensagemRenovacao,
    custodiaDiasAlerta: db.empresa.custodiaDiasAlerta,
    custodiaDiasLimite: db.empresa.custodiaDiasLimite,
  });
  const [savedFlash, setSavedFlash] = useState(false);

  function save() {
    onSaveOperacional(f);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  return (
    <div>
      <div className="view-header"><h2>Parâmetros</h2></div>
      <p className="muted small" style={{ marginBottom: 14 }}>Configurações operacionais do sistema — não aparecem em nenhum documento impresso.</p>

      <div className="form-card">
        <h3 style={{ marginBottom: 4 }}>Renovação de preventiva</h3>
        <p className="muted small" style={{ marginBottom: 12 }}>Controla a lista de "revisões a agendar" no painel.</p>
        <div className="form-grid">
          <label>Intervalo padrão (meses)
            <input type="number" min="1" value={f.intervaloPreventivoMeses} onChange={(e) => setF({ ...f, intervaloPreventivoMeses: e.target.value })} />
          </label>
          <label className="span-2">Modelo de mensagem (WhatsApp)
            <textarea rows={3} value={f.mensagemRenovacao} onChange={(e) => setF({ ...f, mensagemRenovacao: e.target.value })} />
          </label>
        </div>
        <p className="muted small">Use {'{cliente}'}, {'{equipamento}'}, {'{marca}'}, {'{modelo}'} e {'{empresa}'} — são substituídos automaticamente. Dá pra ajustar o intervalo por tipo em "Tipos de equipamento".</p>

        <h3 style={{ margin: '18px 0 4px' }}>Alerta de custódia</h3>
        <p className="muted small" style={{ marginBottom: 12 }}>Controla a lista de "equipamentos parados" no painel — quando uma OS concluída passa dias demais aguardando retirada.</p>
        <div className="form-grid">
          <label>Avisar após (dias)
            <input type="number" min="1" value={f.custodiaDiasAlerta} onChange={(e) => setF({ ...f, custodiaDiasAlerta: e.target.value })} />
          </label>
          <label>Limite — taxa/venda (dias)
            <input type="number" min="1" value={f.custodiaDiasLimite} onChange={(e) => setF({ ...f, custodiaDiasLimite: e.target.value })} />
          </label>
        </div>

        <div className="form-actions">
          {savedFlash && <span className="muted small" style={{ marginRight: 'auto' }}>Salvo.</span>}
          <button className="btn primary" onClick={save}>Salvar parâmetros</button>
        </div>
      </div>

      <p className="muted small" style={{ marginBottom: 14 }}>Técnicos agora são gerenciados na tela "Usuários" (cada um já entra com login).</p>
      <DadosSection db={db} onExportDataset={onExportDataset} onDownloadTemplate={onDownloadTemplate} onExportBackup={onExportBackup} />
    </div>
  );
}

/* ---------- app ---------- */
function AppAutenticado({ usuario, onLogout }) {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [view, setView] = useState('dashboard');
  const [selectedOsId, setSelectedOsId] = useState(null);
  const [forceOpenForm, setForceOpenForm] = useState(false);

  async function carregarTudo() {
    setLoading(true);
    setErroCarregamento('');
    const specs = [
      ['clientes', '/clientes.php', []],
      ['equipamentos', '/equipamentos.php', []],
      ['tiposEquipamento', '/tipos_equipamento.php', []],
      ['ordens', '/ordens.php', []],
      ['pecasCatalogo', '/pecas.php', []],
      ['empresaDados', '/empresa.php', {}],
      ['parametros', '/parametros.php', {}],
      ['tecnicos', '/usuarios.php?apenas=tecnicos', []],
    ];
    const resultados = await Promise.allSettled(specs.map(([, path]) => api.get(path)));
    const dados = {};
    const falhas = [];
    resultados.forEach((r, i) => {
      const [chave, path, padrao] = specs[i];
      if (r.status === 'fulfilled') {
        dados[chave] = r.value;
      } else {
        dados[chave] = padrao;
        falhas.push(`${path.replace('/', '').replace('.php', '')}: ${r.reason?.message || 'falhou'}`);
      }
    });
    // Um endpoint falhando (ex: permissão faltando pra um papel) não derruba
    // o app inteiro mais — carrega o resto normalmente e mostra um aviso.
    setDb({
      clientes: dados.clientes, equipamentos: dados.equipamentos, tiposEquipamento: dados.tiposEquipamento,
      ordens: dados.ordens, pecasCatalogo: dados.pecasCatalogo, tecnicos: dados.tecnicos,
      empresa: { ...dados.empresaDados, ...dados.parametros },
    });
    if (falhas.length > 0) { setErroCarregamento(`Não carregou: ${falhas.join(' | ')}`); }
    setLoading(false);
  }

  useEffect(() => { carregarTudo(); }, []);

  async function importarOrdens(payload) {
    const resultado = await api.post('/importar_ordens.php', payload);
    await carregarTudo();
    return resultado;
  }

  async function importarClientes(payload) {
    const resultado = await api.post('/importar_clientes.php', payload);
    await carregarTudo();
    return resultado;
  }

  async function addCliente(data) {
    const novo = await api.post('/clientes.php', data);
    setDb((prev) => ({ ...prev, clientes: [...prev.clientes, novo] }));
    return novo;
  }
  async function editCliente(id, data) {
    const atualizado = await api.put(`/clientes.php?id=${id}`, data);
    setDb((prev) => ({ ...prev, clientes: prev.clientes.map((c) => (c.id === id ? atualizado : c)) }));
  }
  async function deleteCliente(id) {
    if (db.equipamentos.some((e) => e.clienteId === id)) { window.alert('Este cliente tem equipamentos cadastrados. Remova os equipamentos antes de excluir o cliente.'); return; }
    if (!window.confirm('Excluir este cliente?')) return;
    try {
      await api.del(`/clientes.php?id=${id}`);
      setDb((prev) => ({ ...prev, clientes: prev.clientes.filter((c) => c.id !== id) }));
    } catch (e) { window.alert(e.message); }
  }

  async function updateEmpresa(data) {
    const atualizado = await api.put('/empresa.php', data);
    setDb((prev) => ({ ...prev, empresa: { ...prev.empresa, ...atualizado } }));
  }
  async function updateParametros(data) {
    const atualizado = await api.put('/parametros.php', data);
    setDb((prev) => ({ ...prev, empresa: { ...prev.empresa, ...atualizado } }));
  }

  async function addEquipamento(data) {
    const novo = await api.post('/equipamentos.php', data);
    setDb((prev) => ({ ...prev, equipamentos: [...prev.equipamentos, novo] }));
    return novo;
  }
  async function editEquipamento(id, data) {
    const atualizado = await api.put(`/equipamentos.php?id=${id}`, data);
    setDb((prev) => ({ ...prev, equipamentos: prev.equipamentos.map((e) => (e.id === id ? atualizado : e)) }));
  }
  async function marcarContatoRenovacao(equipamentoId, dataUltimaPreventiva) {
    try {
      const atualizado = await api.put(`/equipamentos.php?id=${equipamentoId}`, { marcarContatoRenovacao: dataUltimaPreventiva });
      setDb((prev) => ({ ...prev, equipamentos: prev.equipamentos.map((e) => (e.id === equipamentoId ? atualizado : e)) }));
    } catch (e) { console.error(e); }
  }
  async function deleteEquipamento(id) {
    if (db.ordens.some((o) => o.equipamentoId === id)) { window.alert('Este equipamento tem ordens de serviço vinculadas e não pode ser excluído.'); return; }
    if (!window.confirm('Excluir este equipamento?')) return;
    try {
      await api.del(`/equipamentos.php?id=${id}`);
      setDb((prev) => ({ ...prev, equipamentos: prev.equipamentos.filter((e) => e.id !== id) }));
    } catch (e) { window.alert(e.message); }
  }

  async function addTipoEquipamento(data) {
    const novo = await api.post('/tipos_equipamento.php', data);
    setDb((prev) => ({ ...prev, tiposEquipamento: [...prev.tiposEquipamento, novo] }));
    return novo;
  }
  async function editTipoEquipamento(id, data) {
    const atualizado = await api.put(`/tipos_equipamento.php?id=${id}`, data);
    setDb((prev) => ({ ...prev, tiposEquipamento: prev.tiposEquipamento.map((t) => (t.id === id ? atualizado : t)) }));
  }
  async function deleteTipoEquipamento(id) {
    if (db.equipamentos.some((e) => e.tipoEquipamentoId === id)) { window.alert('Existem equipamentos cadastrados com este tipo. Altere o tipo deles antes de excluir.'); return; }
    if (!window.confirm('Excluir este tipo de equipamento?')) return;
    try {
      await api.del(`/tipos_equipamento.php?id=${id}`);
      setDb((prev) => ({ ...prev, tiposEquipamento: prev.tiposEquipamento.filter((t) => t.id !== id) }));
    } catch (e) { window.alert(e.message); }
  }

  async function upsertPecaCatalogo(descricao, preco) {
    try {
      const atualizado = await api.post('/pecas.php', { descricao, preco });
      setDb((prev) => {
        const chave = descricao.trim().toLowerCase();
        const idx = prev.pecasCatalogo.findIndex((p) => p.descricao.trim().toLowerCase() === chave);
        const pecasCatalogo = idx >= 0
          ? prev.pecasCatalogo.map((p, i) => (i === idx ? atualizado : p))
          : [...prev.pecasCatalogo, atualizado];
        return { ...prev, pecasCatalogo };
      });
    } catch (e) { console.error('Erro ao salvar peça no catálogo', e); }
  }

  async function createOs(data) {
    const equip = db.equipamentos.find((e) => e.id === data.equipamentoId);
    const tmpl = getChecklistTemplateForEquip(db.tiposEquipamento, equip);
    const isExterno = data.tipoAtendimento === 'externo';
    const payload = {
      clienteId: data.clienteId, equipamentoId: data.equipamentoId, tipoAtendimento: data.tipoAtendimento || 'interno',
      dataEntrada: data.dataEntrada, origem: data.origem, tipoManutencao: data.tipoManutencao, tecnico: data.tecnico,
      observacoesGerais: data.obsInicial || '',
      checklistEntrada: isExterno ? [] : (data.checklistEntradaPreenchido && data.checklistEntradaPreenchido.length ? data.checklistEntradaPreenchido : makeChecklist(tmpl.entrada)),
      checklistPreOrcamento: isExterno ? [] : makeChecklist(tmpl.pre),
      checklistPosOrcamento: isExterno ? [] : makeChecklist(tmpl.pos),
      checklistAtendimento: isExterno ? makeChecklist(EXTERNO_CHECKLIST_TEMPLATE) : [],
      orcamento: {
        descricaoServico: '', valorServico: '', pecas: [],
        deslocamento: !isExterno && data.origem === 'retirada' ? '50' : '',
        desconto: '', formaPagamento: '', aprovado: 'pendente', obsInternas: '',
      },
    };
    try {
      const novaOs = await api.post('/ordens.php', payload);
      setDb((prev) => ({ ...prev, ordens: [...prev.ordens, novaOs] }));
      setSelectedOsId(novaOs.id);
      setView('ordens');
    } catch (e) { window.alert(e.message); }
  }

  // Atualização otimista: a tela reage na hora (checklist, campos) e o
  // salvamento no servidor acontece em segundo plano, igual ao comportamento
  // de antes com armazenamento local — só que agora persiste de verdade.
  function updateOs(newOs) {
    setDb((prev) => ({ ...prev, ordens: prev.ordens.map((o) => (o.id === newOs.id ? newOs : o)) }));
    const { id, numero, clienteId, equipamentoId, fotos, ...resto } = newOs;
    api.put(`/ordens.php?id=${id}`, resto).catch((e) => {
      console.error('Erro ao salvar OS', e);
      window.alert('Não foi possível salvar essa alteração no servidor — verifique sua conexão e tente de novo.');
    });
  }

  async function deleteOs(id) {
    if (!window.confirm('Excluir esta ordem de serviço? Essa ação não pode ser desfeita.')) return;
    try {
      await api.del(`/ordens.php?id=${id}`);
      setDb((prev) => ({ ...prev, ordens: prev.ordens.filter((o) => o.id !== id) }));
      setSelectedOsId(null);
    } catch (e) { window.alert(e.message); }
  }

  async function uploadFoto(ordemId, arquivo, legenda) {
    const formData = new FormData();
    formData.append('ordemId', ordemId);
    formData.append('legenda', legenda || '');
    formData.append('foto', arquivo);
    const nova = await api.postForm('/fotos.php', formData);
    setDb((prev) => ({ ...prev, ordens: prev.ordens.map((o) => (o.id === ordemId ? { ...o, fotos: [...(o.fotos || []), nova] } : o)) }));
  }
  async function removerFoto(ordemId, fotoId) {
    await api.del(`/fotos.php?id=${fotoId}`);
    setDb((prev) => ({ ...prev, ordens: prev.ordens.map((o) => (o.id === ordemId ? { ...o, fotos: (o.fotos || []).filter((f) => f.id !== fotoId) } : o)) }));
  }

  function baixarJson(obj, filename) {
    const dataStr = JSON.stringify(obj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportarBackup() {
    baixarJson(db, `bancada-backup-${todayStr()}.json`);
  }

  function exportarDataset(key) {
    const cfg = DATASET_CONFIG[key];
    baixarJson(cfg.toExport(db), `bancada-${key}-${todayStr()}.json`);
  }

  function baixarModeloDataset(key) {
    const cfg = DATASET_CONFIG[key];
    baixarJson(cfg.template(), `bancada-${key}-modelo.json`);
  }

  function goToView(key) { setSelectedOsId(null); setView(key); }
  function goNovaOs() { setSelectedOsId(null); setView('ordens'); setForceOpenForm(true); }

  if (loading) {
    return <div className="bancada-app"><style>{CSS}</style><div className="loading-screen">Carregando…</div></div>;
  }
  if (!db) {
    return (
      <div className="bancada-app"><style>{CSS}</style>
        <div className="loading-screen" style={{ flexDirection: 'column', gap: 10 }}>
          <strong>Não foi possível carregar o sistema</strong>
          <span className="muted small">{erroCarregamento || 'Erro desconhecido.'}</span>
          <button className="btn primary" onClick={carregarTudo}>Tentar de novo</button>
        </div>
      </div>
    );
  }

  const selectedOs = selectedOsId ? db.ordens.find((o) => o.id === selectedOsId) : null;

  return (
    <div className="bancada-app">
      <style>{CSS}</style>
      {erroCarregamento && (
        <div className="screen-only" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, background: '#fdecea', color: '#a12b1f', padding: '8px 16px', fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
          <span>{erroCarregamento}</span>
          <button className="btn ghost small" onClick={carregarTudo}>Tentar de novo</button>
        </div>
      )}
      <aside className="sidebar">
        <SidebarBrand nomeEmpresa={db.empresa.nome} />
        <nav>
          {NAV.filter((n) => !n.papeis || n.papeis.includes(usuario.papel)).map((n) => {
            const Icon = n.icon;
            const active = view === n.key;
            return (
              <button key={n.key} className={`nav-btn ${active ? 'active' : ''}`} onClick={() => goToView(n.key)}>
                <Icon size={16} /> {n.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <span className="sidebar-user-nome">{usuario.nome}</span>
          <span className="sidebar-user-papel">{PAPEL_LABEL[usuario.papel] || usuario.papel}</span>
        </div>
        <button className="reset-btn" onClick={onLogout}><LogOut size={13} /> Sair</button>
      </aside>

      <main className="content">
        {view === 'dashboard' && <Dashboard db={db} onOpenOs={(id) => { setSelectedOsId(id); setView('ordens'); }} onGoNovaOs={goNovaOs} onMarcarContatado={marcarContatoRenovacao} />}
        {view === 'clientes' && <ClientesView db={db} onAdd={addCliente} onEdit={editCliente} onDelete={deleteCliente} />}
        {view === 'tipos' && <TiposEquipamentoView db={db} onAdd={addTipoEquipamento} onEdit={editTipoEquipamento} onDelete={deleteTipoEquipamento} />}
        {view === 'equipamentos' && <EquipamentosView db={db} onAdd={addEquipamento} onEdit={editEquipamento} onDelete={deleteEquipamento} onCreateTipo={addTipoEquipamento} />}
        {view === 'ordens' && !selectedOs && (
          <OrdensView db={db} onCreate={createOs} onOpen={(id) => setSelectedOsId(id)} forceOpenForm={forceOpenForm} onConsumedForceOpen={() => setForceOpenForm(false)} onCreateCliente={addCliente} />
        )}
        {view === 'ordens' && selectedOs && (
          <OsDetailView
            os={selectedOs}
            cliente={db.clientes.find((c) => c.id === selectedOs.clienteId)}
            equipamento={db.equipamentos.find((e) => e.id === selectedOs.equipamentoId)}
            empresa={db.empresa}
            tiposEquipamento={db.tiposEquipamento}
            tecnicos={db.tecnicos}
            pecasCatalogo={db.pecasCatalogo}
            onUpsertPeca={upsertPecaCatalogo}
            onUploadFoto={uploadFoto}
            onRemoveFoto={removerFoto}
            onBack={() => setSelectedOsId(null)}
            onUpdate={updateOs}
            onDelete={() => deleteOs(selectedOs.id)}
          />
        )}
        {view === 'importar' && usuario.papel === 'gestao' && <ImportarOrdensView db={db} onImportar={importarOrdens} />}
        {view === 'importarClientes' && usuario.papel === 'gestao' && <ImportarClientesView onImportar={importarClientes} />}
        {view === 'empresa' && <EmpresaForm empresa={db.empresa} onSave={updateEmpresa} />}
        {view === 'parametros' && (
          <ParametrosView
            db={db}
            onSaveOperacional={updateParametros}
            onExportDataset={exportarDataset}
            onDownloadTemplate={baixarModeloDataset}
            onExportBackup={exportarBackup}
          />
        )}
        {view === 'usuarios' && usuario.papel === 'gestao' && <UsuariosView usuarioAtual={usuario} />}
      </main>
    </div>
  );
}

export function PublicOsView({ token }) {
  const [estado, setEstado] = useState('carregando'); // carregando | ok | erro
  const [os, setOs] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/os_publica.php?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        let payload = null;
        try { payload = await res.json(); } catch { payload = null; }
        if (!res.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.erro) || 'Não foi possível carregar esta ordem de serviço.');
        }
        return payload.data;
      })
      .then((data) => { setOs(data); setEstado('ok'); })
      .catch((e) => { setErro(e.message); setEstado('erro'); });
  }, [token]);

  if (estado === 'carregando') {
    return <div className="bancada-app"><style>{CSS}</style><div className="loading-screen">Carregando…</div></div>;
  }
  if (estado === 'erro') {
    return (
      <div className="bancada-app"><style>{CSS}</style>
        <div className="loading-screen" style={{ flexDirection: 'column', gap: 10 }}>
          <strong>Não foi possível abrir esta OS</strong>
          <span className="muted small">{erro}</span>
        </div>
      </div>
    );
  }

  const s = os.servico;

  return (
    <div style={{ background: '#e9edf1', minHeight: '100vh', padding: '24px 12px' }}>
      <style>{CSS}</style>
      <div className="screen-only" style={{ maxWidth: 720, margin: '0 auto 14px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={() => window.print()}>Imprimir / Salvar PDF</button>
      </div>

      <div className="print-doc" style={{ maxWidth: 720, margin: '0 auto', background: '#fff', padding: 28, borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
        <div className="print-header">
          <div className="print-header-left">
            {os.empresa.logoUrl ? <img src={os.empresa.logoUrl} alt="logo" className="print-logo" /> : <div className="print-logo-placeholder">{os.empresa.nome || 'Empresa'}</div>}
            <h1>Ordem de Serviço</h1>
          </div>
          <div className="print-header-right">
            <div className="print-os-number"><span>Ordem de Serviço</span><strong>{os.numero}</strong></div>
            <div className="print-dates"><span>Abertura: {fmtDate(os.dataEntrada)}</span><span>Conclusão: {fmtDate(os.dataConclusao)}</span></div>
            <div className="badge" style={{ marginTop: 6 }}>{STATUS_META[os.status]?.label || os.status}</div>
          </div>
        </div>

        <section className="print-section">
          <h2>Dados do cliente</h2>
          <p>{os.cliente.nome}{os.cliente.telefone ? ` - ${os.cliente.telefone}` : ''}</p>
          <p>{os.cliente.endereco}{os.cliente.documento ? ` - CPF/CNPJ: ${os.cliente.documento}` : ''}</p>
        </section>

        <section className="print-section print-grid-2">
          <div>
            <h2>Dados do produto/serviço</h2>
            <p><strong>Equip.:</strong> {os.equipamento.tipo || '—'}</p>
            <p><strong>Nº de série:</strong> {os.equipamento.numeroSerie || '—'}</p>
          </div>
          <div>
            <p><strong>Marca:</strong> {os.equipamento.marca || '—'}</p>
            <p><strong>Data fabr.:</strong> {os.equipamento.dataFabricacao || '—'}</p>
            <p><strong>Tensão:</strong> {os.equipamento.tensao || '—'}</p>
            <p><strong>Garantia equip.:</strong> {os.garantiaEquipamento === 'sim' ? 'Sim' : os.garantiaEquipamento === 'nao' ? 'Não' : '—'}</p>
          </div>
        </section>

        {os.observacoesGerais && (
          <section className="print-section">
            <h2>Relato / solicitação do cliente</h2>
            <p>{os.observacoesGerais}</p>
          </section>
        )}

        <section className="print-section">
          <h2>Serviço realizado</h2>
          <p>{s.descricaoServico || '—'}</p>
        </section>

        <section className="print-section">
          <h2>Peças utilizadas</h2>
          <table className="print-table">
            <thead><tr><th>Item</th><th>Descrição</th><th>Valor</th></tr></thead>
            <tbody>
              {s.pecas.length === 0 && <tr><td colSpan={3} className="print-muted">Nenhuma peça utilizada</td></tr>}
              {s.pecas.map((p, i) => (<tr key={p.id || i}><td>{i + 1}</td><td>{p.descricao}</td><td>{fmtMoney(p.preco)}</td></tr>))}
            </tbody>
          </table>
        </section>

        <section className="print-section print-grid-2">
          <div className="sig-approval">
            <span>{s.aprovado === 'aprovado' ? '☑' : '☐'} Aprovado</span>
            <span>{s.aprovado === 'reprovado' ? '☑' : '☐'} Reprovado</span>
            <span>{s.aprovado === 'descarte' ? '☑' : '☐'} Descarte</span>
          </div>
          <div className="print-totals">
            <div><span>Total de peças</span><strong>{fmtMoney(s.subtotalPecas)}</strong></div>
            <div><span>Total de mão de obra</span><strong>{fmtMoney(s.valorServico)}</strong></div>
            <div><span>Frete / deslocamento</span><strong>{fmtMoney(s.deslocamento)}</strong></div>
            <div><span>Desconto</span><strong>{fmtMoney(s.desconto)}</strong></div>
            <div className="print-total-final"><span>TOTAL</span><strong>{fmtMoney(s.totalGeral)}</strong></div>
          </div>
        </section>

        <p className="print-payment">Forma de pagamento: {s.formaPagamento || '—'}</p>

        <section className="print-section">
          <h2>Observações</h2>
          <p>{os.empresa.garantiaPadraoInterno}</p>
        </section>

        <div className="print-footer">
          {os.empresa.endereco}{os.empresa.cidade ? `, ${os.empresa.cidade}` : ''}{os.empresa.uf ? `/${os.empresa.uf}` : ''}{os.empresa.cep ? ` - CEP ${os.empresa.cep}` : ''}{os.empresa.telefone ? ` - ${os.empresa.telefone}` : ''}{os.empresa.email ? ` - ${os.empresa.email}` : ''}<br />
          {os.empresa.cnpj ? `CNPJ: ${os.empresa.cnpj}` : ''}{os.empresa.ie ? ` | I.E. ${os.empresa.ie}` : ''}{os.empresa.im ? ` | I.M. ${os.empresa.im}` : ''}
        </div>

        {os.fotos.length > 0 && (
          <div className="print-photos-page">
            <h2>Fotos do serviço — OS {os.numero}</h2>
            <div className="print-photos-grid">
              {os.fotos.map((f) => (
                <figure key={f.id}><img src={`${API_BASE}/${f.url}`} alt={f.legenda || ''} />{f.legenda && <figcaption>{f.legenda}</figcaption>}</figure>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [usuario, setUsuario] = useState(undefined); // undefined = checando, null = deslogado

  useEffect(() => {
    api.get('/auth.php').then(setUsuario).catch(() => setUsuario(null));
  }, []);

  async function sair() {
    try { await api.del('/auth.php'); } catch (e) { /* segue mesmo se falhar */ }
    setUsuario(null);
  }

  if (usuario === undefined) {
    return <div className="bancada-app"><style>{CSS}</style><div className="loading-screen">Carregando…</div></div>;
  }
  if (usuario === null) {
    return <LoginScreen onLogin={setUsuario} />;
  }
  return <AppAutenticado usuario={usuario} onLogout={sair} />;
}

/* ---------- styles ---------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.bancada-app {
  --bg: #EEF0EE;
  --surface: #FFFFFF;
  --surface-alt: #F5F6F4;
  --ink: #1E2A2E;
  --ink-muted: #647071;
  --line: #DBE0DD;
  --navy: #24384A;
  --navy-soft: #E7ECF0;
  --brass: #A97B37;
  --brass-soft: #F3E7D3;
  --success: #3F7A55;
  --success-soft: #E1EFE5;
  --amber: #B06E17;
  --amber-soft: #FBEAD2;
  --danger: #A6432E;
  --danger-soft: #F7E4DF;
  font-family: 'IBM Plex Sans', sans-serif;
  color: var(--ink);
  background: var(--bg);
  min-height: 100%;
  display: flex;
  box-sizing: border-box;
}
.bancada-app * { box-sizing: border-box; }
.bancada-app h1, .bancada-app h2, .bancada-app h3 { font-family: 'Space Grotesk', sans-serif; margin: 0; }
.bancada-app button { font-family: inherit; cursor: pointer; }
.bancada-app input, .bancada-app select, .bancada-app textarea { font-family: inherit; font-size: 13.5px; }

.loading-screen { padding: 60px; color: var(--ink-muted); font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; justify-content: center; text-align: center; }

/* sidebar */
.sidebar { width: 216px; flex-shrink: 0; background: var(--navy); color: #EDEFEC; display: flex; flex-direction: column; padding: 22px 14px; gap: 18px; min-height: 100vh; }
.brand { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: 0.05em; }
.brand-logo { display: block; max-height: 34px; max-width: 100%; object-fit: contain; }
.brand-text { display: block; }
.brand small { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 400; letter-spacing: 0.09em; text-transform: uppercase; color: #9FB0BC; margin-top: 3px; }
.sidebar nav { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.nav-btn { display: flex; align-items: center; gap: 9px; background: transparent; border: none; color: #C9D3D8; padding: 9px 10px; border-radius: 6px; font-size: 13.5px; text-align: left; }
.nav-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
.nav-btn.active { background: var(--brass); color: #24384A; font-weight: 600; }
.reset-btn { display: flex; align-items: center; gap: 7px; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #9FB0BC; padding: 8px 10px; border-radius: 6px; font-size: 12px; }
.reset-btn:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
.sidebar-user { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; margin-bottom: 4px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 12px; }
.sidebar-user-nome { color: #fff; font-size: 12.5px; font-weight: 500; }
.sidebar-user-papel { color: #9FB0BC; font-size: 11px; }

.login-screen { align-items: center; justify-content: center; min-height: 100vh; background: var(--navy); }
.login-card { background: var(--surface); border-radius: 14px; padding: 32px 30px; width: 100%; max-width: 340px; box-shadow: 0 20px 50px rgba(0,0,0,0.25); display: flex; flex-direction: column; }
.login-logo { width: 44px; height: 44px; border-radius: 10px; background: var(--brass-soft); color: var(--brass); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.login-card h1 { font-family: 'Space Grotesk', sans-serif; font-size: 20px; margin: 0 0 4px; }
.login-card label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--ink-muted); margin-bottom: 12px; }
.login-card input { padding: 9px 11px; border-radius: 7px; border: 1px solid var(--line); font-size: 14px; }
.login-erro { background: var(--danger-soft); color: var(--danger); font-size: 12.5px; padding: 8px 10px; border-radius: 6px; margin-bottom: 14px; }

/* content */
.content { flex: 1; padding: 30px 36px; max-width: 1100px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.view-header h2 { font-size: 21px; }
.section-title { font-size: 14px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 26px 0 10px; }

/* buttons */
.btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 7px; padding: 9px 14px; font-size: 13.5px; border: 1px solid transparent; }
.btn.primary { background: var(--navy); color: #fff; }
.btn.primary:hover { background: #1b2c3a; }
.btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.ghost { background: transparent; border-color: var(--line); color: var(--ink); }
.btn.ghost:hover { background: var(--surface-alt); }
.btn.small { padding: 6px 10px; font-size: 12.5px; background: var(--surface-alt); border: 1px solid var(--line); }
.btn.danger-ghost { background: transparent; border: 1px solid var(--danger-soft); color: var(--danger); }
.btn.danger-ghost:hover { background: var(--danger-soft); }
.link-btn { background: none; border: none; color: var(--navy); font-size: 12.5px; text-decoration: underline; padding: 0; }
.link-btn.danger { color: var(--danger); }
.link-back { background: none; border: none; color: var(--ink-muted); display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 14px; padding: 0; }
.icon-btn { background: none; border: none; color: var(--ink-muted); padding: 4px; border-radius: 5px; }
.icon-btn:hover { background: var(--danger-soft); color: var(--danger); }

/* stats */
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 8px; }
.stat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
.stat-num { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; }
.stat-label { font-size: 12px; color: var(--ink-muted); }
.stat-card.amber .stat-num { color: var(--amber); }
.stat-card.accent .stat-num { color: var(--navy); }
.stat-card.success .stat-num { color: var(--success); }

/* table */
.data-table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.data-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-muted); background: var(--surface-alt); padding: 10px 14px; font-weight: 500; }
.data-table td { padding: 11px 14px; border-top: 1px solid var(--line); font-size: 13.5px; }
.data-table tr.clickable { cursor: pointer; }
.data-table tr.clickable:hover td { background: var(--surface-alt); }
.row-actions { display: flex; gap: 12px; }
.mono { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; }

/* badges & tags */
.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 500; white-space: nowrap; }
.tone-neutral { background: var(--surface-alt); color: var(--ink-muted); border: 1px solid var(--line); }
.tone-amber { background: var(--amber-soft); color: var(--amber); }
.tone-accent { background: var(--navy-soft); color: var(--navy); }
.tone-success { background: var(--success-soft); color: var(--success); }
.tone-success-solid { background: var(--success); color: #fff; }
.tone-danger { background: var(--danger-soft); color: var(--danger); }
.os-tag { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.03em; padding: 3px 8px; border: 1px dashed var(--brass); background: var(--brass-soft); color: var(--brass); border-radius: 4px; }

/* forms */
.filter-row { display: flex; gap: 10px; margin-bottom: 14px; align-items: center; }
.filter-row select { padding: 8px 10px; border-radius: 7px; border: 1px solid var(--line); background: var(--surface); }
.search-box { display: flex; align-items: center; gap: 7px; border: 1px solid var(--line); border-radius: 7px; padding: 7px 10px; background: var(--surface); flex: 1; max-width: 320px; color: var(--ink-muted); }
.search-box input { border: none; outline: none; flex: 1; background: transparent; }

.autocomplete { position: relative; }
.autocomplete input { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
.autocomplete-list { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); max-height: 220px; overflow-y: auto; z-index: 20; }
.autocomplete-item { display: block; width: 100%; text-align: left; padding: 8px 10px; background: none; border: none; border-top: 1px solid var(--line); font-size: 13px; color: var(--ink); }
.autocomplete-item:first-child { border-top: none; }
.autocomplete-item:hover { background: var(--surface-alt); }
.autocomplete-empty { padding: 10px; font-size: 12.5px; color: var(--ink-muted); }
.autocomplete-create { display: flex; align-items: center; gap: 6px; color: var(--brass); font-weight: 500; }
.autocomplete-peca { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.autocomplete-price { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--ink-muted); white-space: nowrap; }
.form-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin-bottom: 18px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--ink-muted); }
.form-grid .span-2 { grid-column: span 2; }
.form-grid input, .form-grid select, .form-grid textarea { padding: 8px 10px; border-radius: 6px; border: 1px solid var(--line); color: var(--ink); background: var(--surface); resize: vertical; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.hint { font-size: 12.5px; color: var(--amber); margin-top: 8px; }

/* empty state */
.empty-state { border: 1px dashed var(--line); border-radius: 12px; padding: 40px 24px; text-align: center; background: var(--surface); }
.empty-title { font-family: 'Space Grotesk', sans-serif; font-size: 16px; margin-bottom: 6px; }
.empty-hint { color: var(--ink-muted); font-size: 13px; margin-bottom: 16px; max-width: 420px; margin-left: auto; margin-right: auto; }

/* os detail */
.os-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 12px; }
.os-header h2 { font-size: 19px; margin-top: 8px; }
.os-header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.os-header-right select { padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); font-size: 12.5px; }
.muted { color: var(--ink-muted); font-size: 13px; margin-top: 2px; }
.muted.small { font-size: 12px; }
.os-meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
.os-meta-grid .label { display: block; font-size: 11px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
.meta-select { padding: 5px 7px; border-radius: 5px; border: 1px solid var(--line); font-size: 12.5px; background: var(--surface); }

.checklist-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
.checklist-card h3 { font-size: 14.5px; margin-bottom: 0; }
.checklist-header { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: none; padding: 0; margin-bottom: 10px; text-align: left; color: var(--ink); }
.checklist-header-right { display: flex; align-items: center; gap: 8px; color: var(--ink-muted); }
.checklist-summary { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; background: var(--surface-alt); border: 1px solid var(--line); padding: 2px 7px; border-radius: 10px; }
.checklist-row { display: grid; grid-template-columns: 1.4fr auto 1fr auto; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); }
.checklist-row:first-of-type { border-top: none; }
.checklist-desc { font-size: 13px; }
.status-btns { display: flex; gap: 4px; }
.status-btn { border: 1px solid var(--line); background: var(--surface-alt); color: var(--ink-muted); font-size: 11.5px; padding: 5px 9px; border-radius: 5px; }
.status-btn.active.ok { background: var(--success-soft); color: var(--success); border-color: var(--success); }
.status-btn.active.bad { background: var(--danger-soft); color: var(--danger); border-color: var(--danger); }
.status-btn.active.neutral { background: var(--navy-soft); color: var(--navy); border-color: var(--navy); }
.checklist-obs { padding: 6px 8px; border-radius: 5px; border: 1px solid var(--line); font-size: 12.5px; }
.checklist-add { display: flex; gap: 8px; margin-top: 10px; }
.checklist-add input { flex: 1; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--line); }

.template-list { margin-top: 2px; margin-bottom: 14px; }
.template-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--line); font-size: 13px; }
.template-item:first-of-type { border-top: none; }
.template-add { display: flex; gap: 8px; margin-top: 8px; }
.template-add input { flex: 1; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--line); }

.inline-add-btn { display: flex; align-items: flex-end; }
.quick-add-card { border: 1px dashed var(--brass); background: var(--brass-soft); border-radius: 8px; padding: 14px; margin: -6px 0 16px; }
.quick-add-title { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #6E4E1F; margin-bottom: 8px; font-weight: 600; }

.import-log { margin-top: 14px; background: var(--surface-alt); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; font-size: 12.5px; }
.import-log strong { display: block; margin-bottom: 4px; }
.import-log ul { margin: 0; padding-left: 18px; color: var(--ink-muted); }
.import-log li { margin: 2px 0; }

.orcamento-card { background: var(--brass-soft); border: 1px solid var(--brass); border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
.orcamento-card h3 { font-size: 14.5px; margin-bottom: 10px; color: #6E4E1F; }
.subsection-title { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #6E4E1F; margin: 14px 0 6px; }
.field-note { display: block; font-size: 11px; color: var(--ink-muted); margin-top: 3px; font-style: italic; }

.pecas-list { margin-top: 2px; }
.peca-row { display: grid; grid-template-columns: 1fr 120px auto; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid rgba(0,0,0,0.08); }
.peca-row:first-of-type { border-top: none; }
.peca-desc, .peca-preco { padding: 6px 8px; border-radius: 5px; border: 1px solid var(--line); font-size: 12.5px; background: var(--surface); }
.peca-add { display: grid; grid-template-columns: 1fr 120px auto; gap: 8px; margin-top: 10px; }
.subtotal-line { text-align: right; font-size: 12.5px; margin-top: 10px; color: #6E4E1F; }
.total-line { text-align: right; font-size: 15px; margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--brass); font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: var(--navy); }

.internal-field { border: 1px dashed var(--ink-muted); border-radius: 8px; padding: 10px 12px; background: var(--surface-alt); margin-top: 14px; }
.internal-field textarea { width: 100%; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--line); resize: vertical; }
.tag-interno { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-muted); margin-bottom: 6px; }

.danger-zone { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); }

.fotos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-bottom: 12px; }
.foto-card { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
.foto-card img { width: 100%; height: 90px; object-fit: cover; display: block; }
.foto-card input { border: none; border-top: 1px solid var(--line); padding: 5px 7px; font-size: 11.5px; border-radius: 0; }
.foto-card .icon-btn { align-self: flex-end; }
.foto-upload-btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

.logo-preview-row { display: flex; align-items: center; gap: 12px; }
.logo-preview-row img { height: 48px; }

/* printable document */
.print-only { display: none; }
.print-doc { font-family: 'IBM Plex Sans', sans-serif; color: #111; font-size: 12px; }
.print-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #24384A; padding-bottom: 10px; margin-bottom: 14px; }
.print-header-left { display: flex; align-items: center; gap: 10px; }
.print-logo { height: 46px; }
.print-logo-placeholder { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 20px; }
.print-header-left h1 { font-size: 18px; }
.print-header-right { text-align: right; }
.print-os-number { font-family: 'IBM Plex Mono', monospace; }
.print-os-number strong { font-size: 16px; margin-left: 6px; }
.print-dates { display: flex; gap: 12px; font-size: 11px; color: #444; margin-top: 4px; }
.print-section { margin-bottom: 12px; }
.print-section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 5px; color: #444; }
.print-section p { margin: 2px 0; }
.print-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.print-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.print-table th, .print-table td { border: 1px solid #ccc; padding: 4px 7px; text-align: left; }
.print-table th:last-child, .print-table td:last-child { text-align: right; width: 90px; }
.print-muted { color: #888; font-style: italic; }
.chem-label-box { border: 1px dashed #999; border-radius: 6px; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #888; }
.chem-label-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.chem-label-hint { font-size: 10px; margin-top: 3px; }
.print-totals div { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
.print-checklist-item { margin: 3px 0; font-size: 12px; }
.print-horas { margin-top: 10px; font-size: 12px; }
.print-total-final { border-top: 1px solid #24384A; margin-top: 4px; padding-top: 4px !important; font-size: 14px !important; font-weight: 700; }
.print-payment { font-size: 12px; margin: 6px 0 12px; }
.print-signatures { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; gap: 20px; }
.sig-block { flex: 1; text-align: center; font-size: 10.5px; }
.sig-line { border-top: 1px solid #333; margin-bottom: 4px; height: 30px; }
.sig-approval { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.print-footer { margin-top: 20px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9.5px; color: #666; text-align: center; }
.print-photos-page { page-break-before: always; padding-top: 20px; }
.print-photos-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 10px; }
.print-photos-grid figure { margin: 0; }
.print-photos-grid img { width: 100%; border: 1px solid #ccc; border-radius: 4px; }
.print-photos-grid figcaption { font-size: 10.5px; color: #555; margin-top: 3px; }

/* comprovante de custódia */
.custodia-sheet { font-size: 10.5px; }
.via { padding: 6mm 0; }
.via-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #24384A; padding-bottom: 6px; margin-bottom: 8px; }
.via-header-left { display: flex; align-items: center; gap: 8px; }
.via-header-left .print-logo { height: 32px; }
.via-header-left .print-logo-placeholder { font-size: 15px; }
.via-title { font-family: 'Space Grotesk', sans-serif; font-size: 12px; font-weight: 600; margin-top: 2px; }
.via-tag { font-family: 'IBM Plex Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; background: #E7ECF0; color: #24384A; padding: 3px 8px; border-radius: 3px; }
.via-header-right { text-align: right; }
.via-date { font-size: 9.5px; color: #666; margin-top: 4px; }
.via-row { display: flex; gap: 18px; margin-bottom: 6px; }
.via-field { flex: 1; }
.via-field .label { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
.via-field .value { font-size: 11px; }
.itens-box { border: 1px solid #ccc; border-radius: 4px; padding: 6px 8px; margin: 4px 0 8px; font-size: 10px; }
.itens-box .label { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 2px; }
.policy-box { border-left: 3px solid #A97B37; background: #F3E7D3; padding: 7px 10px; font-size: 9px; line-height: 1.5; color: #5C4322; }
.policy-box strong { display: block; font-size: 9.5px; margin-bottom: 3px; color: #4A3419; }
.sign-row { display: flex; gap: 24px; margin-top: 10px; padding-top: 8px; }
.sign-block { flex: 1; text-align: center; font-size: 9px; }
.sign-line { border-top: 1px solid #333; margin-bottom: 3px; height: 22px; }
.declar { font-size: 8px; color: #777; text-align: center; margin-top: 6px; }
.cut-line { border-top: 1px dashed #999; position: relative; margin: 4mm 0; }
.cut-line span { position: absolute; left: 50%; top: -8px; transform: translateX(-50%); background: #fff; padding: 0 8px; font-size: 9px; color: #888; }

/* etiqueta interna — folha inteira: número grande pra cortar + ficha pra prancheta */
.etiqueta-sheet { display: flex; flex-direction: column; min-height: 260mm; }
.etiqueta-corte { display: flex; align-items: center; justify-content: center; gap: 24px; flex: 0 0 90mm; }
.etiqueta-numero-grande { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 160px; line-height: 1; text-align: center; border: 3px dashed #A97B37; background: #F3E7D3; color: #A97B37; border-radius: 16px; padding: 20px 40px; }
.etiqueta-qr { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.etiqueta-qr span { font-size: 9px; max-width: 100px; text-align: center; color: #666; }
.tag-ficha { flex: 1; padding-top: 6mm; }
.tag-ficha-header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #24384A; padding-bottom: 8px; margin-bottom: 10px; }
.tag-title { font-family: 'Space Grotesk', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; }
.tag-facts { border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 8px 0; margin-bottom: 10px; }
.tag-fact { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
.tag-fact .label { color: #666; }
.tag-fact .value { font-weight: 500; text-align: right; }
.tag-itens { font-size: 9.5px; color: #666; margin-bottom: 10px; line-height: 1.5; }
.tag-itens .label { display: block; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8.5px; margin-bottom: 3px; }
.tag-service-label { font-family: 'Space Grotesk', sans-serif; font-size: 10.5px; font-weight: 600; margin-bottom: 4px; color: #24384A; }
.tag-lines { height: 90mm; background-image: repeating-linear-gradient(to bottom, transparent, transparent 21px, #ddd 22px); }

@media print {
  .sidebar, .screen-only { display: none !important; }
  .print-only { display: block !important; }
  .bancada-app { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .content { padding: 0; max-width: 100%; }
}

@media (max-width: 780px) {
  .bancada-app { flex-direction: column; }
  .sidebar { width: 100%; min-height: auto; flex-direction: row; align-items: center; padding: 12px 14px; overflow-x: auto; }
  .sidebar nav { flex-direction: row; }
  .brand { display: none; }
  .reset-btn { display: none; }
  .content { padding: 18px; }
  .form-grid { grid-template-columns: 1fr; }
  .form-grid .span-2 { grid-column: span 1; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .os-meta-grid { grid-template-columns: repeat(2, 1fr); }
  .checklist-row { grid-template-columns: 1fr; gap: 6px; }
}
`;
