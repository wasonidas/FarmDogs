'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {classifyGameScreen}=require('../src/game-screen.cjs');
const root=path.resolve(__dirname,'..');
const options={cwd:root,stdio:'inherit',windowsHide:true,timeout:30_000};
execFileSync(process.execPath,[path.join(root,'tools','build-image-text.cjs'),'--test'],options);
execFileSync(path.join(root,'bin','ImageTextReaderGeometryTests.exe'),[],options);

// Optional arguments are known HUD fixture images. They remain untouched: the
// reader only emits JSON into ignored bin/, and file reads cannot claim freshness.
if(process.argv.length>2)execFileSync(process.execPath,[path.join(root,'tools','build-image-text.cjs')],options);
for(const input of process.argv.slice(2)){
 const image=path.resolve(input),before=fs.statSync(image);
 const digest=crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');
 const output=path.join(root,'bin',`ocr-fixture-${crypto.randomUUID()}.json`);
 execFileSync(path.join(root,'bin','WardogsImageText.exe'),[image,output],options);
 const report=JSON.parse(fs.readFileSync(output,'utf8'));
 assert.equal(report.source.path,image);
 assert.equal(report.source.sha256,digest);
 assert.equal(report.source.kind,'file');
 assert.equal(report.source.capturedAt,null);
 assert.equal(report.captureFreshnessVerified,false);
 assert.equal(report.wordCoordinateSpace,'original_image_pixels');
 assert.equal(fs.statSync(image).mtimeMs,before.mtimeMs);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex'),digest);
 assert.equal(classifyGameScreen(report).phase,'gameplay_hud');
 assert.equal(classifyGameScreen(report).inputAllowed,false);
 for(const line of report.lines)for(const word of line.words){
  assert.equal(word.polygon.length,4);
  for(const point of word.polygon)assert.ok(point.length===2&&point.every(Number.isFinite));
  const xs=word.polygon.map(p=>p[0]),ys=word.polygon.map(p=>p[1]);
  assert.ok(Math.abs(word.x-Math.min(...xs))<1e-6);
  assert.ok(Math.abs(word.y-Math.min(...ys))<1e-6);
  assert.ok(Math.abs(word.width-(Math.max(...xs)-Math.min(...xs)))<1e-6);
  assert.ok(Math.abs(word.height-(Math.max(...ys)-Math.min(...ys)))<1e-6);
 }
 console.log(`HUD OCR y procedencia comprobados: ${path.basename(image)}; ${output}`);
}
