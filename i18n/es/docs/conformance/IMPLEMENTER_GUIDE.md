<sub>[English](../../../../docs/conformance/IMPLEMENTER_GUIDE.md) · [中文](../../../zh-CN/docs/conformance/IMPLEMENTER_GUIDE.md) · **Español** · [日本語](../../../ja/docs/conformance/IMPLEMENTER_GUIDE.md) · [Português](../../../pt-BR/docs/conformance/IMPLEMENTER_GUIDE.md)</sub>

<a id="independent-implementation-and-review-guide"></a>

# Guía de implementación y revisión independientes

> Traducción informativa de [la versión en inglés](../../../../docs/conformance/IMPLEMENTER_GUIDE.md), actualizada el 31/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

DCP es un protocolo que se puede implementar de forma independiente. Esta guía prepara a implementadores y revisores para evaluar la misma evidencia sin adoptar las aplicaciones ni los servicios del repositorio. No constituye una auditoría, certificación ni recomendación.

<a id="establish-the-boundary-first"></a>

## Establecer primero el alcance

Lee la [descripción del núcleo](../../spec/core/dcp-core.md) y después los documentos normativos aplicables:

1. [Lista de verificación de V1 y V2](../../spec/VERIFICATION.md).
2. [Perfil de canonicalización](../../spec/CANONICALIZATION_PROFILE.md).
3. [Especificación normativa de V2](../../spec/DCP-AI-v2.0.md), incluidos los algoritmos, el vínculo entre componentes de la firma compuesta y la política del verificador.
4. [Perfil de admisión](../../spec/profiles/admission/README.md), si se implementa confianza en el principal o `strict-v1`.
5. Los archivos aplicables de [esquemas V2](../../../../schemas/v2/) y las erratas citadas en la especificación.

La división entre núcleo y perfiles organiza la especificación; no exime a una implementación V2 de sus comprobaciones obligatorias. Las aplicaciones, las fuentes de red, las cachés y los handlers protegidos pertenecen a las integraciones. Mantén sus garantías de aplicación de las reglas separadas de la verificación del núcleo.

La especificación es la autoridad. Rust/WASM y los demás SDK son referencias de implementación, no definiciones normativas alternativas. Puede ser adecuado reutilizar una biblioteca de referencia, pero declara esa dependencia en vez de presentar el resultado como una implementación independiente de su lógica de verificación.

<a id="freeze-a-reproducible-input-set"></a>

## Fijar un conjunto de entradas reproducible

Usa una revisión del repositorio que haya sido revisada. Registra su ID completo de commit y si el árbol de trabajo está modificado. Conserva juntos los esquemas, fixtures, catálogos y fuentes del ejecutor de esa revisión. Registra la versión de tu implementación, la ruta de código resuelta o el hash del artefacto, el runtime, las herramientas de compilación, la política y el instante de verificación.

Los hashes de catálogos y fixtures identifican bytes; no autentican a quien los suministró. Obtén la revisión de una fuente en la que confíes. El nombre y la versión de un wrapper son autodeclarados: verifica de forma independiente qué ejecutable o paquete se ejecutó.

El kit público requiere Node 20 o posterior. Una implementación externa puede usar cualquier lenguaje; solo necesita implementar el contrato seleccionado de entrada y salida estándar. Compilar los wrappers del repositorio también requiere las herramientas y dependencias documentadas de los SDK. Las instrucciones de compilación y las comprobaciones de procedencia están en el [README del kit](../../tools/conformance/README.md).

<a id="run-the-relevant-interfaces"></a>

## Ejecutar las interfaces pertinentes

