#!/usr/bin/env node
/**
 * PaceRun — Build Script para Netlify
 * 
 * Lê o index.html com placeholders e substitui pelas
 * variáveis de ambiente definidas no painel do Netlify.
 * 
 * Nunca commite chaves reais no repositório.
 */

const fs   = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, 'index.html');
const OUTPUT = path.join(__dirname, 'dist', 'index.html');

// Mapeamento: placeholder → variável de ambiente do Netlify
const ENV_MAP = {
  '%%FIREBASE_API_KEY%%':            process.env.FIREBASE_API_KEY,
  '%%FIREBASE_AUTH_DOMAIN%%':        process.env.FIREBASE_AUTH_DOMAIN,
  '%%FIREBASE_PROJECT_ID%%':         process.env.FIREBASE_PROJECT_ID,
  '%%FIREBASE_STORAGE_BUCKET%%':     process.env.FIREBASE_STORAGE_BUCKET,
  '%%FIREBASE_MESSAGING_SENDER_ID%%':process.env.FIREBASE_MESSAGING_SENDER_ID,
  '%%FIREBASE_APP_ID%%':             process.env.FIREBASE_APP_ID,
};

// Valida se todas as variáveis estão definidas
const missing = Object.entries(ENV_MAP)
  .filter(([, val]) => !val)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error('❌ Variáveis de ambiente ausentes no Netlify:');
  missing.forEach(m => console.error('  -', m));
  console.error('\nDefina-as em: Netlify → Site settings → Environment variables');
  process.exit(1);
}

// Lê o template
let content = fs.readFileSync(INPUT, 'utf8');

// Substitui os placeholders pelos valores reais
let count = 0;
for (const [placeholder, value] of Object.entries(ENV_MAP)) {
  if (content.includes(placeholder)) {
    content = content.replaceAll(placeholder, value);
    console.log(`✅ ${placeholder} → injetado`);
    count++;
  }
}

// Copia os assets estáticos para dist/
const STATIC_DIRS  = ['css', 'js', 'icons'];
const STATIC_FILES = ['manifest.json', 'sw.js'];

if (!fs.existsSync('dist')) fs.mkdirSync('dist');

STATIC_FILES.forEach(f => {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join('dist', f));
    console.log(`📄 Copiado: ${f}`);
  }
});

STATIC_DIRS.forEach(dir => {
  if (fs.existsSync(dir)) {
    copyDirSync(dir, path.join('dist', dir));
    console.log(`📁 Copiado: ${dir}/`);
  }
});

// Salva o index.html processado
fs.writeFileSync(OUTPUT, content, 'utf8');
console.log(`\n🚀 Build concluído! ${count} variáveis injetadas.`);
console.log(`📦 Saída: dist/`);

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src).forEach(item => {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  });
}
