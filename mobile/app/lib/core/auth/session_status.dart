/// The single source of truth for routing decisions, mirroring the web app's
/// `status` field (see project memory `project-auth-architecture`).
///
/// Route guards read ONLY this — they never make network calls. `backendError`
/// must NEVER be treated as `noWorkspace` (that caused redirect loops on web).
enum SessionStatus {
  /// Bootstrapping — deciding whether a session exists.
  loading,

  /// No valid session; show auth screens.
  unauthenticated,

  /// Authenticated but the user belongs to no organization yet.
  noWorkspace,

  /// Authenticated and a workspace is active — full app is available.
  ready,

  /// Membership/bootstrap query errored — show a retry screen, do not guess.
  backendError,
}

class SessionState {
  const SessionState({
    required this.status,
    this.userId,
    this.email,
    this.orgIds = const [],
    this.isSuperAdmin = false,
    this.activeOrgId,
    this.errorMessage,
  });

  final SessionStatus status;
  final String? userId;
  final String? email;
  final List<String> orgIds;

  /// Present in the token but intentionally **ignored** by the mobile app —
  /// admin surfaces are web-only.
  final bool isSuperAdmin;

  final String? activeOrgId;
  final String? errorMessage;

  const SessionState.loading() : this(status: SessionStatus.loading);
  const SessionState.unauthenticated() : this(status: SessionStatus.unauthenticated);

  SessionState copyWith({
    SessionStatus? status,
    String? userId,
    String? email,
    List<String>? orgIds,
    bool? isSuperAdmin,
    String? activeOrgId,
    String? errorMessage,
  }) {
    return SessionState(
      status: status ?? this.status,
      userId: userId ?? this.userId,
      email: email ?? this.email,
      orgIds: orgIds ?? this.orgIds,
      isSuperAdmin: isSuperAdmin ?? this.isSuperAdmin,
      activeOrgId: activeOrgId ?? this.activeOrgId,
      errorMessage: errorMessage,
    );
  }
}
