import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';

/// The BillSOS wordmark: "Bill" in foreground + "SOS" in brand blue,
/// echoing the web app's brand treatment.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.fontSize = 28});
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return RichText(
      text: TextSpan(
        style: GoogleFonts.dmSans(
          fontSize: fontSize,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.5,
          color: colors.foreground,
        ),
        children: [
          const TextSpan(text: 'Bill'),
          TextSpan(text: 'SOS', style: TextStyle(color: colors.brandBlue)),
        ],
      ),
    );
  }
}
