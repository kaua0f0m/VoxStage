# VoxStage 1.1

Versão 1.1 para Windows, Android e Google TV, com as melhorias de pontuação e reprodução. A versão pública 1.0.2 permanece preservada. A entrega inclui Windows x64 e APK ARM64; captura, latência e desempenho em celulares/TV físicos ainda precisam de avaliação.

## Abrir

Feche a outra janela do VoxStage e abra **Abrir VoxStage Nativo.bat** ou **Abrir VoxStage Teste.bat**. Ambos preferem `releases/V1.1.0/VoxStage-Windows-x64/VoxStage.exe`. Configurações → Sobre identifica **1.1**, com autor, inspiração e atribuições recolhidas. Cada entrega atualiza a identificação; abrir o aplicativo não altera a versão.

## Pontuação

1. Abra uma música com vocais separados e toque em **♪ Pontuar**.
2. Escolha o microfone e a referência: **Ambos os vocais**, **3 trilhas**, principal, backing ou um arquivo vocal com o mesmo início. Ambos aceita a melodia reconhecida em qualquer vocal. Três trilhas usa o instrumental quando não reconhece voz nos vocais.
3. Ative a pontuação e libere o microfone. O mapa é preparado em segundo plano e guardado no cache. Quando estiver pronto, o painel fecha, a música volta ao início e toca automaticamente.
4. Cante acompanhando as notas que chegam pela direita. Cada nota conta uma vez quando pelo menos **35% da sua duração** foi cantada dentro da tolerância. Cada acerto soma **1.000 pontos**; erros e silêncio nunca retiram pontos ganhos.
5. As estrelas consideram as notas acertadas em relação ao **mapa inteiro**, incluindo notas puladas: 1★ = 9%, 2★ = 18%, 3★ = 27%, 4★ = 36%, 5★ = 45%, 5★ douradas = 55%. As estrelas conquistadas são brancas até alcançar 55%.
6. Pausar suspende a avaliação. Repetir trechos não duplica pontos nem substitui avaliações anteriores. **Nova tentativa** zera, rebobina e toca novamente. Resultado parcial e últimas apresentações ficam salvos localmente; históricos antigos continuam identificados como avaliações anteriores.

Normal: 75 cents; fácil: 100 cents; precisa: 40 cents. Outra oitava é opcional. Velocidade (0,75×–1,25×) e tom (−4–+4 semitons) alteram a referência em tempo real. O ajuste extra positivo compara sua voz com um trecho anterior. A suavização afeta o desenho, enquanto a avaliação usa a detecção original.

## Android e Google TV

O Android usa captura nativa com permissão de microfone e libera a captura ao sair do app. Na vertical, o overlay compacto reúne notas, letra atual e próxima frase, reaproveitando a letra existente. Na horizontal, a barra de notas tem 68 px, menor que no PC. A opção de letras abaixo da barra exige tempos reais por palavra no PC, TV e Android horizontal; na vertical admite tempos por linha. Desativar a opção restaura a exibição normal. Ajustes e censura da letra são mantidos. Na TV, o controle remoto navega no painel e Voltar fecha o diálogo da frente.

A preparação reduz o áudio para 12 kHz antes de copiar/enviar para análise, reduzindo a memória temporária. O desenho é limitado a cerca de 30 quadros/s no Android e não anima a barra quando oculta. O mapa mantém as notas agrupadas e a detecção da versão anterior.

## Celular como microfone do PC/TV

1. Deixe os aparelhos na mesma rede Wi-Fi. Conecte o app Android pelo QR do PC/TV, em **Conectar ao VoxStage**.
2. No PC/TV, abra Pontuar, escolha **Celular conectado** e ative a pontuação.
3. No Android conectado, toque em **Usar como microfone** e libere a permissão. Mantenha o app aberto.
4. O PC/TV começa a música ao receber a conexão. **Parar microfone** encerra a captura. Perder a conexão interrompe a pontuação e pausa a música.

O áudio do microfone não é reproduzido, gravado ou enviado pela rede. Somente frequência, confiança, nível e horário de captura são enviados ao aparelho conectado, usando a mesma sessão autenticada do QR. O horário e o atraso da rede são compensados; pausa, busca e transposição são respeitados. Esta função exige o Android atualizado; o aplicativo 1.0.2 não contém a captura nativa necessária.

## Avaliar antes de publicar

Use fones para evitar que o vocal original seja detectado pelo microfone. A análise YIN é monofônica: resíduos instrumentais, coros e separações ruins podem gerar notas erradas. Em Square Up experimente Ambos os vocais; em Pé de bode, onde o refrão caiu no instrumental, experimente 3 trilhas. Uma separação melhor ou vocal alternativo pode melhorar o mapa. SheetSage2 não foi adicionado.

Testes isolados cobrem detector/mapa, pontos cumulativos, limites de estrelas, pausa/repetição/busca, velocidade/tom, permissões/cancelamento/liberação, layout vertical/horizontal, navegação da TV e o protocolo real de rede com um celular simulado. A compilação Kotlin e a verificação Rust não substituem avaliar captura, atraso, Wi-Fi e desempenho em Android/TV físicos.

## Ajustes RC-2

Os links de autor e inspiração da aba Sobre abrem o navegador padrão no Windows e usam a integração nativa no Android/TV. O atalho Configurar microfone e canto e os ajustes duplicados de velocidade/tom ficam em Configurações → Debug, disponível apenas em builds debug, snapshot, teste ou RC. A versão estável 1.1 oculta essa aba. Os controles do palco continuam disponíveis em todas as versões.

## Ajustes RC-3

No Android, velocidade/tom e Pontuar compartilham uma linha de botões com largura ajustada ao conteúdo. O popup abre acima de toda a barra de controles e reposiciona ao girar a tela; abrir volumes fecha esse popup e vice-versa. Na TV, os controles ficam numa faixa compacta e a altura das notas acompanha a resolução, mantendo espaço para letras e capa. Play/pause permanece acessível. O controle remoto ajusta a velocidade no popup, e Voltar fecha o popup antes de sair do palco.
