# Perguntas abertas para o dono da empresa

Atualize este arquivo à medida que forem respondidas (resposta + data).

## Decisões estratégicas (bloqueiam a arquitetura)
1. **Paytour: integrar ou substituir?** Recomendação inicial: manter a Paytour vendendo e integrar via API (exige plano Premium, a confirmar), substituindo só depois, se fizer sentido. Pedir à Paytour documentação da API, sandbox e webhooks.
2. **Hospedagem e orçamento mensal** para infraestrutura (servidor, banco, backups, lojas de apps: Apple US$ 99/ano, Google US$ 25 único).
3. **Escopo do MVP:** concorda com Acesso + Cadastros + Frota/Manutenção + Catálogo/Saídas + Reservas como primeira entrega?
4. **Quem usa primeiro** e quantos usuários por perfil.

## Frota
5. Trenzinho: placa, modelo, cidade onde opera, autorização municipal, laudo CONTRAN 813. (Nada no Drive.)
6. Van QJU7192: modelo, ano, lugares, documentos.
7. Alocação real hoje: quais 3 ficam em BC, qual fica em Floripa, onde ficam os outros.
8. Qual ônibus é o publicitário e se ele também roda passeios.
9. Há rastreador/telemetria ou cartão combustível com API?

## Comercial
10. Tabela de preços oficial atual por produto e categoria (adulto, sênior, infantil — faixas de idade), e o "R$ 70" que aparece no site.
11. Política oficial de cancelamento, remarcação, chuva, no-show e gratuidades.
12. O site `bybusturismo.com.br` é da Paytour ou de outro fornecedor? (A loja é `loja.bybusturismo.com.br`.)
13. Blumenau/Oktoberfest ainda serão operados?

## Jurídico / fiscal
14. Contador atual pode validar a classificação ISS × ICMS dos passeios intermunicipais e o destaque CBS/IBS?
15. Situação das autorizações: SIE, ANTT (se houver viagens fora de SC), PIT/selo BC, Licença de Tráfego Floripa.
16. Quem será o encarregado de dados (LGPD)?

## Segurança imediata (recomendação, não depende do sistema)
17. Trocar a senha que está escrita no Manual do Atendente.
18. Revisar compartilhamentos de pastas com documentos de funcionários e listas com CPF.
19. Parar de receber pagamentos de clientes em chave PIX de pessoa física.

## Ambiente técnico
20. Liberar o domínio `bybusturismo.com.br` (e `loja.bybusturismo.com.br`, `paytour.com.br`) no acesso de rede do ambiente de nuvem, para a varredura completa do site.
