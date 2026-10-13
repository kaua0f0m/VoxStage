# VoxStage 1.1 â€” feedback e avaliaÃ§Ã£o

Registrado em 12/10/2026. A versÃ£o pÃºblica continua sendo a 1.0.2; este documento acompanha o desenvolvimento da 1.1 e sua avaliaÃ§Ã£o local 1.1.0-test.1, somente Windows.

## Ajustes imediatos

- [x] Preencher tÃ­tulo e artista ao escolher um resultado do YouTube, antes de terminar o download ou a separaÃ§Ã£o. Usar a busca como alternativa para o tÃ­tulo. Preservar campos preenchidos manualmente.
- [x] Integrar as marcaÃ§Ãµes manuais ao silÃªncio automÃ¡tico: ocultar os marcadores que pulam durante pausas reais e manter o texto na tela. Tempos de letras prÃ³ximos devem ter prioridade sobre a ausÃªncia de voz no stem. Exemplo de regressÃ£o: **PÃ© de bode (Pisa no freio, ZÃ©)**, cujo refrÃ£o foi separado junto ao instrumental.
- [x] Buscar letras assim que o menu abrir, se houver tÃ­tulo disponÃ­vel. Repetir automaticamente respostas HTTP 503, com espera crescente e limite de tentativas. Evitar que respostas de uma mÃºsica ou busca anterior alterem a seleÃ§Ã£o atual.
- [x] Reconhecer **Instrum only** e **Instrumental only** como instrumental no MVSEP, em Windows e Android/TV. Preferir essa saÃ­da quando tambÃ©m existir outro instrumental para evitar seleÃ§Ã£o dependente da ordem dos arquivos.
- [x] Adicionar **Acoplar arquivos** ao progresso de arquivos recebidos e aos detalhes do envio concluÃ­do. Reaproveitar arquivos jÃ¡ baixados, sem repetir separaÃ§Ã£o, sem duplicar anexos e sem substituir ediÃ§Ãµes feitas no formulÃ¡rio.

Os itens marcados estÃ£o implementados no cÃ³digo de desenvolvimento. Nas letras com tempos apenas por linha, o fim da frase Ã© estimado; tempos explÃ­citos de palavras ou de fim de linha tÃªm prioridade.

## Velocidade e tom

- [x] Velocidade de **0,75Ã— a 1,25Ã—**, preservando o tom escolhido.
- [x] TransposiÃ§Ã£o independente de **âˆ’4 a +4 semitons**.
- [x] Controles nas configuraÃ§Ãµes de reproduÃ§Ã£o e na mixagem do palco, com botÃ£o Restaurar.
- [x] Processamento em tempo real por AudioWorklet, usando uma versÃ£o local fixa do SoundTouchJS. Nenhuma reencodificaÃ§Ã£o ou download Ã© necessÃ¡rio para mudar os parÃ¢metros.
- [x] Processador Ãºnico apÃ³s misturar os stems, com reserva de saÃ­da para impedir lacunas entre blocos e drenagem do Ã¡udio final.
- [x] RelÃ³gio e letras ajustados Ã  velocidade e ao atraso medido; compensaÃ§Ã£o antecipada da censura antes do processador.

O Ã¡udio original passa diretamente quando velocidade e tom estÃ£o normais. A alteraÃ§Ã£o durante a reproduÃ§Ã£o reinicia o fluxo na posiÃ§Ã£o atual, com uma pequena espera de preenchimento do buffer; nÃ£o processa a mÃºsica inteira. Dispositivos sem AudioWorklet mantÃªm o Ã¡udio original e informam a indisponibilidade.

Verificados frequÃªncia estÃ©reo, duraÃ§Ã£o e continuidade com nove combinaÃ§Ãµes de parÃ¢metros e dois trechos de 20 segundos, em 44,1/48 kHz. O processador padrÃ£o apresentou lacunas que foram corrigidas por uma reserva de 120 ms; os testes passaram sem essas lacunas. A integraÃ§Ã£o tambÃ©m verificou pausa, busca na faixa, relÃ³gio e espera pelo Ã¡udio final antes de encerrar a reproduÃ§Ã£o. Qualidade em mÃºsicas reais e desempenho em Android/TV fÃ­sicos continuam pendentes.

## Retorno da pontuaÃ§Ã£o â€” proposta

### PontuaÃ§Ã£o 2.0 â€” teste Windows implementado

