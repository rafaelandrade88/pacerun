# Regras Firestore — Cole no Firebase Console

## Rules (Firestore Database → Rules)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    match /activities/{actId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null
                            && resource.data.userId == request.auth.uid;
    }
  }
}
```

## Índices Compostos (Firestore → Indexes → Composite)

| Collection   | Campo 1          | Campo 2         |
|--------------|------------------|-----------------|
| activities   | userId (ASC)     | timestamp (DESC)|
| activities   | distance (DESC)  | —               |
| activities   | avgSpeed (DESC)  | —               |
| users        | totalDistance (DESC) | —           |

Dica: rode o app, vá em Progresso e Ranking.
O Firestore vai gerar links diretos no console do browser para criar os índices.
