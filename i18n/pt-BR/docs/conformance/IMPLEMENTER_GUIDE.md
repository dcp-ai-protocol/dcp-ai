<sub>[English](../../../../docs/conformance/IMPLEMENTER_GUIDE.md) · [中文](../../../zh-CN/docs/conformance/IMPLEMENTER_GUIDE.md) · [Español](../../../es/docs/conformance/IMPLEMENTER_GUIDE.md) · [日本語](../../../ja/docs/conformance/IMPLEMENTER_GUIDE.md) · **Português**</sub>

<a id="independent-implementation-and-review-guide"></a>

# Guia de implementação e revisão independentes

> Tradução informativa da [versão em inglês](../../../../docs/conformance/IMPLEMENTER_GUIDE.md), atualizada em 31/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

DCP é um protocolo que pode ser implementado de forma independente. Este guia prepara implementadores e revisores para avaliar as mesmas evidências sem adotar os aplicativos ou serviços do repositório. Não constitui auditoria, certificação ou endosso.

<a id="establish-the-boundary-first"></a>

## Defina primeiro o escopo

Leia a [visão geral do núcleo](../../spec/core/dcp-core.md) e depois os documentos normativos aplicáveis:

1. [Lista de verificação de V1 e V2](../../spec/VERIFICATION.md).
2. [Perfil de canonicalização](../../spec/CANONICALIZATION_PROFILE.md).
3. [Especificação normativa V2](../../spec/DCP-AI-v2.0.md), incluindo algoritmos, vinculação entre componentes da assinatura composta e política do verificador.
4. [Perfil de admissão](../../spec/profiles/admission/README.md), se implementar confiança no principal ou `strict-v1`.
5. Os arquivos aplicáveis nos [esquemas V2](../../../../schemas/v2/) e as erratas citadas na especificação.

A divisão entre núcleo e perfis organiza a especificação; não isenta uma implementação V2 das verificações obrigatórias. Aplicativos, fontes de rede, caches e handlers protegidos pertencem às integrações. Mantenha as alegações sobre a aplicação de suas regras separadas da verificação do núcleo.

A especificação é a autoridade. Rust/WASM e os demais SDKs são referências de implementação, não definições normativas alternativas. Reutilizar uma biblioteca de referência pode ser apropriado, mas declare essa dependência em vez de apresentar o resultado como uma implementação independente de sua lógica de verificação.

<a id="freeze-a-reproducible-input-set"></a>

## Fixe um conjunto reproduzível de entradas

Use uma revisão do repositório que tenha sido revisada. Registre o ID completo do commit e se a árvore de trabalho foi modificada. Mantenha juntos os esquemas, fixtures, catálogos e fontes do executor dessa revisão. Registre a versão da implementação, o caminho de código resolvido ou hash do artefato, o runtime, as ferramentas de compilação, a política e o instante de verificação.

Hashes de catálogos e fixtures identificam bytes; não autenticam quem os forneceu. Obtenha a revisão de uma fonte em que confia. O nome e a versão de um wrapper são autodeclarados: verifique de forma independente qual executável ou pacote foi executado.

O kit público requer Node 20 ou posterior. Uma implementação externa pode usar qualquer linguagem; basta implementar o contrato selecionado de entrada e saída padrão. Compilar os wrappers do repositório também exige as ferramentas e dependências documentadas dos SDKs. As instruções de compilação e verificações de procedência estão no [README do kit](../../tools/conformance/README.md).

<a id="run-the-relevant-interfaces"></a>

## Execute as interfaces pertinentes

Na raiz do repositório, examine primeiro os casos disponíveis:

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog admission --list
```

Depois informe o executável e seus argumentos após `--`. Substitua `/path/to/implementation` pelo comando real:

```bash
node tools/conformance-external.js --report /tmp/dcp-primitives.json -- /path/to/implementation
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/dcp-evidence.json -- /path/to/implementation
node tools/conformance-external.js --catalog admission --report /tmp/dcp-admission.json -- /path/to/implementation
```

Esses comandos selecionam três contratos diferentes do executor. Uma implementação pode oferecer um subconjunto, mas seu relatório deve identificá-lo. WASM não tem API de admissão neste repositório. Não apresente uma operação não suportada como bem-sucedida.

O comando de evidências seleciona explicitamente `--assessment verdict`: avalia os veredictos normativos e preserva separadamente o texto de diagnóstico. A avaliação histórica continua disponível e mantém o padrão existente. A correspondência de uma mensagem de diagnóstico, por si só, não comprova a verificação pretendida.

A solicitação contém IDs de casos e entradas das operações, não resultados esperados. Retorne exatamente o envelope de resposta e os campos obrigatórios do contrato, com a mesma identidade de execução e um resultado para cada caso solicitado. Envie logs para stderr. Uma resposta seguida de saída do processo com falha não é uma execução bem-sucedida.

O [contrato do kit](../../tools/conformance/README.md) define as regras exatas de codificação, limites, códigos de saída e estrutura do relatório. Não deduza um novo protocolo de intercâmbio a partir deste guia.

Para o diagnóstico explícito de esquemas, substitua `--catalog evidence` no comando de evidências por `--catalog tools/conformance/external-schema-catalog.json`. Ele usa o mesmo contrato `/2` e mantém as falhas normativas como falhas; é separado do catálogo de evidências padrão. Consulte o mapa de cobertura antes de interpretar o resultado de uma API SDK isolada.

<a id="inspect-a-generated-report"></a>

### Inspecionar um relatório gerado

O README do kit inclui uma [troca mínima de solicitação e resposta](../../tools/conformance/README.md#external-implementations) e exemplos executáveis de wrappers em [TypeScript](../../../../tools/conformance/wrappers/ts-sdk.mjs) e [Python](../../../../tools/conformance/wrappers/python_sdk.py). Comece pela troca de digest para conferir o contrato de transporte antes de implementar a verificação de bundles. Reutilizar esses wrappers não torna independente a lógica de verificação dos seus SDKs.

Depois de executar o comando de evidência acima, inspecione o relatório real em vez de copiar um exemplo de sucesso:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync('/tmp/dcp-evidence.json', 'utf8'));
console.log(JSON.stringify({
  status: report.status,
  run_id: report.run.id,
  started_at: report.run.started_at,
  finished_at: report.run.finished_at,
  contract: report.kit.contract,
  catalog_sha256: report.kit.catalog_sha256,
  fixtures_sha256: report.kit.fixtures_sha256,
  implementation: report.implementation,
  totals: report.totals,
}, null, 2));
NODE
```