- [x] Mapa local de frequÃªncia fundamental dos vocais com YIN, em worker e com cache local.
- [x] Microfone selecionÃ¡vel; captura por AudioWorklet, sem reproduÃ§Ã£o, gravaÃ§Ã£o ou envio do Ã¡udio.
- [x] ComparaÃ§Ã£o de afinaÃ§Ã£o em cents, tolerÃ¢ncia configurÃ¡vel, outra oitava opcional, resultado atÃ© 10.000 e cobertura vocal.
- [x] GrÃ¡fico da referÃªncia e da voz, painel no palco e resultados/histÃ³rico local.
- [x] IntegraÃ§Ã£o com velocidade, transposiÃ§Ã£o, pausa, busca na faixa, finalizaÃ§Ã£o e liberaÃ§Ã£o do microfone. CompensaÃ§Ã£o das latÃªncias conhecidas e ajuste manual extra.
- [x] ReferÃªncia alternativa por backing ou arquivo vocal local, inclusive para separaÃ§Ãµes inadequadas.
- [x] Modos **Ambos os vocais** e **3 trilhas**, com anÃ¡lise separada, aceitaÃ§Ã£o de principal/backing e instrumental como alternativa quando nÃ£o hÃ¡ vocal reconhecido.
- [x] Ativar pontuaÃ§Ã£o e Nova tentativa voltam ao inÃ­cio e dÃ£o play automaticamente depois de preparar a referÃªncia e o microfone.
- [x] Barras de notas sustentadas com agrupamento de vibrato, continuidade, correÃ§Ã£o de erros breves de oitava e preservaÃ§Ã£o de respiraÃ§Ãµes/pausas; cache atualizado.
- [x] Indicador do microfone com suavizaÃ§Ã£o curta independente da pontuaÃ§Ã£o; grÃ¡fico em barras com cÃ¢mera estÃ¡vel e respeito aos modos de referÃªncia.
- [x] Faixa de canto ampla no topo, cursor fixo Ã  esquerda, notas chegando pela direita, conexÃµes entre notas consecutivas e informaÃ§Ãµes simplificadas no palco.
- [x] Letras adicionais opcionais sob a faixa, preservando a letra original, os tempos por palavra/linha, ajustes e censura; preferÃªncia local.
- [x] Agrupamento de falhas audÃ­veis e desvios breves de atÃ© 160 ms entre notas iguais, mantendo respiraÃ§Ãµes silenciosas e mudanÃ§as claras; mapa/cache versÃ£o 5.

DisponÃ­vel na avaliaÃ§Ã£o **1.1.0-test.1**, sÃ³ Windows. Detalhes e roteiro em [TESTE-1.1.md](TESTE-1.1.md). O mapa usa um detector monofÃ´nico: resÃ­duos e vozes simultÃ¢neas precisam ser avaliados com mÃºsicas reais. SheetSage2 nÃ£o Ã© uma dependÃªncia desta implementaÃ§Ã£o.

### Caminho inicial: mapa de tom dos vocais isolados

PrÃ©-analisar a faixa vocal principal e guardar uma sequÃªncia de tempo, frequÃªncia fundamental e confianÃ§a. Capturar o microfone durante a apresentaÃ§Ã£o e comparar seu tom ao mapa usando a mesma lÃ³gica de detecÃ§Ã£o. A nota deve considerar distÃ¢ncia em cents, duraÃ§Ã£o cantada e confianÃ§a, com tolerÃ¢ncia configurÃ¡vel e opÃ§Ã£o de aceitar outra oitava.

Antes de oferecer pontuaÃ§Ã£o, validar compensaÃ§Ã£o de latÃªncia, trechos sem voz, vozes simultÃ¢neas, ruÃ­do e vazamento do som dos alto-falantes no microfone. Um teste com fones deve servir de referÃªncia. NÃ£o penalizar intervalos nos quais o stem de referÃªncia perdeu a voz. Para o refrÃ£o de PÃ© de bode, permitir corrigir a referÃªncia ou usar outra fonte vocal.

Primeira etapa recomendada: protÃ³tipo no Windows, com mapa de referÃªncia, indicaÃ§Ã£o de nota e comparaÃ§Ã£o ao microfone. SÃ³ depois definir a pontuaÃ§Ã£o final e integrar Android/TV, incluindo permissÃµes de microfone e escolha do aparelho que capta a voz. A detecÃ§Ã£o simples de tom pode falhar com backing, acordes e mÃºltiplos cantores; qualidade deve ser medida com mÃºsicas reais.

### Alternativa: SheetSage2 / YuE2

