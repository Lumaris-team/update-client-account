# Worker updater

Ce Worker redéploie directement les Workers Cloudflare configurés, sans
GitHub Actions et sans liaison entre GitHub et Cloudflare.

Pour chaque cible, il :

1. télécharge l'archive publique GitHub de la branche configurée en une seule requête ;
3. lit `wrangler.jsonc` et convertit ses bindings ;
4. bundle les dépendances npm publiques réellement importées, puis envoie les
   assets et les modules à l’API Cloudflare ;
5. crée le Worker s'il n'existe pas, ou met à jour celui qui existe ;
6. active le sous-domaine `workers.dev` du Worker ;
7. déploie immédiatement la nouvelle version.

## Configuration

Définir les secrets/variables du Worker :

- `CLOUDFLARE_ACCOUNT_TOKEN` : token API Cloudflare ayant les droits Workers nécessaires ;
- `CLOUDFLARE_ACCOUNT_ID` : compte Cloudflare par défaut ;
- `GITHUB_TOKEN` n'est pas nécessaire pour les dépôts publics. Les dépôts privés
  ne sont pas pris en charge sans authentification GitHub.

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

Le nom du Worker est la valeur `worker`, ou la clé JSON si `worker` n'est pas
spécifié. Le compte indiqué par `accountId` est prioritaire sur
`CLOUDFLARE_ACCOUNT_ID`. Les requêtes manuelles et le cron quotidien à 02:00
UTC utilisent le même déploiement direct.

## Workers internes (service bindings)

Certains Workers ne sont pas exposés publiquement : ils ne servent qu'à être
appelés par d'autres Workers du compte via un **service binding** déclaré dans
le `wrangler.jsonc` du consommateur, ex. :

```jsonc
"services": [{ "binding": "ED_CLIENT", "service": "ed-client-worker" }]
```

| Worker | Rôle | Binding côté consommateurs |
|---|---|---|
| `ed-client-worker` | API ÉcoleDirecte interne (login, QCM 2FA, notes, devoirs, emploi du temps) | `ED_CLIENT` |

Pour déployer `ed-client-worker`, ajouter son dépôt à `CONFIGURATION` :

```json
{
  "ed-client-worker": "https://github.com/organisation/ed_client_worker",
  "main-client-worker": "https://github.com/organisation/main-client-worker"
}
```

La valeur `service` du binding doit correspondre au **nom du Worker déployé**
(la clé JSON ou le champ `worker`). Les secrets `ED_USERNAME` / `ED_PASSWORD`
ne sont **pas** gérés par l'updater : ils se définissent directement sur
`ed-client-worker` (`wrangler secret put` ou dashboard → Variables) et sont
conservés entre déploiements grâce aux bindings `inherit`.

## Limites du Worker Free

Le déploiement est volontairement borné à 100 fichiers et 5 MiB par fichier.
Cela évite de dépasser rapidement les limites de sous-requêtes et de mémoire
d'un Worker Free. Pour un dépôt plus important, il faut réduire les fichiers
déployés ou utiliser un pipeline externe.

Les bases D1 et Workflows référencés dans `wrangler.jsonc` doivent déjà exister
dans le compte Cloudflare cible. Pour une base D1 déclarée avec un
`database_name` et un identifiant placeholder `__D1_ID_*__`, l'updater récupère
automatiquement l'ID correspondant dans le compte cible. Les dépendances npm sont téléchargées depuis esm.sh pendant le déploiement
pour remplacer les imports bare que l'API Workers ne peut pas résoudre seule.
Les secrets ne sont jamais lus
depuis GitHub : ils doivent être fournis séparément comme bindings Cloudflare.

Les routes personnalisées de domaine ne sont pas créées par cet updater. Il
active le sous-domaine `workers.dev` du compte via l'API Cloudflare et renvoie
l'URL dans `workersDevUrl`, au format
`<worker>.<account-subdomain>.workers.dev`.

Exemple de déclenchement manuel :

```bash
curl -X POST https://<worker>.workers.dev/api/update-workers
```

Le token Cloudflare n'est jamais renvoyé dans les réponses. La route doit
être protégée par Cloudflare Access ou une règle de pare-feu si elle est
exposée sur Internet.
