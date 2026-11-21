#!/usr/bin/env node
// Script pour forcer la synchronisation des secrets du worker en production
// Utilise le token OAuth wrangler existant

const { execSync } = require('child_process');
const https = require('https');

const accountId = 'b0982cefacb7dc212f610a593a8cee36';
const workerName = 'update-client-account';

// Récupérer le token OAuth depuis wrangler
let apiToken;
try {
  const config = execSync('cat /Users/danielersen/Library/Preferences/.wrangler/config/default.toml', { encoding: 'utf8' });
  const match = config.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (match) {
    apiToken = match[1];
  }
} catch (e) {
  console.error('Impossible de récupérer le token wrangler');
  process.exit(1);
}

console.log('Token OAuth récupéré, synchronisation des secrets...');

// Lister les secrets existants
function listSecrets() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Supprimer un secret
function deleteSecret(secretName) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets/${secretName}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 204 || res.statusCode === 404) {
          resolve();
        } else {
          reject(new Error(`Status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Mettre à jour un secret via PUT
function putSecret(secretName, secretValue) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      name: secretName,
      text: secretValue,
      type: 'secret_text'
    });

    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

listSecrets().then(result => {
  console.log('Secrets actuels sur le worker:', JSON.stringify(result, null, 2));
  
  if (result.result && result.result.length === 0) {
    console.log('Aucun secret attaché, suppression des secrets orphelins puis ajout...');
    
    // Supprimer d'abord pour nettoyer
    return deleteSecret('CLOUDFLARE_ACCOUNT_ID')
      .then(() => deleteSecret('CLOUDFLARE_ACCOUNT_TOKEN'))
      .then(() => new Promise(resolve => setTimeout(resolve, 1000)))
      .then(() => putSecret('CLOUDFLARE_ACCOUNT_ID', 'b0982cefacb7dc212f610a593a8cee36'))
      .then(() => putSecret('CLOUDFLARE_ACCOUNT_TOKEN', apiToken));
  } else {
    console.log('Secrets déjà attachés');
    return result;
  }
}).then(result => {
  console.log('Secrets mis à jour:', JSON.stringify(result, null, 2));
  console.log('\nRedéployez le worker avec: npx wrangler deploy');
}).catch(err => {
  console.error('Erreur:', err.message);
});