O [SheetSage2](https://huggingface.co/m-a-p/SheetSage2) exporta MIDI vocal, MIDI instrumental, ABC e eventos temporizados. Portanto, a integraÃ§Ã£o pode consumir MIDI/eventos diretamente. A documentaÃ§Ã£o recomenda Python 3.10/3.11, PyTorch 2.8 e FFmpeg 6.1 com bibliotecas compartilhadas; o runtime Windows atual usa Python 3.13. Exigiria ambiente opcional separado e avaliaÃ§Ã£o de tamanho, desempenho e precisÃ£o. A licenÃ§a informada Ã© CC BY-NC 4.0. Seus benchmarks nÃ£o demonstram transcriÃ§Ã£o perfeita de qualquer mÃºsica.

Avaliar como gerador opcional de referÃªncia no PC; nÃ£o como dependÃªncia obrigatÃ³ria do APK ou detector de microfone em tempo real. Comparar resultados ao caminho inicial antes de escolher.

## ValidaÃ§Ã£o e entrega

ConcluÃ­dos: cinco testes isolados do servidor; testes de interface em navegador para PC, Android/TV simulados e controle web; verificaÃ§Ã£o Rust com `cargo check --offline`. A interface cobre preenchimento sem substituir ediÃ§Ã£o, acoplamento sem duplicaÃ§Ã£o, busca ao abrir o menu, recuperaÃ§Ã£o de HTTP 503, cancelamento e prioridade da letra sobre pausas manuais/automÃ¡ticas com Ã¡udio vocal silencioso.

ConcluÃ­do tambÃ©m o smoke test do pacote Windows no WebView2 nativo, com biblioteca/perfil isolados e microfone simulado. A anÃ¡lise do stem local de PÃ© de bode levou cerca de 1,3 s para 147 s de Ã¡udio; reconheceu 9,6 s de referÃªncia, com o refrÃ£o 38â€“49 s fora da avaliaÃ§Ã£o. Esses nÃºmeros medem cobertura do detector, sem confirmar a precisÃ£o musical das notas.

Pendentes: ouvir e revisar o caso real de PÃ© de bode; validar em dispositivos fÃ­sicos; avaliar a PontuaÃ§Ã£o 2.0 com voz/microfone reais. Pacote Windows **1.1.0-test.1** preparado para essa avaliaÃ§Ã£o. Nenhum APK ou release pÃºblico 1.1 Ã© gerado. O atalho nativo prefere a versÃ£o de testes quando seu executÃ¡vel estiver presente; a versÃ£o pÃºblica 1.0.2 fica preservada.

## Lapidação RC-1

- [x] Pontos cumulativos por nota, sem perda de acertos; estrelas 10/20/30/40/55%, douradas 70%.
- [x] Fechar o painel ao começar; novo visual integrado ao app, diagnóstico recolhido e remoção de “2.0”.
- [x] Android vertical com barra compacta, letra atual e próxima frase; horizontal menor que PC.
- [x] PC/TV/Android horizontal exigem tempos próprios por palavra para letras na barra; vertical permite por linha.
- [x] Captura nativa Android; reduzir memória de análise e limitar animação.
- [x] Celular como microfone do PC/TV, com detecção de tom pela rede autenticada, compensação de relógio, pausa/busca e desconexão.
- [x] Sobre com autor/GitHub, inspiração/YouTube e atribuições recolhidas; limpeza de textos em Reprodução.
- [ ] Avaliar voz real, captura, latência e desempenho em celulares/TV físicos antes de publicar.

## Ajustes RC-2

- [x] Estrelas em 9/18/27/36/45%; brancas até 55%, quando ficam douradas.
- [x] Links de atribuição abrem o navegador padrão no Windows.
- [x] Controles duplicados de velocidade/tom e atalho de microfone movidos de Reprodução para Debug; aba exclusiva de builds debug, snapshot, teste e RC.

## Ajustes RC-3

- [x] Velocidade/tom e Pontuar na mesma linha compacta do Android.
- [x] Popup acima da barra inteira, com reposicionamento ao girar e exclusão mútua com os volumes.
- [x] TV com controles em faixa compacta, notas proporcionais à tela e navegação do popup pelo controle remoto.
- [x] Layout verificado em Android vertical/horizontal, 320 px e TV 720p/1080p/960×540 com capa e letras.

## Versão final 1.1

A candidata RC-3 foi promovida a 1.1 por solicitação do autor. A identificação dos pacotes passa a 1.1.0, e a aba Debug fica oculta na versão estável.

## Publicação 1.1

A publicação final inclui o código, o changelog completo desde a 1.0.2, o Windows x64 e o APK ARM64 para Android/Google TV. As notas anteriores sobre entrega apenas Windows descrevem as etapas de teste, não os pacotes finais. O README foi complementado preservando as edições do autor. A avaliação em celulares/TV físicos e com voz real continua pendente.
