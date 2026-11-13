# App Android "By Bus" (11/11/2026)

Decisão do dono: começar **sem Google Play** (opção A), instalando o arquivo .apk direto; nome **By Bus**; ícone com o logo da empresa.
Google Play depois, como empresa (US$ 25, uma vez; precisa do D-U-N-S, que dispensa os 12 testadores por 14 dias das contas pessoais).

## Como funciona
- Casca Capacitor 8.5.2 (`app-celular/`, mesmo modelo do APP TOMA) que abre https://gestao.bybusturismo.com.br. As telas se atualizam
  a cada publicação do sistema; só é preciso gerar um app novo quando muda algo do próprio app (nome, ícone, permissões).
- Identificador `br.com.bybusturismo.app`, só em pé, permissão de câmera (QR Code do voucher, fotos do checklist). Sem internet:
  tela "Sem conexão com o sistema" com "Tentar de novo".
- **Montagem no servidor** (`implantacao/gerar-app-android.sh`): Node 22 (`npm ci` + `cap sync`) e JDK 21 + ferramentas do Android
  em contêineres; o .apk fica em `implantacao/app-download/` e é servido em `https://<domínio>/app/by-bus.apk`.
- **Chave de assinatura** criada na primeira montagem e guardada só no servidor (`implantacao/android-chave/`, fora do git).
  Sem ela os celulares não aceitam atualizar o app: não apagar; fazer cópia fora do servidor (a confirmar com o dono).
- A versão é a data/hora da montagem (sempre maior que a anterior).

## Rastreio em segundo plano (11/11/2026)
O app tem o GPS em segundo plano para o motorista (ver `modulo-rastreio.md`). Depois de cada mudança na parte nativa, rodar de novo
`gerar-app-android.sh` e os motoristas instalam por cima (mesmo link, sem desinstalar).

## Não feito ainda
- Baixar arquivos dentro do app (CSV da lista, "Baixar" dos gabaritos): no Android o WebView não baixa sozinho; fase 2
  (mandar para o "Compartilhar" do celular, como no APP TOMA).
- iPhone (conta Apple de US$ 99/ano), avisos no celular, Google Play.
- Montagem no servidor funcionou em 11/11/2026 (segunda tentativa, depois de corrigir a linha da versão no build.gradle).

## Câmera no site
O cabeçalho `Permissions-Policy` do Caddy bloqueava a câmera (`camera=()`); desde 11/11/2026 é `camera=(self)`, para o QR Code
do voucher funcionar no navegador e no app.

## Impressão da lista de passageiros (dono, 13/11/2026)
- A legislação exige a **lista física** de passageiros no ônibus; a equipe imprime com uma **impressora portátil** em caso de
  fiscalização. Dentro do app o `window.print()` do navegador não faz nada, então o app ganhou um plugin próprio
  (`ImpressaoPlugin.java`, registrado na `MainActivity`) que abre a tela **Imprimir do Android** com a página atual, usando o
  mesmo layout de impressão do sistema. No web, `imprimirPagina()` (`util/appCelular.ts`) escolhe sozinho entre o app e o navegador.
- Funciona com qualquer impressora que apareça no Android: Wi-Fi/Wi-Fi Direct (Mopria, já vem no Android) ou Bluetooth com o
  app/serviço de impressão do fabricante; também "Salvar como PDF". Impressoras térmicas de bobina (58/80 mm) só se tiverem
  serviço de impressão para Android, e a lista sai estreita: para a fiscalização, prefira impressora portátil A4.
- Na tela do motorista, o cartão do City Tour tem o botão **Lista de passageiros (imprimir)**. O CPF completo na lista segue o
  perfil: o guia vê completo; o motorista vê mascarado, a menos que a supervisão dê "Ver documentos completos" ao perfil Motorista.
- Precisa de internet para abrir a lista: imprima antes da saída. **Exige gerar o app de novo** (`gerar-app-android.sh`) e
  atualizar nos celulares; app antigo mostra "atualize o app By Bus".
