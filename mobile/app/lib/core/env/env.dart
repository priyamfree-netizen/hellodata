import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Runtime configuration.
///
/// Resolution order for each value:
///   1. `--dart-define=KEY=…` (compile-time override, wins if provided)
///   2. the bundled `.env` asset (loaded by [loadEnv] in main)
///   3. a safe fallback
///
/// PUBLIC values only ever live here. The Supabase **anon** key is fine; the
/// service-role key, JWT secret and SMTP creds are server-only — email is sent
/// by the backend Worker, never by the app.
class Env {
  const Env._();

  static const _apiDefine = String.fromEnvironment('API_BASE_URL');
  static const _urlDefine = String.fromEnvironment('SUPABASE_URL');
  static const _anonDefine = String.fromEnvironment('SUPABASE_ANON_KEY');

  static String _resolve(String define, String key, String fallback) {
    if (define.isNotEmpty) return define;
    final fromEnv = dotenv.maybeGet(key);
    if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;
    return fallback;
  }

  /// Cloudflare Worker / web-app origin serving the `/api/*` endpoints.
  ///
  /// On web, `10.0.2.2` (the Android-emulator alias for the host) is meaningless
  /// — the browser reaches the host directly as `localhost`, so we rewrite it.
  static String get apiBaseUrl {
    final v = _resolve(_apiDefine, 'API_BASE_URL', 'http://10.0.2.2:8080');
    if (kIsWeb) return v.replaceFirst('10.0.2.2', 'localhost');
    return v;
  }

  /// Supabase project URL.
  static String get supabaseUrl => _resolve(_urlDefine, 'SUPABASE_URL', '');

  /// Supabase anon (public) key.
  static String get supabaseAnonKey =>
      _resolve(_anonDefine, 'SUPABASE_ANON_KEY', '');

  static bool get isConfigured =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;
}

/// Loads the bundled `.env` asset. Safe to call once at startup; if the asset
/// is missing (e.g. all config comes from --dart-define) it silently no-ops.
Future<void> loadEnv() async {
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // No .env bundled — rely on --dart-define / fallbacks.
  }
}
