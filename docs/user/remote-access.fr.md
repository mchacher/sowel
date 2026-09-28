# Accès distant

Sowel peut être consulté de manière sécurisée depuis l'extérieur de votre réseau domestique grâce à un **Cloudflare Tunnel**. Cette approche ne nécessite aucune redirection de port et n'expose pas votre réseau local.

## Comment ça marche

```
Your phone/laptop (HTTPS)
  --> Cloudflare Edge (SSL termination, DDoS protection)
    --> Cloudflare Tunnel (outbound connection from your server)
      --> localhost:3000 (Sowel backend serving API + UI)
```

Le Cloudflare Tunnel crée une connexion **sortante** depuis votre serveur domestique vers le réseau edge de Cloudflare. Cela signifie :

- Aucun port entrant à ouvrir sur votre routeur
- Tout le trafic est chiffré en HTTPS
- Cloudflare fournit une protection anti-DDoS
- Le plan Cloudflare gratuit (Zero Trust) suffit

## Prérequis

- Un **compte Cloudflare** (le plan gratuit fonctionne)
- Un **nom de domaine** géré par le DNS Cloudflare (vous pouvez en enregistrer un via Cloudflare ou transférer un domaine existant)
- **cloudflared** installé sur la machine qui exécute Sowel

## Mise en place

### Étape 1 : installer cloudflared

Sur macOS :

```bash
brew install cloudflared
```

Sur Linux (Debian/Ubuntu) :

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### Étape 2 : s'authentifier auprès de Cloudflare

```bash
cloudflared tunnel login
```

Cela ouvre une fenêtre de navigateur où vous autorisez cloudflared à accéder à votre compte Cloudflare.

### Étape 3 : créer un tunnel

```bash
cloudflared tunnel create sowel
```

Cela crée un tunnel et génère un fichier d'identifiants.

### Étape 4 : configurer le tunnel

Créez un fichier de configuration dans `~/.cloudflared/config.yml` :

```yaml
tunnel: sowel
credentials-file: /path/to/credentials.json

ingress:
  - hostname: app.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Remplacez `app.yourdomain.com` par votre sous-domaine réel et mettez à jour le chemin du fichier d'identifiants.

### Étape 5 : créer les enregistrements DNS

```bash
cloudflared tunnel route dns sowel app.yourdomain.com
```

Cela crée un enregistrement CNAME dans le DNS Cloudflare pointant votre sous-domaine vers le tunnel.

### Étape 6 : lancer le tunnel

Pour tester :

```bash
cloudflared tunnel run sowel
```

En production, installez-le comme service système :

```bash
sudo cloudflared service install
```

Cela crée un service système (LaunchDaemon sur macOS, systemd sur Linux) qui démarre le tunnel automatiquement au boot.

## Gestion

### Vérifier l'état du tunnel

Sur macOS :

```bash
sudo launchctl list | grep cloudflare
```

Sur Linux :

```bash
sudo systemctl status cloudflared
```

### Redémarrer le tunnel

Sur macOS :

```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

Sur Linux :

```bash
sudo systemctl restart cloudflared
```

### Désinstaller le tunnel

```bash
sudo cloudflared service uninstall
```

### Tableau de bord Cloudflare

Gérez votre tunnel depuis l'interface web Cloudflare :

- **Zero Trust dashboard** : [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com), statut du tunnel, politiques d'accès
- **Gestion DNS** : tableau de bord Cloudflare > votre domaine > DNS, pour vérifier les enregistrements

## Fichiers statiques de l'UI

Le backend Sowel (Fastify sur le port 3000) sert l'UI compilée depuis le répertoire `ui-dist/`. Quand vous accédez à Sowel à distance, vous utilisez cette version pré-compilée du frontend.

### Reconstruire l'UI pour l'accès distant

Si vous modifiez l'UI et voulez que les changements soient visibles à distance :

```bash
cd ui && npm run build && cp -r dist ../ui-dist
```

!!! info
Cela n'est nécessaire que lorsque le code de l'UI change. En développement local, utilisez `localhost:5173` (serveur de dev Vite) pour le hot reload. L'URL distante sert toujours la version compilée depuis `ui-dist/`.

## Accès local vs distant

| Usage               | URL                          | Notes                                 |
| ------------------- | ---------------------------- | ------------------------------------- |
| Développement local | `http://localhost:5173`      | Serveur de dev Vite avec hot reload   |
| Production locale   | `http://localhost:3000`      | Le backend sert l'UI compilée         |
| Accès distant       | `https://app.yourdomain.com` | Cloudflare Tunnel vers localhost:3000 |

## Considérations de sécurité

!!! warning
Assurez-vous d'utiliser un mot de passe fort pour votre compte admin Sowel. Toute personne disposant de l'URL distante peut atteindre votre page de connexion.

- Tout le trafic distant est chiffré (HTTPS via Cloudflare)
- L'authentification JWT intégrée à Sowel protège tous les endpoints d'API
- Envisagez d'ajouter des politiques [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) pour une couche d'authentification supplémentaire (par ex. codes uniques par email)
- Des tokens d'API peuvent être créés depuis les Réglages pour des intégrations externes nécessitant un accès programmatique
- Si vous exposez la page visiteur des [Accès partagés](shared-access.md) (`/access/`), mettez un quota de requêtes devant elle au reverse proxy (rate limit Caddy, CrowdSec) : voir [Un quota de requêtes au reverse proxy](shared-access.md#reverse-proxy-quota)
