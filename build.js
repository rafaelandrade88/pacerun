#!/usr/bin/env node
/**
 * PaceRun — Build Script LOCAL
 * 
 * Uso: node build.js
 * 
 * Lê as chaves do arquivo .env local (nunca commitado),
 * substitui os placeholders no index.html e copia tudo
 * para a pasta dist/ que vai pro git e Netlify publica.
 */

const fs   = require('fs');
const path = require('path');

// ── Carrega .env local ──────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Arquivo .env não encontrado!');
    console.error('   Crie o arquivo .env na raiz do projeto com as variáveis do Firebase.');
    console.error('   Veja o arquivo .env.example para referência.');
    process.exit(1);
  }

  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env   = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key) env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const ENV = loadEnv();

// ── Mapeamento placeholder → variável do .env ───────────
const PLACEHOLDERS = {
  '%%FIREBASE_API_KEY%%':             ENV.FIREBASE_API_KEY,
  '%%FIREBASE_AUTH_DOMAIN%%':         ENV.FIREBASE_AUTH_DOMAIN,
  '%%FIREBASE_PROJECT_ID%%':          ENV.FIREBASE_PROJECT_ID,
  '%%FIREBASE_STORAGE_BUCKET%%':      ENV.FIREBASE_STORAGE_BUCKET,
  '%%FIREBASE_MESSAGING_SENDER_ID%%': ENV.FIREBASE_MESSAGING_SENDER_ID,
  '%%FIREBASE_APP_ID%%':              ENV.FIREBASE_APP_ID,
};

// Valida se todas as variáveis estão no .env
const missing = Object.entries(PLACEHOLDERS)
  .filter(([, val]) => !val)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error('❌ Variáveis ausentes no .env:');
  missing.forEach(m => console.error('  -', m));
  process.exit(1);
}

// ── Garante que dist/ existe ────────────────────────────
if (!fs.existsSync('dist')) fs.mkdirSync('dist');

// ── Processa index.html: substitui placeholders ─────────
let html = fs.readFileSync('index.html', 'utf8');
let count = 0;
for (const [placeholder, value] of Object.entries(PLACEHOLDERS)) {
  if (html.includes(placeholder)) {
    html = html.replaceAll(placeholder, value);
    console.log(`✅ ${placeholder} → injetado`);
    count++;
  }
}
fs.writeFileSync(path.join('dist', 'index.html'), html, 'utf8');

// ── Copia arquivos estáticos para dist/ ─────────────────
const FILES = ['manifest.json', 'sw.js'];
const DIRS  = ['css', 'js', 'icons'];

FILES.forEach(f => {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join('dist', f));
    console.log(`📄 Copiado: ${f}`);
  }
});

DIRS.forEach(dir => {
  if (fs.existsSync(dir)) {
    copyDirSync(dir, path.join('dist', dir));
    console.log(`📁 Copiado: ${dir}/`);
  }
});

console.log(`\n🚀 Build concluído! ${count} variáveis injetadas em dist/`);
console.log(`📦 Próximo passo: git add dist/ && git commit && git push`);

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src).forEach(item => {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    fs.statSync(s).isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  });
}
