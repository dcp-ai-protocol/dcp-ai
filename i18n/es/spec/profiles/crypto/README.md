<sub>[English](../../../../../spec/profiles/crypto/README.md) · [中文](../../../../zh-CN/spec/profiles/crypto/README.md) · **Español** · [日本語](../../../../ja/spec/profiles/crypto/README.md) · [Português](../../../../pt-BR/spec/profiles/crypto/README.md)</sub>

<a id="crypto-profile"></a>

# Perfil Crypto

> Traducción informativa de [la especificación en inglés](../../../../../spec/profiles/crypto/README.md), actualizada el 07/11/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

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

> *Nota informativa (25/10/2026), no forma parte del perfil:* ningún SDK de DCP-AI implementa aún ML-DSA-87, y ninguno exporta el intercambio híbrido X25519+ML-KEM-768 ([docs/NIST_CONFORMITY.md](../../../../../docs/NIST_CONFORMITY.md)).

Véase la sección 2 de [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para el registro completo.

<a id="composite-signature-binding"></a>

### Vinculación de firmas compuestas

El protocolo de vinculación `pq_over_classical`, que garantiza que no puede eliminarse ni el componente de firma clásico ni el poscuántico:

1. La firma clásica firma `context || 0x00 || payload`
2. La firma PQ firma `context || 0x00 || payload || classical_sig`

Véase la sección 5 de [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para el protocolo de vinculación y el formato de intercambio.

<a id="domain-separation"></a>

### Separación de dominios

Etiquetas de contexto que impiden ataques de reenvío entre artefactos. Cada tipo de artefacto tiene una etiqueta de contexto única (p. ej., `DCP-AI.v2.AgentPassport`, `DCP-AI.v2.Intent`).

Véase la sección 4 de [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para la lista completa de etiquetas.

<a id="verification-modes"></a>

### Modos de verificación

Política que decide el verificador y que determina qué componentes de firma se exigen:

- `classical_only` — solo se exigen firmas clásicas
- `hybrid_preferred` — se exige la clásica y se recomienda la PQ
- `hybrid_required` — se exigen la clásica y la PQ
- `pq_only` — solo se exigen firmas PQ (fase 3)

Véase la sección 7 de [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para los modos de verificación y el formato de la política de verificador.

<a id="p-ed-1-ed25519-acceptance-criterion"></a>

### P-ED-1: criterio de aceptación de Ed25519

Una firma `ed25519` `sig = R ‖ S` (64 bytes) de una clave pública `A` (32 bytes) sobre un mensaje `M` se acepta si y
solo si se cumplen las cuatro condiciones:

1. **Escalar.** S < L, leyendo S como entero little-endian de 256 bits y con L = 2^252 + 27742317777372353535851937790883648493.
2. **Codificaciones canónicas.** A y R son canónicas: con `y` los 32 bytes leídos en little-endian con el bit 255 a
   cero, `s` el bit 255 y p = 2^255 − 19, `y < p`, y no ocurre `s = 1` con `y ∈ {1, p − 1}`.
3. **Orden.** Ni A ni R son una de las 8 codificaciones de E[8], los puntos cuyo orden divide a 8 (identidad
   incluida):

   ```
   0000000000000000000000000000000000000000000000000000000000000000
   0000000000000000000000000000000000000000000000000000000000000080
   0100000000000000000000000000000000000000000000000000000000000000
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa
   ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f
   ```

4. **Decodificación y ecuación.** A y R decodifican a puntos de la curva, y [S]B = R + [k]A, sin cofactor, entre esos
   puntos, con k = SHA-512(R ‖ A ‖ M) mod L calculado sobre los bytes originales de R y A.

P-ED-1 es un criterio de DCP, no una de las opciones de RFC 8032, cuyo §5.1.7 usa el desafío sin reducir. Para A y R del
subgrupo de orden primo, su ecuación da el mismo resultado que las ecuaciones del RFC; el criterio rechaza además la
identidad y los demás puntos de E[8]. Una A o una R con componente de torsión que no sea de orden pequeño se acepta si
la ecuación se cumple: P-ED-1 no exige puntos libres de torsión.

**Implementación.** Los SDK mantienen la comprobación de la ecuación de su biblioteca (TweetNaCl, PyNaCl con libsodium,
`crypto/ed25519` de Go, `ed25519-dalek`) y comprueban las condiciones 1 a 3 sobre los bytes antes de llamarla:
comparaciones con constantes, sin aritmética de curva nueva. La biblioteca sigue asegurando que A y R son puntos
válidos y que la ecuación se cumple; algunas lo hacen para R calculando la codificación canónica de [S]B − [k]A y
comparándola con los bytes recibidos, una comprobación equivalente que no decodifica R. Una condición incumplida es un rechazo (`false`), nunca un error, y una entrada que antes daba un error (una
longitud, base64 inválido) da el mismo error; una clave pública que no decodifica sigue siendo `false` en TypeScript,
Python y Go y un error en Rust. Las comprobaciones se aplican a los objetos firmados V1 y al proveedor Ed25519 V2 por
defecto, dondequiera que se verifique un componente `ed25519`. No cambian qué componentes verifica un modo: con
`pq_only` solo se aplican donde el componente clásico se sigue verificando, como en los mandatos y acuses de DCP-09,
que verifican los dos componentes en todo modo. El registro de proveedores es del operador: P-ED-1 es el criterio de los
proveedores por defecto, no una garantía sobre uno propio.

**Compatibilidad.** Es un cambio de aceptación intencionado: se rechaza una firma con S ≥ L, con A o R no canónica, o
con A o R en E[8], también donde las bibliotecas de TypeScript, Go y Rust la aceptaban (la build oficial de PyNaCl, con
libsodium 1.0.20, ya rechazaba estas entradas, según su código y la muestra observada). Los firmantes no cambian: una
clave de su generación de claves y las firmas que producen cumplen P-ED-1, salvo un nonce con r ≡ 0 mod L, que da la
identidad como R y se rechaza sin excepción. Los formatos, los contextos, `dcp-jcs-v1`, los esquemas, el perfil
candidato experimental y las API anteriores no cambian.

**Migración.** Solo afecta a la evidencia que incumple P-ED-1. Consérvala tal cual y no normalices nunca bytes firmados:
codificar de nuevo A o R cambia k (y, en el caso de A, el `kid`), y reducir S cambia los bytes de la firma y el mensaje
del componente PQ, que firma también la firma clásica.

- S ≥ L, o R no canónica o en E[8]: firmar de nuevo con la misma clave, si esa clave cumple P-ED-1.
- A no canónica: su codificación canónica es otra clave para DCP, con otro `kid`, así que hay que rotar la clave y
  firmar de nuevo.
- A en E[8]: sustituir la clave; volver a firmar con ella no sirve.

Vectores: [`tests/interop/v2/ed25519_ped1_vectors.json`](../../../../../tests/interop/v2/ed25519_ped1_vectors.json), comprobados
por `tools/ed25519-review/check_ped1_vectors.py`. Qué verificadores aplican P-ED-1 y cuáles todavía no figura en
[SECURITY_COVERAGE.md](../../../../../docs/conformance/SECURITY_COVERAGE.md).

<a id="crypto-agility"></a>

### Agilidad criptográfica

El sistema de avisos de algoritmos, que permite a las autoridades de gobernanza declarar obsoletos o revocar algoritmos mediante avisos firmados, con una respuesta automatizada de los verificadores.

Véase la sección 13.2 de [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) y la carencia n.º 4 del [informe de AUDIT](../../../../../spec/AUDIT-v2.0-FINAL.md).

<a id="dual-hash-chains"></a>

### Cadenas de doble hash

Cadenas de hash SHA-256 y SHA3-256 paralelas para las entradas de auditoría, que dan continuidad si una familia de hash queda comprometida.

Véase la sección 10.3 de [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md).

<a id="what-stays-in-core"></a>

## Qué permanece en el núcleo

- El requisito de que los artefactos estén firmados (pero no con qué algoritmo)
- El requisito de que las entradas de auditoría estén encadenadas por hash (pero no con qué función hash)
- La estructura del bundle y el modelo de verificación
- Los conceptos `bundle_hash` y `merkle_root`

<a id="normative-references"></a>

## Referencias normativas

- [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) — secciones 2 (registro de algoritmos), 4 (separación de dominios), 5 (firmas compuestas), 7 (modos de verificación), 10.3 (doble hash), 13.2 (sistema de avisos)
- [Conformidad con el NIST](../../../../../docs/NIST_CONFORMITY.md) — conformidad con la criptografía poscuántica del NIST
- [Modelo de seguridad](../../../../../docs/SECURITY_MODEL.md) — modelo de amenazas y capas de protección

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
- Los verificadores de los SDK comprueban la cadena de auditoría SHA-256 y la raíz de Merkle; desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 y Rust `dcp-ai` 2.11.1 también comprueban los campos secundarios SHA3-256 presentes (V2-11 de [VERIFICATION.md](../../../../../spec/VERIFICATION.md) y su errata), que las versiones anteriores no comprueban.
