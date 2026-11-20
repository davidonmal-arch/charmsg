async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=await(await page.request.get('http://127.0.0.1:5173/index.html')).text();
 await page.setContent(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<div class="boot"[\s\S]*?<\/body>/,'</body>'));
 await page.evaluate(()=>{document.querySelector('#view').innerHTML=`<div class="page-head"><div><h1 class="page-title">Подарки</h1><p class="page-sub">Коллекция и предложения на маркете</p><nav class="section-links"><a href="#/nfts" aria-current="page">Магазин</a><a href="#/auctions">Аукционы и выкуп</a></nav></div></div><div class="stats-grid"><section class="card card-pad"><h2>Создать подарок</h2><label class="field">Название<input class="input" placeholder="Название подарка"></label><label class="field">Эффект<select class="input"><option>Пламя</option><option>Лёд</option></select></label><button class="btn btn-primary" id="preview">Предпросмотр</button><p id="feedback" role="status"></p></section><article class="nft-card"><div class="nft-art fx-fire"><img src="assets/logo.jpg" alt="Подарок"><span class="nft-effect">Пламя</span></div><div class="nft-body"><h3>Коллекционный подарок</h3><button class="btn">Посмотреть подарок</button></div></article></div>`;document.querySelector('#preview').onclick=()=>document.querySelector('#feedback').textContent='Предпросмотр открыт';});
 const results=[];
 for(const width of [1440,768,390,360]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(200);
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,background:getComputedStyle(document.body).backgroundColor,buttonHeight:document.querySelector('#preview').getBoundingClientRect().height}));
  if(metrics.overflow)throw Error('Horizontal overflow at '+width);
  if(width<=390&&metrics.buttonHeight<44)throw Error('Touch target too small');
  await page.getByPlaceholder('Название подарка').fill('Котокролик');await page.locator('#preview').click();
  if(await page.locator('#feedback').textContent()!=='Предпросмотр открыт')throw Error('Interaction failed');
  await page.screenshot({path:'C:/Users/jinpo/AppData/Local/Temp/charmsg-check-'+width+'.png',fullPage:true});results.push({width,...metrics});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 if(await page.locator('.fx-fire').evaluate(el=>getComputedStyle(el,'::before').animationName)!=='none')throw Error('Reduced motion failed');
 if(errors.length)throw Error(errors.join('; '));return {results,pageErrors:errors,scope:'Isolated UI fixture; no production authentication or mutations'};
}
