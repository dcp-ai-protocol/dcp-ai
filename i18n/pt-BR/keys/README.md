<sub>[English](../../../keys/README.md) · [Español](../../es/keys/README.md) · **Português** · [日本語](../../ja/keys/README.md) · [中文](../../zh-CN/keys/README.md)</sub>

<a id="dcp-key-storage"></a>

# Armazenamento de chaves DCP

> Tradução informativa da [versão em inglês](../../../keys/README.md), atualizada em 25/10/2026. Em caso de diferença, prevalece o original em inglês. Identificadores e blocos de código, incluindo comentários, são mantidos sem tradução.

Este diretório armazena as chaves criptográficas usadas pelas ferramentas do protocolo DCP.

<a id="structure"></a>

## Estrutura

```
keys/
├── README.md               # This file
├── public_key.txt          # Ed25519 public key (base64) — safe to share
├── secret_key.txt          # Ed25519 secret key (base64) — NEVER commit
├── agent_public_key.txt    # Agent-specific public key (optional)
└── agent_secret_key.txt    # Agent-specific secret key (optional, NEVER commit)
```

<a id="key-generation"></a>

## Geração de chaves

`dcp` é a CLI de referência do checkout (`node bin/dcp.js`). Ela grava em `keys/` quando você não informa um diretório, e **em um checkout isso sobrescreve `keys/public_key.txt`, a chave usada para verificar os exemplos de conformidade** (`npm run conformance` e a CI a utilizam). Informe outro diretório:

```bash
# Ed25519 (V1): public_key.txt and secret_key.txt
node bin/dcp.js keygen my-keys

# Hybrid V2 (Ed25519 + ML-DSA-65): ed25519_public_key.txt, ed25519_secret_key.txt, ed25519_kid.txt,
# ml_dsa_65_public_key.txt, ml_dsa_65_secret_key.txt, ml_dsa_65_kid.txt
node bin/dcp.js keygen --hybrid my-keys
```

Os arquivos de chaves secretas são gravados com modo `0600`. Os comandos V1 recebem arquivos de chaves como argumentos (`dcp sign-bundle <bundle.json> <secret_key.txt>`, `dcp verify-bundle <bundle.signed.json> <public_key.txt>`). A chave secreta correspondente a `keys/public_key.txt` não está no repositório.

<a id="security-policy"></a>

## Política de segurança

- As **chaves privadas** (`secret_key.txt`, `*_secret*`, `*.pem`, `*.key`) são excluídas do controle de versão por meio de `.gitignore`.
- As **chaves públicas** podem ser incluídas no repositório para referência e verificação.
- Em produção, mantenha as chaves secretas em um módulo de segurança de hardware (HSM) ou em um serviço de gerenciamento de chaves, em vez de mantê-las no sistema de arquivos. Este repositório não fornece integração com HSM: essa custódia depende da sua própria infraestrutura.
- O material secreto ML-DSA-65 das chaves híbridas V2 segue a mesma política de exclusão.

<a id="key-formats"></a>

## Formatos das chaves

| Tipo de chave | Codificação | Tamanho (bytes) |
|----------|----------|-------------|
| Pública Ed25519 | Base64 | 32 |
| Secreta Ed25519 | Base64 | 64 (semente seguida da chave pública) |
| Pública ML-DSA-65 | Base64 | 1952 |
| Secreta ML-DSA-65 | Base64 | 4032 |

<a id="deterministic-key-id-kid"></a>

## Identificador determinístico de chave (kid)

As chaves V2 usam um `kid` determinístico derivado do algoritmo e dos bytes da chave pública:

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]
```

Isso garante que a mesma chave sempre produza o mesmo `kid` em todas as implementações DCP (`dcp kid <public_key_file> --alg <algorithm>` faz o cálculo).
