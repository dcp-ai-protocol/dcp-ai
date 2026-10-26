<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="canonicalization-lab"></a>

# Laboratorio de canonicalización

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Un **modelo de diseño** ejecutable del candidato no normativo `dcp-jcs-v2`, con su generador de corpus y su
ejecutor. No es un SDK, ni un verificador, ni una comprobación de conformidad: calcula SHA-256 para sus compromisos sintéticos,
pero no firma nada ni verifica ninguna firma, y `dcp-jcs-v1` sigue siendo el único perfil de canonicalización normativo y
predeterminado (las API candidatas de los SDK son experimentales y de activación explícita, véase [CI](#ci)). El
diseño, las reglas y lo que el modelo muestra y no muestra están en [`docs/proposals/canonicalization-candidate/README.md`](../../docs/proposals/canonicalization-candidate/README.md).

| Archivo | Función |
|---|---|
| `model.py` | El modelo de diseño (solo lo importa `run.py`). Su comportamiento ejecutable es el del modelo aprobado; los docstrings aclaran las rutas públicas y la regla supuesta del último duplicado |
| `generate_corpus.py` | Escribe `docs/proposals/canonicalization-candidate/corpus.json`; las expectativas se escriben a mano y nunca importa el modelo |
| `run.py` | Comprobaciones de integridad, frescura, validez y cobertura, los 274 casos y 24 controles negativos |

Python 3.9 o posterior en Linux o macOS (Windows no está admitido), solo con la biblioteca estándar. Los comandos se ejecutan
desde la raíz de un checkout; desde cualquier otro directorio, da a los scripts sus rutas absolutas. Las salidas van a un
directorio temporal nuevo; el ejecutor también rechaza una ruta de salida existente.

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

## CI

[`.github/workflows/canonicalization-lab.yml`](../../.github/workflows/canonicalization-lab.yml) ejecuta los mismos
comandos en Ubuntu con Python 3.9 (el mínimo documentado) y 3.12, solo con la biblioteca estándar, en los push a
`main` y en los pull requests que cambian el workflow, este directorio o
`docs/proposals/canonicalization-candidate/`. Cada job escribe en un directorio temporal nuevo, regenera el
corpus y lo compara byte a byte, ejecuta los 274 casos y los 24 controles negativos, y comprueba ambos
recuentos; cualquier fallo hace fallar el job.

Comprueba solo el **modelo de diseño**. No es conformidad de los SDK: las API candidatas de activación explícita de los SDK
se prueban con sus propias suites y con la [matriz de la fase 4](../../tests/interop/candidate/phase4/README.md); ningún
perfil ni ningún verificador predeterminado ejecuta el candidato, y `dcp-jcs-v1` no cambia. Una ejecución en verde dice que el
modelo, el corpus y sus expectativas coinciden; no dice nada de ninguna implementación.


Las API opt-in de TypeScript y WASM están disponibles en `@dcp-ai/sdk` 2.2.0 y `@dcp-ai/wasm` 2.1.0; los demás SDK tienen publicaciones independientes.
