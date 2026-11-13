# Worker updater

Ce Worker redéploie directement les Workers Cloudflare configurés, sans
GitHub Actions et sans liaison entre GitHub et Cloudflare.

Pour chaque cible, il :

1. lit le dernier commit de la branche configurée sur GitHub ;
2. télécharge l'archive GitHub en une seule requête ;
3. lit `wrangler.toml` et convertit ses bindings ;
4. envoie les assets puis le script à l'API Cloudflare ;
5. déploie immédiatement la nouvelle version.

## Configuration

Définir les secrets/variables du Worker :

- `ACCESS_TOKEN` : token API Cloudflare ayant les droits Workers nécessaires ;
- `CLOUDFLARE_ACCOUNT_ID` : compte Cloudflare par défaut ;
- `GITHUB_TOKEN` : optionnel, uniquement nécessaire pour des dépôts privés.

`CONFIGURATION` accepte une URL simple :

```json
{"main-website":"https://github.com/organisation/main-website"}
```

Ou une configuration complète :

```json
{
  "main-website": {
    "repository": "https://github.com/organisation/main-website",
    "worker": "main-website",
    "accountId": "account-id-optionnel",
    "branch": "main",
    "mainModule": "src/index.js",
    "assetsDirectory": "src/frontend"
  }
}
```

Le compte indiqué par `accountId` est prioritaire sur
`CLOUDFLARE_ACCOUNT_ID`. Les requêtes manuelles et le cron quotidien à 02:00
UTC utilisent le même déploiement direct.

## Limites du Worker Free

Le déploiement est volontairement borné à 100 fichiers et 5 MiB par fichier.
Cela évite de dépasser rapidement les limites de sous-requêtes et de mémoire
d'un Worker Free. Pour un dépôt plus important, il faut réduire les fichiers
déployés ou utiliser un pipeline externe.

Les namespaces KV, bases D1 et Workflows référencés dans `wrangler.toml` doivent
déjà exister dans le compte Cloudflare cible. Les secrets ne sont jamais lus
depuis GitHub : ils doivent être fournis séparément comme bindings Cloudflare.

Exemple de déclenchement manuel :

```bash
curl -X POST https://<worker>.workers.dev/api/update-workers
```

Le token Cloudflare n'est jamais renvoyé dans les réponses. La route doit
être protégée par Cloudflare Access ou une règle de pare-feu si elle est
exposée sur Internet.
