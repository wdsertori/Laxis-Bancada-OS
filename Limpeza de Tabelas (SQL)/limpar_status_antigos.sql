-- Converte OS com status antigos (aprovado/reprovado) pra concluido.
-- Seguro mesmo que nenhuma linha seja afetada.
UPDATE ordens SET status = 'concluido' WHERE status IN ('aprovado', 'reprovado');
