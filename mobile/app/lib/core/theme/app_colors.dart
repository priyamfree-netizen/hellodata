import 'dart:ui';
import 'oklch.dart';

/// BillSOS design tokens, mirrored 1:1 from the web app's `src/styles.css`
/// (`:root` = light, `.dark` = dark). Values are the same OKLCH numbers.
class AppColors {
  const AppColors._({
    required this.background,
    required this.foreground,
    required this.surface,
    required this.surface2,
    required this.card,
    required this.cardForeground,
    required this.popover,
    required this.popoverForeground,
    required this.primary,
    required this.primaryForeground,
    required this.secondary,
    required this.secondaryForeground,
    required this.muted,
    required this.mutedForeground,
    required this.accent,
    required this.accentForeground,
    required this.destructive,
    required this.destructiveForeground,
    required this.border,
    required this.input,
    required this.ring,
    required this.brandBlue,
    required this.brandLime,
    required this.sidebar,
    required this.sidebarForeground,
    required this.sidebarBorder,
    required this.sidebarAccent,
  });

  final Color background;
  final Color foreground;
  final Color surface;
  final Color surface2;
  final Color card;
  final Color cardForeground;
  final Color popover;
  final Color popoverForeground;
  final Color primary;
  final Color primaryForeground;
  final Color secondary;
  final Color secondaryForeground;
  final Color muted;
  final Color mutedForeground;
  final Color accent;
  final Color accentForeground;
  final Color destructive;
  final Color destructiveForeground;
  final Color border;
  final Color input;
  final Color ring;
  final Color brandBlue;
  final Color brandLime;
  final Color sidebar;
  final Color sidebarForeground;
  final Color sidebarBorder;
  final Color sidebarAccent;

  /// Light theme — matches `:root { ... }`.
  static final light = AppColors._(
    background: oklch(1, 0, 0),
    foreground: oklch(0.18, 0, 0),
    surface: oklch(0.975, 0, 0),
    surface2: oklch(0.955, 0, 0),
    card: oklch(0.975, 0, 0),
    cardForeground: oklch(0.18, 0, 0),
    popover: oklch(1, 0, 0),
    popoverForeground: oklch(0.18, 0, 0),
    primary: oklch(0.18, 0, 0),
    primaryForeground: oklch(0.985, 0, 0),
    secondary: oklch(0.955, 0, 0),
    secondaryForeground: oklch(0.18, 0, 0),
    muted: oklch(0.955, 0, 0),
    mutedForeground: oklch(0.5, 0, 0),
    accent: oklch(0.955, 0, 0),
    accentForeground: oklch(0.18, 0, 0),
    destructive: oklch(0.62, 0.21, 27),
    destructiveForeground: oklch(0.985, 0, 0),
    border: oklch(0.88, 0, 0),
    input: oklch(0.88, 0, 0),
    ring: oklch(0.55, 0.18, 258),
    brandBlue: oklch(0.55, 0.21, 264),
    brandLime: oklch(0.78, 0.2, 130),
    sidebar: oklch(0.985, 0, 0),
    sidebarForeground: oklch(0.18, 0, 0),
    sidebarBorder: oklch(0.9, 0, 0),
    sidebarAccent: oklch(0.955, 0, 0),
  );

  /// Dark theme — matches `.dark { ... }`.
  static final dark = AppColors._(
    background: oklch(0, 0, 0),
    foreground: oklch(1, 0, 0),
    surface: oklch(0.04, 0, 0),
    surface2: oklch(0.07, 0, 0),
    card: oklch(0.04, 0, 0),
    cardForeground: oklch(1, 0, 0),
    popover: oklch(0.07, 0, 0),
    popoverForeground: oklch(1, 0, 0),
    primary: oklch(1, 0, 0),
    primaryForeground: oklch(0, 0, 0),
    secondary: oklch(0.1, 0, 0),
    secondaryForeground: oklch(1, 0, 0),
    muted: oklch(0.1, 0, 0),
    mutedForeground: oklch(0.55, 0, 0),
    accent: oklch(0.12, 0, 0),
    accentForeground: oklch(1, 0, 0),
    destructive: oklch(0.55, 0.2, 27),
    destructiveForeground: oklch(0.985, 0, 0),
    border: oklch(0.18, 0, 0),
    input: oklch(0.18, 0, 0),
    ring: oklch(0.6, 0.18, 258),
    brandBlue: oklch(0.6, 0.22, 262),
    brandLime: oklch(0.82, 0.21, 130),
    sidebar: oklch(0.025, 0, 0),
    sidebarForeground: oklch(0.95, 0, 0),
    sidebarBorder: oklch(0.15, 0, 0),
    sidebarAccent: oklch(0.1, 0, 0),
  );
}

/// Radius scale from `--radius: 0.875rem` (14px) in styles.css.
class AppRadius {
  const AppRadius._();
  static const double sm = 10; // radius - 4
  static const double md = 12; // radius - 2
  static const double lg = 14; // radius
  static const double xl = 18; // radius + 4
  static const double xxl = 22; // radius + 8
}
