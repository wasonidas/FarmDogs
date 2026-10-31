'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') throw new Error('Esta prueba requiere el compilador .NET Framework de Windows.');
const root = path.resolve(__dirname, '..');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const output = path.join(root, 'bin', 'RewardBridgeTests.exe');
fs.mkdirSync(path.dirname(output), { recursive: true });

function run(file, args, timeout) {
  const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} terminó con código ${result.status}.`);
}

// Compile against the test's small mock types, never the real WebView2 assembly.
run(compiler, [
  '/nologo', '/codepage:65001', '/langversion:5', '/platform:x64', '/target:exe',
  `/out:${output}`, '/r:System.Net.Http.dll', '/r:System.Web.Extensions.dll',
  path.join(root, 'native', 'DesktopProtocol.cs'),
  path.join(root, 'native', 'RewardBridge.cs'),
  path.join(root, 'native', 'RewardBridgeTests.cs'),
], 30_000);
run(output, [root], 30_000);
