import 'package:supabase/supabase.dart';

import '../auth/token_store.dart';
import '../env/env.dart';

/// Thin wrapper over the Supabase Dart client for direct PostgREST / Storage /
/// Realtime access, mirroring the web `src/lib/supabase/client.ts`.
///
/// The client is created with the **anon** key; before each use we set the
/// bearer to our custom JWT so RLS `auth.uid()` resolves to the user. The token
/// is a Supabase-compatible JWT signed with SUPABASE_JWT_SECRET, so it works
/// directly against Supabase.
class SupabaseDataClient {
  SupabaseDataClient(this._tokenStore)
      : _client = SupabaseClient(Env.supabaseUrl, Env.supabaseAnonKey);

  final SupabaseClient _client;
  final TokenStore _tokenStore;

  /// Returns the client with the current access token applied as the auth
  /// header. Call this for every query so the freshest token is used.
  ///
  /// We assign via the `headers` **setter** (not by mutating the map): only the
  /// setter re-propagates to the rest/storage/functions sub-clients. `apikey`
  /// stays the anon key; `Authorization` carries our custom user JWT so RLS
  /// `auth.uid()` resolves. When logged out we fall back to the anon key as the
  /// bearer.
  SupabaseClient get client {
    final token = _tokenStore.accessToken;
    final bearer =
        token != null && token.isNotEmpty ? token : Env.supabaseAnonKey;
    _client.headers = {
      'apikey': Env.supabaseAnonKey,
      'Authorization': 'Bearer $bearer',
    };
    return _client;
  }

  SupabaseQueryBuilder from(String table) => client.from(table);

  SupabaseStorageClient get storage => client.storage;

  RealtimeChannel channel(String name) => client.channel(name);
}
