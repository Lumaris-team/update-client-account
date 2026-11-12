# Worker builder

Ce Worker vérifie les dépôts GitHub configurés et déclenche leur workflow
`deploy-worker.yml` uniquement quand le dernier commit de la branche par défaut
n'est pas encore le dernier déploiement réussi. Le code des dépôts n'est jamais
téléchargé par le Worker : GitHub Actions effectue le checkout minimal et lance
Wrangler.

## Configuration

Dans les variables d'environnement du Worker, définir `CONFIGURATION` avec des
URL GitHub HTTPS (les URL SSH sont également acceptées) :

```json
{"worker1":"https://github.com/organisation/worker1","worker2":"https://github.com/organisation/worker2"}
```

Ajouter `FULL_ACCESS_TOKEN` comme secret. Le token doit pouvoir lire les dépôts
et déclencher leurs workflows (`Contents: read` et `Actions: write` pour les
fine-grained tokens).

Chaque dépôt cible doit contenir `.github/workflows/deploy-worker.yml`. Le
workflow fourni dans ce dépôt est un modèle : il installe les dépendances puis
exécute `npx wrangler deploy`. Chaque dépôt cible doit aussi définir les secrets
`CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

Le déclenchement planifié est à **02:00 UTC**. Un déclenchement manuel est
disponible en POST sur :

```text
/api/update-workers
```

Exemple :

```bash
curl -X POST https://<worker>.workers.dev/api/update-workers
```

La route ne nécessite pas d'en-tête particulier. Elle doit donc être protégée
par Cloudflare Access ou une règle de pare-feu si elle est exposée sur Internet.
