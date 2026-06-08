# 🏃 PaceRun PWA

Aplicativo de corrida e caminhada — PWA instalável via link, sem App Store.

---

## 🚀 Deploy no GitHub Pages

### 1. Crie o repositório
```bash
# Crie um repositório público no GitHub chamado: pacerun
# Ex: github.com/SEU_USUARIO/pacerun
```

### 2. Clone e suba os arquivos
```bash
git clone https://github.com/SEU_USUARIO/pacerun.git
cd pacerun
# Copie todos os arquivos deste projeto para a pasta
git add .
git commit -m "🏃 PaceRun - primeiro deploy"
git push origin main
```

### 3. Ative o GitHub Pages
- Repositório → Settings → Pages
- Source: `Deploy from a branch`
- Branch: `main` / `/ (root)`
- Salve → Aguarde ~2 minutos

Seu app estará em: `https://SEU_USUARIO.github.io/pacerun`

---

## 🔥 Configuração Firebase (OBRIGATÓRIO)

### Passo 1 — Crie o projeto
1. Acesse https://console.firebase.google.com
2. Clique em **"Adicionar projeto"**
3. Nome: `pacerun` → Continue → Desative Google Analytics → Criar

### Passo 2 — Adicione o app Web
1. No painel do projeto, clique no ícone **</>** (Web)
2. Nome: `PaceRun` → Registrar app
3. **Copie o objeto `firebaseConfig`**

### Passo 3 — Cole no index.html
Abra `index.html` e substitua na linha indicada:
```javascript
const firebaseConfig = {
  apiKey: "SUA_API_KEY_AQUI",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO_ID",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};
```

### Passo 4 — Ative os serviços Firebase

#### Authentication
1. Firebase Console → Authentication → Começar
2. Sign-in providers → **E-mail/senha** → Ativar → Salvar
3. Templates → Verification email → Personalize com o nome "PaceRun"

#### Firestore Database
1. Firebase Console → Firestore Database → Criar banco de dados
2. Modo: **Produção** → Localização: `southamerica-east1` (São Paulo) → Criar

3. Regras de segurança — cole em **Rules**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Usuários: leitura pública, escrita apenas do próprio
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    // Atividades: leitura pública, escrita apenas do próprio
    match /activities/{actId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
  }
}
```

#### Índices Firestore (necessário para queries)
Vá em **Firestore → Indexes → Composite** e crie:
| Collection | Field 1 | Field 2 | Order |
|---|---|---|---|
| `activities` | `userId` ASC | `timestamp` DESC | — |
| `activities` | `distance` DESC | — | — |
| `activities` | `avgSpeed` DESC | — | — |
| `users` | `totalDistance` DESC | — | — |

Ou simplesmente execute o app — o Firestore vai sugerir os índices automaticamente com um link direto no console do browser.

#### Storage (para fotos de perfil e atividades)
1. Firebase Console → Storage → Começar
2. Modo segurança: Produção
3. Localização: `southamerica-east1`

4. Regras — cole em **Rules**:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatars/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
    match /activities/{userId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

---

## 📱 Instalar no iPhone (iOS)

1. Abra o link do app no **Safari** (obrigatório, não Chrome)
2. Toque no ícone de **Compartilhar** (quadrado com seta ↑)
3. Role para baixo → **"Adicionar à Tela de Início"**
4. Toque em **"Adicionar"**
5. O ícone aparece na tela inicial como um app nativo!

## 📱 Instalar no Android

1. Abra o link no **Chrome**
2. Toque no menu **⋮** (três pontos)
3. Selecione **"Adicionar à tela inicial"**
4. Confirme → instalado!

---

## 🗂️ Estrutura do Projeto

```
pacerun/
├── index.html          ← App completo (HTML + estrutura)
├── manifest.json       ← Configuração PWA
├── sw.js               ← Service Worker (cache offline)
├── css/
│   └── app.css         ← Todo o design system
├── js/
│   └── app.js          ← Toda a lógica (Firebase, GPS, etc.)
├── icons/
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png     ← Ícone principal
│   ├── icon-384.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
└── generate_icons.py   ← Script para regenerar ícones
```

---

## 💡 Variáveis de Ambiente (opcional)

Para não expor a API key no código, você pode usar GitHub Secrets + Actions
para injetar as variáveis em tempo de build. Mas para uso pessoal/familiar,
a abordagem direta no código é segura se as regras do Firebase estiverem corretas.

---

## 📋 Funcionalidades

- ✅ Cadastro e login com e-mail/senha
- ✅ Verificação de e-mail automática
- ✅ Rastreamento GPS em tempo real
- ✅ Mapa da rota ao vivo (OpenStreetMap/Leaflet)
- ✅ Distância, duração, ritmo, calorias, velocidade
- ✅ Histórico completo de atividades
- ✅ Feed de notícias gerado por IA (Anthropic Claude)
- ✅ Comunidade — lista de usuários com totais
- ✅ Ranking por distância e pace
- ✅ Progresso pessoal com totais acumulados
- ✅ Compartilhamento (WhatsApp, Instagram, Facebook, nativo)
- ✅ Foto de perfil e foto por atividade
- ✅ PWA instalável sem App Store
- ✅ Funciona offline (cache de assets)
- ✅ Design responsivo mobile-first
- ✅ Dark theme com cores azul/branco

---

## 🔑 Anthropic API Key (Feed IA)

O Feed usa a API do Claude. Ela é injetada automaticamente quando o app
roda dentro do Claude.ai. Para deploy independente, você precisará de uma
chave própria e adicionar ao header das requisições:

```javascript
headers: {
  'Content-Type': 'application/json',
  'x-api-key': 'SUA_ANTHROPIC_KEY',
  'anthropic-version': '2023-06-01'
}
```

---

Feito com ❤️ — PaceRun
