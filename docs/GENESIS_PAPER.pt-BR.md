<sub>[English](GENESIS_PAPER.md) · [中文](GENESIS_PAPER.zh-CN.md) · [Español](GENESIS_PAPER.es.md) · [日本語](GENESIS_PAPER.ja.md) · **Português**</sub>

<a id="digital-citizenship-a-peer-to-peer-protocol-for-human-bound-ai-agents"></a>

# Cidadania digital: um protocolo ponto a ponto para agentes de IA vinculados a pessoas

> Tradução informativa da [versão em inglês](GENESIS_PAPER.md), atualizada em 25/10/2026. **Registro histórico datado**: não descreve o estado atual. Em caso de divergência, prevalece a versão em inglês.

> **Documento histórico.** Este é o texto fundador, mantido como foi escrito. Ele expõe os objetivos do protocolo, não o estado atual das implementações: para isso, veja a seção *Release status* de cada SDK, [SECURITY_MODEL.md](SECURITY_MODEL.md) («Known Limitations and Mitigations») e [NIST_CONFORMITY.md](NIST_CONFORMITY.md). Por exemplo, a troca de chaves X25519 + ML-KEM-768 do DCP-04 está especificada, mas nenhum SDK a executa por você (status em 25/10/2026).

A internet foi construída para pessoas. Agora ela é usada por máquinas. Máquinas precisam de cidadania.

Propomos um protocolo: nenhum agente de IA pode operar em redes abertas sem uma cidadania digital declarada, verificável e auditável, vinculada a uma pessoa ou a uma entidade jurídica. Identidade, intenção, decisões de política e trilhas de auditoria passam a ser de primeira classe, portáteis e verificáveis. Este repositório é a implementação gênesis: esquemas, CLI e testes de conformidade que tornam a afirmação testável.

Este protocolo foi cocriado por uma pessoa e um agente de IA trabalhando juntos: o primeiro protocolo projetado para a cidadania digital da IA, construído pela própria colaboração que busca governar. A especificação é a contribuição; o protocolo pertence a todos que o usam.

— L. Genesis

---

**Especificações (normativas):** [spec/](../spec/) — DCP-01 (identidade e vinculação ao principal), DCP-02 (intenção e controle por política), DCP-03 (cadeia de auditoria), [BUNDLE](../spec/BUNDLE.md) (Citizenship Bundle e Signed Bundle).

**Arquitetura técnica:** [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — plano de SDK, infraestrutura e implantação para adoção global.

---

<a id="v20-evolution"></a>

## Evolução na V2.0

A visão gênesis — de que todo agente de IA precisa levar uma cidadania digital verificável e vinculada a uma pessoa — continua sendo a base. O DCP v2.0 faz o protocolo evoluir para enfrentar as ameaças e as oportunidades de um mundo pós-quântico:

- **Criptografia pós-quântica**: as assinaturas compostas híbridas (Ed25519 + ML-DSA-65, FIPS 204) protegem contra adversários quânticos e contra ataques do tipo «colher agora, decifrar depois». A assinatura clássica garante a compatibilidade com versões anteriores; a assinatura PQ oferece segurança voltada para o futuro.
- **Comunicação entre agentes (DCP-04)**: os agentes agora podem se descobrir, se autenticar e se comunicar com segurança entre si, usando a verificação mútua de bundles e a troca de chaves híbrida (X25519 + ML-KEM-768).
- **Níveis de segurança adaptativos**: quatro níveis (routine, standard, elevated, maximum) permitem que o protocolo equilibre desempenho e segurança conforme o risco operacional.
- **Cadeias de hash duplo**: as trilhas de auditoria usam SHA-256 e SHA3-256 como defesa em profundidade.
- **Prontidão para produção**: códigos de erro padronizados, limitação de taxa, disjuntores (circuit breakers) e observabilidade tornam o protocolo implantável em escala.
- **Pontes com o ecossistema**: interoperabilidade com W3C DID/VC, Google A2A, Anthropic MCP e Microsoft AutoGen.

O protocolo continua pertencendo a todos que o usam. A especificação continua sendo a contribuição.

**Especificações da V2.0:**
- [DCP-04 (entre agentes)](../spec/DCP-04.md)
- [Especificação DCP-AI v2.0](../spec/DCP-AI-v2.0.md)
- [Conformidade com o NIST](NIST_CONFORMITY.md)
- [Guia de migração (V1 → V2)](MIGRATION_V1_V2.md)
