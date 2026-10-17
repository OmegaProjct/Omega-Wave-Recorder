/**
 * Build script for native WASAPI per-process loopback helper.
 * Locates MSVC via vswhere, sets up the installed x64 Windows SDK environment,
 * and compiles native/process-loopback.cpp into out/native/process-loopback.exe.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync, execSync } = require('child_process');

// 1. Windows platform check
if (process.platform !== 'win32') {
  console.warn(`[build-loopback] Skipping build on non-Windows platform: ${process.platform}`);
  process.exit(0);
}

const rootDir = path.resolve(__dirname, '..');
const sourceFile = path.join(rootDir, 'native', 'process-loopback.cpp');
const outDir = path.join(rootDir, 'out', 'native');
const exeFile = path.join(outDir, 'process-loopback.exe');
const objFile = path.join(outDir, 'process-loopback.obj');

if (!fs.existsSync(sourceFile)) {
  console.error(`[build-loopback] Source file not found: ${sourceFile}`);
  process.exit(1);
}

// 2. Locate vswhere.exe
function findVsWhere() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// 3. Locate vcvars64.bat
function findVcvars64() {
  const vswhere = findVsWhere();
  if (vswhere) {
    try {
      const output = execFileSync(
        vswhere,
        ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();

      if (output) {
        const vcvars = path.join(output, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
        if (fs.existsSync(vcvars)) {
          return vcvars;
        }
      }
    } catch (err) {
      // Continue to known fallback paths
    }
  }

  // Fallback paths for standard VS installations
  const knownFallbacks = [
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat'
  ];

  for (const fallback of knownFallbacks) {
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  }

  return null;
}

const vcvars64Path = findVcvars64();
if (!vcvars64Path) {
  console.error('[build-loopback] Error: Could not locate Visual Studio vcvars64.bat toolchain setup script.');
  process.exit(1);
}

console.log(`[build-loopback] Found vcvars64 at: ${vcvars64Path}`);

// 4. Capture the compiler environment using the installed SDK.
function getMsvcEnvironment(vcvarsPath) {
  const command = `"${vcvarsPath}" >nul && set`;

  const output = execSync(command, {
    shell: 'cmd.exe',
    encoding: 'utf8',
    windowsHide: true
  });

  const env = { ...process.env };
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx);
      const val = line.slice(eqIdx + 1);
      env[key] = val;
    }
  }
  return env;
}

console.log('[build-loopback] Setting up MSVC x64 build environment...');
const msvcEnv = getMsvcEnvironment(vcvars64Path);

// Find cl.exe in PATH
function findClExe(env) {
  const pathDirs = (env.PATH || env.Path || '').split(';');
  for (const dir of pathDirs) {
    if (!dir) continue;
    const clCandidate = path.join(dir, 'cl.exe');
    if (fs.existsSync(clCandidate)) {
      return clCandidate;
    }
  }
  return 'cl.exe';
}

const clPath = findClExe(msvcEnv);
console.log(`[build-loopback] Using compiler: ${clPath}`);

// 5. Ensure output directory exists
fs.mkdirSync(outDir, { recursive: true });

// 6. Invoke MSVC cl.exe using argument array
const compilerArgs = [
  '/nologo',
  '/O2',
  '/W4',
  '/std:c++17',
  '/EHsc',
  '/MT',
  '/DUNICODE',
  '/D_UNICODE',
  sourceFile,
  `/Fo${objFile}`,
  `/Fe${exeFile}`,
  '/link',
  '/SUBSYSTEM:CONSOLE',
  '/MACHINE:X64',
  'ole32.lib',
  'mmdevapi.lib',
  'user32.lib',
  'avrt.lib'
];

console.log(`[build-loopback] Compiling ${path.basename(sourceFile)} -> ${path.relative(rootDir, exeFile)}...`);

const compileResult = spawnSync(clPath, compilerArgs, {
  cwd: rootDir,
  env: msvcEnv,
  windowsHide: true,
  stdio: 'inherit'
});

if (compileResult.error) {
  console.error('[build-loopback] Failed to execute compiler:', compileResult.error);
  process.exit(1);
}

if (compileResult.status !== 0) {
  console.error(`[build-loopback] Compiler exited with code: ${compileResult.status}`);
  process.exit(compileResult.status || 1);
}

if (!fs.existsSync(exeFile)) {
  console.error(`[build-loopback] Expected output binary not found at ${exeFile}`);
  process.exit(1);
}

console.log(`[build-loopback] Compilation successful: ${exeFile}`);
const selfTest = spawnSync(exeFile, ['--self-test'], { stdio: 'inherit', windowsHide: true });
if (selfTest.error) console.error(selfTest.error);
process.exit(selfTest.status ?? 1);
