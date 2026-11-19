export function mountGames(container) {
  container.innerHTML = '<div class="page-head"><h1 class="page-title">Игры</h1></div>'
    + '<div class="game-menu">'
    + '<a class="card card-pad stack" href="#/casino"><h2 class="section-title">Казино и апгрейдер</h2><p>Рулетка, игры на CR и улучшение NFT.</p><span class="btn">Играть</span></a>'
    + '<a class="card card-pad stack" href="#/quests"><h2 class="section-title">Задания и награды</h2><p>Выполняй задания и забирай CR.</p><span class="btn">Открыть задания</span></a>'
    + '<a class="card card-pad stack" href="#/market"><h2 class="section-title">Биржа CHR</h2><p>Покупай и продавай игровую валюту.</p><span class="btn">На биржу</span></a></div>';
}
