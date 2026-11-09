<sub>[English](../../../cli/README.md) · [中文](../../zh-CN/cli/README.md) · [Español](../../es/cli/README.md) · [日本語](../../ja/cli/README.md) · **Português**</sub>

# @dcp-ai/cli

> Tradução informativa da [versão em inglês](../../../cli/README.md), atualizada em 09/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Ferramenta de linha de comando do Digital Citizenship Protocol para agentes de IA (DCP-AI). `dcp-ai verify` verifica as assinaturas e a estrutura de um arquivo de bundle, e `dcp-init` prepara um diretório para um agente. Requer Node.js 18 ou posterior.

<a id="installation"></a>

## Instalação

```bash
npm install -g @dcp-ai/cli@^2.2.0
dcp-ai --version
```

A versão 2.2.0 requer `@dcp-ai/sdk` `^2.4.0`, que o npm instala junto. Para as versões disponíveis no registro, veja [Versões publicadas](../../../docs/README.md#published-versions).

<a id="commands"></a>

## Comandos

| Comando | O que faz |
|---|---|
| `dcp-ai verify <bundle.json>` | Verifica um arquivo de bundle: um bundle V2 com o verificador V2 normativo de `@dcp-ai/sdk`, um arquivo V1 com a assinatura Ed25519 dele sobre o bundle canônico |
| `dcp-ai init` | Executa o assistente `dcp-init` no diretório atual |
| `dcp-ai status` | Mostra a configuração encontrada em `.dcp/` |
| `dcp-ai sign <bundle.json>` | Assina um bundle com as chaves de `.dcp/` |
| `dcp-ai info` | Mostra a versão do protocolo e as capacidades |
| `dcp-ai --version` | Imprime a versão da CLI e a do protocolo |

<a id="verification-and-exit-codes"></a>

## Verificação e códigos de saída

`dcp-ai verify` sai com 0 quando o bundle é VALID. Sai com 1 quando o bundle é INVALID, quando o arquivo não pode ser lido ou analisado, e para o envelope V2 pré-normativo. Procura um diretório `.dcp/` no diretório atual e depois em cada diretório acima: uma chave em `.dcp/keys/ed25519_public.key` fixa o signatário esperado, e sem ela as chaves vêm do próprio bundle.

VALID é um resultado apenas sobre assinaturas e estrutura. Não estabelece que o principal seja confiável, não é uma decisão de admissão com um conjunto de confiança ou um perfil, e não autoriza nenhuma ação; essas são etapas separadas da aplicação (veja [ADMISSION.md](../docs/ADMISSION.md)).

<a id="ed25519-p-ed-1-in-220"></a>

## Ed25519 P-ED-1 na 2.2.0

`dcp-ai verify` rejeita uma assinatura Ed25519 cuja chave pública ou R não seja uma codificação canônica, ou seja um ponto de ordem divisora de 8, além de uma com S ≥ L: imprime INVALID e sai com 1. Mantenha a evidência que falha como está; assine de novo com a mesma chave quando ela cumprir P-ED-1, faça a rotação de uma chave pública não canônica e substitua uma chave de ordem pequena. Veja o [changelog](../../../CHANGELOG.md#unreleased) e o [perfil criptográfico](../spec/profiles/crypto/README.md).

<a id="limits"></a>

## Limites

- A CLI não executa admissão, cadeias de mandatos nem ativação, e não autoriza nenhuma ação.
- `dcp-ai init` e `dcp-ai sign` guardam chaves privadas em `.dcp/` do diretório atual. Mantenha esse diretório fora do controle de versão e longe de locais compartilhados.
- [TESTING.md](TESTING.md) explica como o repositório testa a CLI contra o SDK compilado do mesmo checkout.
