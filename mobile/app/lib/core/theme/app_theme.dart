import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// Builds Material 3 [ThemeData] from the BillSOS design tokens.
/// Fonts: DM Sans (body) + DM Mono (mono), matching the web app.
class AppTheme {
  const AppTheme._();

  static ThemeData light() => _build(AppColors.light, Brightness.light);
  static ThemeData dark() => _build(AppColors.dark, Brightness.dark);

  static ThemeData _build(AppColors c, Brightness brightness) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: c.primary,
      onPrimary: c.primaryForeground,
      secondary: c.brandBlue,
      onSecondary: c.primaryForeground,
      tertiary: c.brandLime,
      onTertiary: c.foreground,
      error: c.destructive,
      onError: c.destructiveForeground,
      surface: c.background,
      onSurface: c.foreground,
      surfaceContainerLowest: c.background,
      surfaceContainerLow: c.surface,
      surfaceContainer: c.surface,
      surfaceContainerHigh: c.surface2,
      surfaceContainerHighest: c.surface2,
      outline: c.border,
      outlineVariant: c.border,
      onSurfaceVariant: c.mutedForeground,
    );

    final base = brightness == Brightness.dark
        ? ThemeData.dark(useMaterial3: true)
        : ThemeData.light(useMaterial3: true);

    final textTheme = GoogleFonts.dmSansTextTheme(base.textTheme).apply(
      bodyColor: c.foreground,
      displayColor: c.foreground,
    );

    final radiusLg = BorderRadius.circular(AppRadius.lg);

    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: c.background,
      canvasColor: c.background,
      textTheme: textTheme,
      dividerColor: c.border,
      dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: c.background,
        foregroundColor: c.foreground,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: c.foreground,
        ),
      ),
      cardTheme: CardThemeData(
        color: c.card,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl),
          side: BorderSide(color: c.border),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: c.primary,
          foregroundColor: c.primaryForeground,
          disabledBackgroundColor: c.muted,
          elevation: 0,
          minimumSize: const Size.fromHeight(52),
          textStyle: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: radiusLg),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.foreground,
          side: BorderSide(color: c.border),
          minimumSize: const Size.fromHeight(52),
          textStyle: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: radiusLg),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: c.brandBlue),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surface,
        hintStyle: TextStyle(color: c.mutedForeground),
        labelStyle: TextStyle(color: c.mutedForeground),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        enabledBorder: OutlineInputBorder(
          borderRadius: radiusLg,
          borderSide: BorderSide(color: c.input),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: radiusLg,
          borderSide: BorderSide(color: c.ring, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: radiusLg,
          borderSide: BorderSide(color: c.destructive),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: radiusLg,
          borderSide: BorderSide(color: c.destructive, width: 1.5),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: c.foreground,
        contentTextStyle: TextStyle(color: c.background),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: c.sidebar,
        selectedItemColor: c.brandBlue,
        unselectedItemColor: c.mutedForeground,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.brandBlue),
      extensions: [AppThemeExt(colors: c)],
    );
  }
}

/// Exposes the raw token set (incl. brand + surface colors that don't map onto
/// [ColorScheme]) to widgets via `Theme.of(context).extension<AppThemeExt>()`.
class AppThemeExt extends ThemeExtension<AppThemeExt> {
  const AppThemeExt({required this.colors});
  final AppColors colors;

  @override
  ThemeExtension<AppThemeExt> copyWith({AppColors? colors}) =>
      AppThemeExt(colors: colors ?? this.colors);

  @override
  ThemeExtension<AppThemeExt> lerp(covariant AppThemeExt? other, double t) => this;
}

extension AppThemeContext on BuildContext {
  AppColors get colors => Theme.of(this).extension<AppThemeExt>()!.colors;
}
