<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="crypto-profile"></a>

# Perfil Crypto

> Traducción informativa de [la especificación en inglés](README.md), actualizada el 28/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Publicado — v2.0  
**Alcance:** Selección de algoritmos criptográficos, firmas compuestas, agilidad criptográfica y política de verificador  

---

<a id="purpose"></a>

## Propósito

El núcleo de DCP exige firmas criptográficas y funciones hash, pero deliberadamente no impone algoritmos concretos. El perfil Crypto define las elecciones criptográficas concretas usadas en DCP v2.0 y los mecanismos para hacerlas evolucionar con el tiempo.

Esta separación garantiza que:

- El protocolo del núcleo sobrevive a las transiciones de algoritmos (p. ej., la migración poscuántica) sin cambios estructurales
- Los verificadores pueden aplicar sus propias políticas de algoritmos según el contexto de riesgo
- Las implementaciones pueden empezar con algoritmos clásicos y adoptar los poscuánticos cuando estén listas
- La obsolescencia de un algoritmo no rompe la especificación del núcleo

<a id="what-lives-here-not-in-core"></a>

## Qué vive aquí (no en el núcleo)

<a id="algorithm-registry"></a>

### Registro de algoritmos

El conjunto de algoritmos de firma aprobados (Ed25519, ML-DSA-65, ML-DSA-87, SLH-DSA-192f), mecanismos de encapsulación de claves (X25519, ML-KEM-768, híbrido X25519+ML-KEM-768) y algoritmos hash (SHA-256, SHA3-256, SHA-384).

> *Nota informativa (25/10/2026), no forma parte del perfil:* ningún SDK de DCP-AI implementa aún ML-DSA-87, y ninguno exporta el intercambio híbrido X25519+ML-KEM-768 ([docs/NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md)).

Véase la sección 2 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) para el registro completo.

<a id="composite-signature-binding"></a>

### Vinculación de firmas compuestas

El protocolo de vinculación `pq_over_classical`, que garantiza que no puede eliminarse ni el componente de firma clásico ni el poscuántico:

1. La firma clásica firma `context || 0x00 || payload`
2. La firma PQ firma `context || 0x00 || payload || classical_sig`

Véase la sección 5 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) para el protocolo de vinculación y el formato de intercambio.

<a id="domain-separation"></a>

### Separación de dominios

Etiquetas de contexto que impiden ataques de reenvío entre artefactos. Cada tipo de artefacto tiene una etiqueta de contexto única (p. ej., `DCP-AI.v2.AgentPassport`, `DCP-AI.v2.Intent`).

Véase la sección 4 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) para la lista completa de etiquetas.

<a id="verification-modes"></a>

### Modos de verificación

Política que decide el verificador y que determina qué componentes de firma se exigen:

- `classical_only` — solo se exigen firmas clásicas
- `hybrid_preferred` — se exige la clásica y se recomienda la PQ
- `hybrid_required` — se exigen la clásica y la PQ
- `pq_only` — solo se exigen firmas PQ (fase 3)

Véase la sección 7 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) para los modos de verificación y el formato de la política de verificador.

<a id="crypto-agility"></a>

### Agilidad criptográfica

El sistema de avisos de algoritmos, que permite a las autoridades de gobernanza declarar obsoletos o revocar algoritmos mediante avisos firmados, con una respuesta automatizada de los verificadores.

Véase la sección 13.2 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) y la carencia n.º 4 del [informe de AUDIT](../../AUDIT-v2.0-FINAL.md).

<a id="dual-hash-chains"></a>

### Cadenas de doble hash

Cadenas de hash SHA-256 y SHA3-256 paralelas para las entradas de auditoría, que dan continuidad si una familia de hash queda comprometida.

Véase la sección 10.3 de [DCP-AI v2.0](../../DCP-AI-v2.0.md).

<a id="what-stays-in-core"></a>

## Qué permanece en el núcleo

- El requisito de que los artefactos estén firmados (pero no con qué algoritmo)
- El requisito de que las entradas de auditoría estén encadenadas por hash (pero no con qué función hash)
- La estructura del bundle y el modelo de verificación
- Los conceptos `bundle_hash` y `merkle_root`

<a id="normative-references"></a>

## Referencias normativas

- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — secciones 2 (registro de algoritmos), 4 (separación de dominios), 5 (firmas compuestas), 7 (modos de verificación), 10.3 (doble hash), 13.2 (sistema de avisos)
- [Conformidad con el NIST](../../../docs/NIST_CONFORMITY.md) — conformidad con la criptografía poscuántica del NIST
- [Modelo de seguridad](../../../docs/SECURITY_MODEL.md) — modelo de amenazas y capas de protección

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- La vinculación compuesta hace detectable la eliminación solo donde el verificador la exige. El modo que cuenta es
  el efectivo que resuelve el verificador, que puede ser más estricto que el `default_mode` solicitado una vez aplicados el nivel de
  riesgo, el nivel de seguridad y la política. En los verificadores de los SDK, quitar la firma PQ y
  reetiquetar la vinculación como `classical_only` se acepta cuando el modo efectivo es `classical_only` o
  `hybrid_preferred` (con un aviso en `hybrid_preferred`), y se rechaza cuando es `hybrid_required` o `pq_only`.
  Solo puede tolerarse una firma PQ explícitamente ausente: una firma PQ presente bajo
  `pq_over_classical` e inválida se rechaza en todos los modos, y todas las demás comprobaciones siguen aplicándose.
- `pq_only` en los verificadores de los SDK sigue esperando la vinculación `pq_over_classical` con los bytes de la firma clásica
  presentes, porque la firma PQ los cubre; no acepta un bundle que lleve solo una firma PQ.
- El sistema de avisos no es automático: un verificador aplica un aviso cuando su operador lo carga y llama a las
  ayudas de avisos o ajusta la política en consecuencia.
- Los verificadores de los SDK comprueban la cadena de auditoría SHA-256 y la raíz de Merkle; desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 y Rust `dcp-ai` 2.11.1 también comprueban los campos secundarios SHA3-256 presentes (V2-11 de [VERIFICATION.md](../../VERIFICATION.md) y su errata), que las versiones anteriores no comprueban.
