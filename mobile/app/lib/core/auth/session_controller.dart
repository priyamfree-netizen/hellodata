import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_exception.dart';
import '../providers.dart';
import '../supabase/supabase_data_client.dart';
import '../../features/auth/data/auth_api.dart';
import 'session_status.dart';
import 'token_store.dart';

/// Owns all session/membership state. This is the ONLY place that hits the
/// network to decide `SessionStatus` — route guards just read [state].
class SessionController extends Notifier<SessionState> {
  late final AuthApi _auth;
  late final TokenStore _tokens;
  late final SupabaseDataClient _data;

  @override
  SessionState build() {
    _auth = ref.read(authApiProvider);
    _tokens = ref.read(tokenStoreProvider);
    _data = ref.read(supabaseDataClientProvider);
    // Kick off bootstrap; state starts as loading.
    Future.microtask(bootstrap);
    return const SessionState.loading();
  }

  /// Cold-start: try a silent refresh if we have a session marker, then resolve
  /// membership to reach `ready` / `noWorkspace`.
  Future<void> bootstrap() async {
    state = const SessionState.loading();
    final hasMarker = await _tokens.hasSessionMarker();
    if (!hasMarker) {
      state = const SessionState.unauthenticated();
      return;
    }
    final token = await _auth.refresh();
    if (token == null) {
      await _tokens.clearAll();
      state = const SessionState.unauthenticated();
      return;
    }
    _applyToken(token);
    await resolveWorkspace();
  }

  /// Called after a successful login / MFA verification.
  Future<void> onAuthenticated(String accessToken) async {
    _applyToken(accessToken);
    await _tokens.setSessionMarker(true);
    await resolveWorkspace();
  }

  void _applyToken(String accessToken) {
    _tokens.setAccessToken(accessToken);
    final claims = _tokens.claims ?? {};
    final orgIds = (claims['org_ids'] as List?)?.cast<String>() ?? const [];
    state = state.copyWith(
      userId: claims['sub']?.toString(),
      email: claims['email']?.toString(),
      isSuperAdmin: claims['is_super_admin'] == true, // stored, never acted on
      orgIds: orgIds,
    );
  }

  /// Confirms an active membership so we don't trust the token blindly. On a
  /// backend error we surface `backendError` (retry) rather than guessing.
  Future<void> resolveWorkspace() async {
    final userId = _tokens.claims?['sub']?.toString();
    if (userId == null) {
      state = const SessionState.unauthenticated();
      return;
    }
    try {
      final rows = await _data
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', userId)
          .eq('status', 'active');

      final orgIds = (rows as List)
          .map((r) => (r as Map)['organization_id'].toString())
          .toList();

      if (orgIds.isEmpty) {
        state = state.copyWith(status: SessionStatus.noWorkspace, orgIds: const []);
        return;
      }
      state = state.copyWith(
        status: SessionStatus.ready,
        orgIds: orgIds,
        activeOrgId: state.activeOrgId ?? orgIds.first,
      );
    } on ApiException catch (e) {
      state = state.copyWith(
        status: SessionStatus.backendError,
        errorMessage: e.message,
      );
    } catch (e) {
      state = state.copyWith(
        status: SessionStatus.backendError,
        errorMessage: e.toString(),
      );
    }
  }

  void setActiveOrg(String orgId) {
    state = state.copyWith(activeOrgId: orgId);
  }

  Future<void> logout() async {
    await _auth.logout();
    await _tokens.clearAll();
    state = const SessionState.unauthenticated();
  }
}