Desde la raíz del repositorio, inspecciona primero los casos disponibles:

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog admission --list
```

Después indica el ejecutable y sus argumentos tras `--`. Sustituye `/path/to/implementation` por tu comando real:

```bash
node tools/conformance-external.js --report /tmp/dcp-primitives.json -- /path/to/implementation
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/dcp-evidence.json -- /path/to/implementation
node tools/conformance-external.js --catalog admission --report /tmp/dcp-admission.json -- /path/to/implementation
```

Estos comandos seleccionan tres contratos diferentes del ejecutor. Una implementación puede admitir un subconjunto, pero su informe debe identificarlo. WASM no tiene API de admisión en este repositorio. No informes una operación no admitida como exitosa.

El comando de evidencia selecciona explícitamente `--assessment verdict`: evalúa los veredictos normativos y conserva por separado el texto de diagnóstico. La evaluación histórica sigue disponible y mantiene su valor predeterminado. Que coincida un mensaje de diagnóstico no demuestra por sí solo la comprobación prevista.

La solicitud contiene IDs de casos y entradas de operaciones, no resultados esperados. Devuelve exactamente el sobre de respuesta y los campos obligatorios del contrato, con la misma identidad de ejecución y un resultado por cada caso solicitado. Envía los logs a stderr. Una respuesta seguida de una salida fallida del proceso no es una ejecución exitosa.

El [contrato del kit](../../tools/conformance/README.md) define las reglas exactas de codificación, los límites, los códigos de salida y la estructura del informe. No deduzcas un protocolo de intercambio nuevo a partir de esta guía.

Para el diagnóstico explícito de esquemas, sustituye `--catalog evidence` en el comando de evidencia por `--catalog tools/conformance/external-schema-catalog.json`. Usa el mismo contrato `/2` y conserva los fallos normativos como fallos; está separado del catálogo de evidencia predeterminado. Consulta el mapa de cobertura antes de interpretar el resultado de una API SDK aislada.

<a id="inspect-a-generated-report"></a>

### Inspeccionar un informe generado

El README del kit incluye un [intercambio mínimo de solicitud y respuesta](../../tools/conformance/README.md#external-implementations) y ejemplos ejecutables de wrappers en [TypeScript](../../../../tools/conformance/wrappers/ts-sdk.mjs) y [Python](../../../../tools/conformance/wrappers/python_sdk.py). Empieza por el intercambio de digest para comprobar el contrato de transporte antes de implementar la verificación de bundles. Reutilizar estos wrappers no hace independiente la lógica de verificación de sus SDK.

Después de ejecutar el comando de evidencia anterior, inspecciona el informe real en vez de copiar un ejemplo exitoso:

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

Esto imprime valores de tu ejecución; no valida el informe ni autentica la implementación. Contrástalos con el estado de salida del comando, el intervalo de tu ejecución y los bytes fijados de catálogo y fixtures. Registra también las versiones exactas instaladas de las herramientas, además de sus requisitos mínimos; el README del kit indica los requisitos para compilar los wrappers nativos.

<a id="interpret-a-result-honestly"></a>

## Interpretar los resultados con rigor

Inspecciona juntos el estado de salida del proceso y el informe. Confirma que el informe pertenece a esta ejecución, que su estado global es satisfactorio, que se ejecutaron todos los casos seleccionados y que no se omitió ninguna implementación obligatoria. No bastan un informe antiguo, resultados parciales ni el acuerdo entre varias implementaciones defectuosas.

Lee el [mapa de cobertura de seguridad](SECURITY_COVERAGE.md) antes de afirmar compatibilidad. Validación de esquemas, verificación criptográfica, confianza en el principal y admisión son capas distintas. En particular, el resultado aislado de un verificador SDK no acredita por sí solo la validación completa de los esquemas V2.

Los casos negativos necesitan controles positivos que funcionen. Si un payload modificado tiene una firma inválida además de un defecto semántico, su rechazo no aísla la comprobación semántica. Conserva los bytes de entrada al reproducir discrepancias de parsing o canonicalización: analizarlos y reescribirlos puede eliminar la causa.

Cuando las implementaciones discrepen:

1. Reproduce los mismos bytes, instante y política con un control válido.
2. Distingue un veredicto del protocolo de una caída del proceso, un resultado ausente o un tiempo agotado.
3. Reduce el caso conservando el fallo pertinente y el control.
4. Cita el requisito normativo exacto. Si la especificación no lo resuelve, informa una pregunta abierta en vez de elegir el veredicto mayoritario.
5. Añade una regresión solo cuando exista una base defendible para el comportamiento esperado.

<a id="prepare-an-independent-security-review"></a>

## Preparar una revisión de seguridad independiente

Un paquete útil para la revisión contiene la revisión fijada, el [modelo de seguridad](../SECURITY_MODEL.md), el mapa de cobertura, los contratos seleccionados, los comandos exactos, los hashes de entradas y salidas y las preguntas sin resolver. Indica a qué implementación y API pública corresponde cada afirmación.

Una revisión del núcleo puede abarcar canonicalización, vínculos entre manifiesto y artefactos, política de firmas, validación de esquemas, confianza en el principal, admisión y fiabilidad de las herramientas de prueba. Revisa las dependencias criptográficas y sus versiones como parte de la exposición de la cadena de suministro; las pruebas con respuestas conocidas aportan evidencia, pero no son una auditoría de esas bibliotecas. Si un encargo excluye sus implementaciones criptográficas internas, documenta esa exclusión expresamente.

El transporte, la custodia de claves, las fuentes remotas de confianza y revocación, las cachés, el aislamiento entre tenants, la autorización de aplicaciones y los controles del despliegue requieren su propio alcance. Probar funciones del núcleo no demuestra esas propiedades.

No aportes claves privadas, credenciales de producción, registros personales ni logs confidenciales como fixtures. Usa material sintético público. Sigue el [proceso de notificación de seguridad](../../SECURITY.md) del repositorio para las vulnerabilidades; un corpus público de pruebas no sustituye la divulgación coordinada.

<a id="report-implementation-experience"></a>

## Informar la experiencia de implementación

Un informe reproducible de implementación debe indicar:

- La revisión de la especificación, las versiones de intercambio admitidas y los perfiles seleccionados expresamente.
- Qué código de implementación criptográfica o de SDK se reutiliza.
- Las suites exactas, el modo de evaluación, el comando, la versión de implementación y la identidad del informe.
- La política y el instante registrados, los controles positivos, las funciones omitidas o no admitidas y los huecos conocidos.
- Discrepancias mínimas vinculadas al texto normativo, sin secretos.

El [programa de adopción temprana](../EARLY_ADOPTERS.md) describe cómo los mantenedores recogen comentarios sobre integraciones. Esta guía prepara ese trabajo; no afirma que un implementador externo haya revisado o adoptado DCP.
