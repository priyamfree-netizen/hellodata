import 'dart:math' as math;
import 'dart:ui';

/// Converts an OKLCH color to a Flutter [Color], matching the CSS `oklch()`
/// function used by the BillSOS web app (`src/styles.css`).
///
/// This lets the mobile theme reuse the *exact same* design tokens as the web
/// (same lightness / chroma / hue numbers) instead of re-deriving hex values.
///
/// - [l] lightness 0..1
/// - [c] chroma (0 = grayscale)
/// - [h] hue in degrees 0..360
Color oklch(double l, double c, double h, {double opacity = 1.0}) {
  // OKLCH -> OKLab
  final hRad = h * math.pi / 180.0;
  final aLab = c * math.cos(hRad);
  final bLab = c * math.sin(hRad);

  // OKLab -> LMS (cubed)
  final l_ = l + 0.3963377774 * aLab + 0.2158037573 * bLab;
  final m_ = l - 0.1055613458 * aLab - 0.0638541728 * bLab;
  final s_ = l - 0.0894841775 * aLab - 1.2914855480 * bLab;

  final lCube = l_ * l_ * l_;
  final mCube = m_ * m_ * m_;
  final sCube = s_ * s_ * s_;

  // LMS -> linear sRGB
  final rLin = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  final gLin = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  final bLin = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.7076147010 * sCube;

  int toByte(double linear) {
    final srgb = _linearToSrgb(linear.clamp(0.0, 1.0).toDouble());
    return (srgb * 255.0).round().clamp(0, 255);
  }

  return Color.fromARGB(
    (opacity * 255).round().clamp(0, 255),
    toByte(rLin),
    toByte(gLin),
    toByte(bLin),
  );
}

double _linearToSrgb(double v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * math.pow(v, 1 / 2.4) - 0.055;
}
