import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/wallet.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const walletModule=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('receipt review verification requests only account access and a free signature, never payment or network switching',async()=>{
  const originals={window:globalThis.window,fetch:globalThis.fetch,localStorage:globalThis.localStorage};
  const methods=[],urls=[],storage=new Map();
  try{
    globalThis.window={location:{search:'?campaign=campaign-two'},dispatchEvent(){},ethereum:{async request({method}){methods.push(method);if(method==='eth_requestAccounts')return ['0x1111111111111111111111111111111111111111'];if(method==='personal_sign')return '0xsignature';throw new Error(`Unexpected wallet action: ${method}`);}}};
    globalThis.localStorage={setItem(key,value){storage.set(key,value);}};
    globalThis.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>url.includes('/challenge')?{id:'nonce',message:'Free review access'}:{token:'review-token',source:'verified_testnet_donor'}};};
    assert.equal(await walletModule.enableDonorReviews(),'review-token');
    assert.deepEqual(methods,['eth_requestAccounts','personal_sign']);
    assert.deepEqual(urls,['/api/testnet/voter/challenge?campaign=campaign-two','/api/testnet/voter/session?campaign=campaign-two']);
    assert.equal(storage.get(walletModule.donorTokenKey),'review-token');
    delete globalThis.window.ethereum;
    await assert.rejects(()=>walletModule.enableDonorReviews(),/Reviewing is free/);
  }finally{for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