Isso imprime valores da sua execução; não valida o relatório nem autentica a implementação. Compare-os com o status de saída do comando, o intervalo da execução e os bytes fixados do catálogo e dos fixtures. Registre também as versões exatas das ferramentas instaladas, além dos requisitos mínimos; os requisitos para compilar wrappers nativos estão no README do kit.

<a id="interpret-a-result-honestly"></a>

## Interprete os resultados com rigor

Examine juntos o status de saída do processo e o relatório. Confirme que o relatório pertence à execução atual, que seu status geral é de aprovação, que todos os casos selecionados foram executados e que nenhuma implementação obrigatória foi ignorada. Um relatório antigo, resultados parciais ou o acordo entre várias implementações defeituosas não bastam.

Leia o [mapa de cobertura de segurança](SECURITY_COVERAGE.md) antes de alegar compatibilidade. Validação de esquemas, verificação criptográfica, confiança no principal e admissão são camadas distintas. Em particular, um resultado isolado do verificador SDK não comprova por si só a validação completa dos esquemas V2.

Casos negativos precisam de controles positivos que funcionem. Se um payload alterado tem uma assinatura inválida e também um defeito semântico, sua rejeição não isola a verificação semântica. Preserve os bytes de entrada ao reproduzir discrepâncias de parsing ou canonicalização: analisá-los e reescrevê-los pode remover a causa.

Quando as implementações divergirem:

1. Reproduza os mesmos bytes, instante e política com um controle válido.
2. Distinga um veredicto do protocolo de uma queda do processo, um resultado ausente ou um tempo esgotado.
3. Reduza o caso preservando a falha relevante e o controle.
4. Cite o requisito normativo exato. Se a especificação não o resolver, registre uma questão em aberto em vez de escolher o veredicto da maioria.
5. Adicione uma regressão somente quando houver uma base defensável para o comportamento esperado.

<a id="prepare-an-independent-security-review"></a>

## Prepare uma revisão de segurança independente

Um pacote útil para revisão contém a revisão fixada, o [modelo de segurança](../SECURITY_MODEL.md), o mapa de cobertura, os contratos selecionados, os comandos exatos, hashes das entradas e saídas e questões não resolvidas. Informe a qual implementação e API pública cada alegação se refere.

Uma revisão do núcleo pode abranger canonicalização, vinculação entre manifesto e artefatos, política de assinaturas, validação de esquemas, confiança no principal, admissão e confiabilidade das ferramentas de teste. Revise as dependências criptográficas e suas versões como parte da exposição da cadeia de suprimentos; testes com respostas conhecidas são evidências úteis, não uma auditoria dessas bibliotecas. Se um trabalho excluir suas implementações criptográficas internas, documente essa exclusão explicitamente.

Transporte, custódia de chaves, fontes remotas de confiança e revogação, caches, isolamento entre tenants, autorização de aplicativos e controles de implantação precisam de escopo próprio. Testar funções do núcleo não demonstra essas propriedades.

Não envie chaves privadas, credenciais de produção, registros pessoais ou logs confidenciais como fixtures. Use material sintético público. Siga o [processo de notificação de segurança](../../SECURITY.md) do repositório para vulnerabilidades; um corpus público de testes não substitui a divulgação coordenada.

<a id="report-implementation-experience"></a>

## Relate a experiência de implementação

Um relatório reproduzível de implementação deve informar:

- A revisão da especificação, as versões de intercâmbio suportadas e os perfis selecionados explicitamente.
- Qual código de implementação criptográfica ou de SDK é reutilizado.
- As suítes exatas, o modo de avaliação, o comando, a versão da implementação e a identidade do relatório.
- A política e o instante registrados, controles positivos, funcionalidades ignoradas ou não suportadas e lacunas conhecidas.
- Discrepâncias mínimas vinculadas ao texto normativo, sem segredos.

O [programa de adoção inicial](../EARLY_ADOPTERS.md) descreve como os mantenedores coletam comentários sobre integrações. Este guia prepara esse trabalho; não afirma que um implementador externo revisou ou adotou DCP.
