import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getFirestore } from "../database.js";
import { DEFAULT_CONFIG } from "./engine.js";
import { paperEmergencyStop, paperHistory, paperOverview, paperSaveBot, paperSetStatus, runDueBots } from "./service.js";

assert.ok(process.env.NEON_BRANCH?.startsWith("migration-test-"), "Use a disposable test branch");
const db=getFirestore(),admin={uid:"paper_test_admin",isAdmin:true},stranger={uid:"paper_test_user",isAdmin:false},ids=[];
const config={...DEFAULT_CONFIG,name:"Test bot",minVolumeUsd:0,signalPct:.2};
const market={calls:0,async quotes(pairs){this.calls++;const now=Date.now();return{quotes:Object.fromEntries([...new Set(pairs)].map(pair=>[pair,{source:"coinbase-exchange",pair,id:"quote-1",asOf:now,bid:110,ask:110.01,volumeUsd:1e8,historyEnd:now-60000,closes:Array.from({length:40},(_,i)=>80+i)}])),errors:{}}}};
try{
 await db.sql.query(await readFile(new URL("./schema.sql",import.meta.url),"utf8"));
 await paperEmergencyStop(admin,{halted:false});
 await assert.rejects(()=>paperOverview(stranger));
 for(let i=0;i<2;i++)ids.push((await paperSaveBot(admin,{config:{...config,name:"Test bot "+i}})).id);
 for(const id of ids)await paperSetStatus(admin,{id,status:"running"});
 await db.sql.query("UPDATE charmsg.paper_bots SET next_run=now()-interval '1 second' WHERE id=ANY($1::text[])",[ids]);
 assert.equal(await runDueBots(market),2);assert.equal(market.calls,1,"one market batch serves multiple bots");
 let overview=await paperOverview(admin);assert.equal(overview.bots.filter(bot=>ids.includes(bot.id)).length,2);
 for(const bot of overview.bots.filter(bot=>ids.includes(bot.id))){assert.equal(bot.state.positions.length,1);assert.ok(bot.state.cashCents>=0)}
 const firstHistory=await paperHistory(admin,{botId:ids[0],kind:"order"});assert.equal(firstHistory.events.length,1);
 await db.sql.query("UPDATE charmsg.paper_bots SET next_run=now()-interval '1 second' WHERE id=ANY($1::text[])",[ids]);
 assert.equal(await runDueBots(market),2);assert.equal((await paperHistory(admin,{botId:ids[0],kind:"order"})).events.length,1,"same quote is not executed twice");
 overview=await paperOverview(admin);const saved=overview.bots.find(bot=>bot.id===ids[0]);assert.equal(saved.state.positions.length,1,"state survives a new service read");
 await paperEmergencyStop(admin,{halted:true});overview=await paperOverview(admin);assert.equal(overview.control.halted,true);assert.ok(overview.bots.filter(bot=>ids.includes(bot.id)).every(bot=>bot.status==="paused"));assert.equal(await runDueBots(market),0);
 await assert.rejects(()=>paperSetStatus(admin,{id:ids[0],status:"running"}));
 await paperEmergencyStop(admin,{halted:false});await paperSetStatus(admin,{id:ids[0],status:"running"});
 await db.sql.query("UPDATE charmsg.paper_bots SET next_run=now()-interval '1 second' WHERE id=$1",[ids[0]]);
 const unavailable={async quotes(){return{quotes:{},errors:{"BTC-USD":"provider unavailable"}}}};
 assert.equal(await runDueBots(unavailable),1);overview=await paperOverview(admin);assert.match(overview.bots.find(bot=>bot.id===ids[0]).last_error,/unavailable/);
 console.log("Paper persistence checks passed: two bots, batching, restart state, idempotency, provider outage and emergency stop.");
}finally{
 await db.sql.transaction(async client=>{await client.query("DELETE FROM charmsg.paper_events WHERE bot_id=ANY($1::text[])",[ids]);await client.query("DELETE FROM charmsg.paper_bots WHERE id=ANY($1::text[])",[ids]);await client.query("UPDATE charmsg.paper_control SET halted=false,worker_error=null WHERE id=true")}).catch(()=>{});
 await db.terminate();
}
