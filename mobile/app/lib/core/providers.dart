import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'auth/session_controller.dart';
import 'auth/session_status.dart';
import 'auth/token_store.dart';
import 'network/api_client.dart';
import 'supabase/supabase_data_client.dart';
import '../features/auth/data/auth_api.dart';

/// Secure storage (Keychain / Keystore).
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage();
});

/// In-memory cookie jar. Wired to persist across launches in a later pass
/// (backed by secure storage) — for now it survives the app process lifetime,
/// which is enough to prove the refresh flow.
final cookieJarProvider = Provider<CookieJar>((ref) => CookieJar());

final tokenStoreProvider = Provider<TokenStore>((ref) {
  return TokenStore(ref.watch(secureStorageProvider));
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    tokenStore: ref.watch(tokenStoreProvider),
    cookieJar: ref.watch(cookieJarProvider),
  );
});

final supabaseDataClientProvider = Provider<SupabaseDataClient>((ref) {
  return SupabaseDataClient(ref.watch(tokenStoreProvider));
});

final authApiProvider = Provider<AuthApi>((ref) {
  return AuthApi(ref.watch(apiClientProvider));
});

/// The app-wide session state machine.
final sessionControllerProvider =
    NotifierProvider<SessionController, SessionState>(SessionController.new);
