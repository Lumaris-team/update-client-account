# Configuration des secrets du worker

Les secrets `CLOUDFLARE_ACCOUNT_ID` et `CLOUDFLARE_ACCOUNT_TOKEN` sont configurés localement mais ne sont pas synchronisés automatiquement avec le worker en production.

## Pour synchroniser les secrets une seule fois :

### Option 1: Via l'API Cloudflare (recommandé)

1. Créez un API Token dans votre dashboard Cloudflare: https://dash.cloudflare.com/profile/api-tokens
   - Permissions: Workers Scripts Write, Account Settings Read

2. Exécutez ce script:
```bash
cd /Users/danielersen/Projets/Lumaris/update-client-account
CLOUDFLARE_API_TOKEN=votre_api_token node sync-secrets.js
```

### Option 2: Via wrangler avec --secrets-file

1. Créez un fichier de secrets:
```bash
cat > .wrangler-secrets.env << EOF
CLOUDFLARE_ACCOUNT_ID=b0982cefacb7dc212f610a593a8cee36
CLOUDFLARE_ACCOUNT_TOKEN=votre_wrangler_secret_token
EOF
```

2. Déployez avec le fichier de secrets:
```bash
npx wrangler deploy --secrets-file .wrangler-secrets.env
```

## Après synchronisation

Une fois synchronisé, la requête POST fonctionnera sans envoyer de secrets dans le body:
```bash
curl -X POST https://update-client-account.danielersen-cloudflare-account.workers.dev/api/update-workers
```
