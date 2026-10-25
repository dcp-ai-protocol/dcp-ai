//! A private stopwatch for latency samples only. Native builds measure with `std::time::Instant`. The
//! wasm build (wasm32 with the `wasm` feature) reads JavaScript's `performance.now()`, because
//! `std::time::Instant::now()` panics on wasm32-unknown-unknown.
//!
//! In wasm, `elapsed_ms` is `None` when `performance` is missing, throws, gives anything but a finite
//! number, or goes backwards: there is no fallback to `Date.now()` (not monotonic) and no invented zero. A caller
//! then omits its latency sample and nothing else changes.

#[cfg(not(all(target_arch = "wasm32", feature = "wasm")))]
pub(crate) struct Stopwatch(std::time::Instant);

#[cfg(not(all(target_arch = "wasm32", feature = "wasm")))]
impl Stopwatch {
    pub(crate) fn start() -> Self {
        Self(std::time::Instant::now())
    }

    pub(crate) fn elapsed_ms(&self) -> Option<f64> {
        Some(self.0.elapsed().as_secs_f64() * 1000.0)
    }
}

#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    // A JsValue, not an f64: a conversion to f64 would happen outside `catch` and could run `valueOf`.
    #[wasm_bindgen(catch, js_namespace = performance, js_name = now)]
    fn js_performance_now() -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue>;
}

/// `performance.now()`, or `None` when it is missing, throws, or returns anything but a finite number
/// (`as_f64` takes only a JS number: a BigInt, a string or an object is not converted, and no `valueOf`
/// runs).
#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
fn performance_now() -> Option<f64> {
    js_performance_now().ok().and_then(|v| v.as_f64()).filter(|t| t.is_finite())
}

#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
pub(crate) struct Stopwatch(Option<f64>);

#[cfg(all(target_arch = "wasm32", feature = "wasm"))]
impl Stopwatch {
    pub(crate) fn start() -> Self {
        Self(performance_now())
    }

    pub(crate) fn elapsed_ms(&self) -> Option<f64> {
        duration_ms(self.0?, performance_now()?)
    }
}

/// The duration between two clock readings, or `None` unless it is finite and not negative: two finite
/// readings can still differ by an infinite amount (`f64::MAX - -f64::MAX`), and a defective clock can
/// go backwards.
#[cfg(any(test, all(target_arch = "wasm32", feature = "wasm")))]
fn duration_ms(start: f64, now: f64) -> Option<f64> {
    let d = now - start;
    (d.is_finite() && d >= 0.0).then_some(d)
}

#[cfg(all(test, not(all(target_arch = "wasm32", feature = "wasm"))))]
mod tests {
    use super::Stopwatch;

    #[test]
    fn a_duration_is_finite_and_not_negative_or_none() {
        use super::duration_ms;
        assert_eq!(duration_ms(3.0, 5.0), Some(2.0));
        assert_eq!(duration_ms(5.0, 5.0), Some(0.0));
        assert_eq!(duration_ms(5.0, 3.0), None); // backwards
        assert_eq!(duration_ms(-f64::MAX, f64::MAX), None); // finite readings, infinite difference
        assert_eq!(duration_ms(0.0, f64::INFINITY), None);
        assert_eq!(duration_ms(f64::NAN, 1.0), None);
    }

    #[test]
    fn native_stopwatch_gives_a_non_negative_non_decreasing_duration() {
        let watch = Stopwatch::start();
        let first = watch.elapsed_ms().expect("a native duration");
        let second = watch.elapsed_ms().expect("a native duration");
        assert!(first >= 0.0 && first.is_finite());
        assert!(second >= first);
    }
}
