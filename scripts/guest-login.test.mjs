import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
let opened=0,click;
const context={guestLoginBtn:{addEventListener:(name,fn)=>{assert.equal(name,'click');click=fn;}},openPlayerLoginModal:()=>opened++};
runInNewContext(source.match(/guestLoginBtn\.addEventListener\("click"[^\n]+/)[0],context);
click();assert.equal(opened,1,'Login can open without boot/profile completion');
let profileClick;
const state={profile:null,admin:false},location={hash:''};
runInNewContext(source.match(/function wireHeader\(\) \{[\s\S]*?\r?\n\}/)[0]+'\nwireHeader();',{
 state,location,document:{getElementById:()=>({addEventListener:(_,fn)=>profileClick=fn})},
 adminEntryBtn:{addEventListener(){}},openPlayerLoginModal:()=>opened++,openAdminLoginModal(){}
});
profileClick();assert.equal(opened,2);assert.equal(location.hash,'');
state.profile={nick:'Saved account'};profileClick();assert.equal(location.hash,'#/profile');
assert.ok(!source.includes('if (!state.profile) setTimeout(showOnboarding, 1200)'));
console.log('Guest login passed: independent boot recovery, guest/account navigation, no recurring registration overlay.');
