import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { seal, unseal, VerificationService, validateAnalysis, redactImage } from './verification.mjs';

test('AES encryption rejects tampering and masks replace underlying pixels', async () => {
  const key = randomBytes(32), encrypted = seal('private beneficiary',key);
  assert.equal(unseal(encrypted,key).toString(),'private beneficiary');
  encrypted[30] ^= 1;
  assert.throws(() => unseal(encrypted,key));
  const bytes = await sharp({ create: { width:100,height:100,channels:3,background:'#ffffff' } }).png().toBuffer();
  const redacted = await redactImage(bytes,[{x:.2,y:.2,width:.5,height:.5}]);
  const { data } = await sharp(redacted).raw().toBuffer({ resolveWithObject:true });
  assert.ok(data[(50*100+50)*3] < 50);
});

test('Gemini extraction is encrypted; unsafe image and raw model text never enter public output', async () => {
  const dir=mkdtempSync(join(tmpdir(),'lantern-evidence-'));
  const privateAnalysis={vendor:'Private Supplier',invoice:'PRIVATE-099',amount:500,currency:'INR',categoryMatches:true,readable:true,suspicious:false,redactions:[{x:.1,y:.1,width:.2,height:.2}]};
  const key='test-server-key'; let calls=0;
  try {
    const service=new VerificationService({dataDir:dir,apiKey:key,fetcher:async (url,options)=>{
      assert.equal(options.headers['x-goog-api-key'],key);
      assert.equal(url.includes(key),false);
      const result=calls++===0 ? privateAnalysis : {safe:false};
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}]})};
    }});
    const image=await sharp({create:{width:80,height:80,channels:3,background:'#ffffff'}}).jpeg().toBuffer();
    const result=await service.analyze('harbor-hands',{image:`data:image/jpeg;base64,${image.toString('base64')}`,amountInr:500,category:'Water'},null);
    assert.equal(calls,2);
    assert.equal(result.privacy,'image_withheld');
    assert.equal(result.publicImage,'');
    assert.equal(JSON.stringify(result).includes('PRIVATE-099'),false);
    assert.equal(JSON.stringify(result).includes('Private Supplier'),false);
    const disk=readFileSync(join(dir,'evidence',`${result.id}.json`),'utf8');
    assert.equal(disk.includes('PRIVATE-099'),false);
    const reloaded=await service.load(result.id,'harbor-hands',null);
    assert.equal(reloaded.analysis.invoice,'PRIVATE-099');
    await assert.rejects(()=>service.load(result.id,'another-ngo',null),/not found/);
    await assert.rejects(()=>new VerificationService({dataDir:dir,apiKey:''}).analyze('harbor-hands',{},null),/GEMINI_API_KEY/);
    assert.throws(()=>validateAnalysis({...privateAnalysis,redactions:[{x:-1,y:0,width:1,height:1}]}),/privacy masks/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
